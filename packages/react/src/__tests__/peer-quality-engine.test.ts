import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PeerQualityStats, QualityLevel } from "@zvonok/client/sfu/types";
import type { SfuManager } from "@zvonok/client/sfu/manager";

import {
  LAYER_SWITCH_DEBOUNCE_MS,
  PeerQualityEngine,
  STATS_INTERVAL_MS,
} from "../peer-quality-engine.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function createQualityStats(userId: string, level: QualityLevel): PeerQualityStats {
  const scoreByLevel: Record<QualityLevel, number> = {
    excellent: 100,
    good: 70,
    fair: 50,
    poor: 10,
  };
  return {
    userId,
    score: { level, score: scoreByLevel[level] },
    stats: { bitrate: 500, rtt: 30, jitter: 5, packetLoss: 0, width: 1280, height: 720, fps: 30 },
  } as PeerQualityStats;
}

describe("PeerQualityEngine state", () => {
  it("treats viewport visibility as visible by default and notifies on flips only", () => {
    const engine = new PeerQualityEngine();
    const seen: string[] = [];
    engine.subscribeVisibility((userId) => seen.push(userId));

    expect(engine.isViewportVisible("u1")).toBe(true);

    // First "visible" write for an unknown user: already the default.
    engine.setVisibility("u1", true);
    expect(seen).toEqual([]);

    engine.setVisibility("u1", false);
    expect(engine.isViewportVisible("u1")).toBe(false);
    expect(seen).toEqual(["u1"]);

    // Same value again: no notification.
    engine.setVisibility("u1", false);
    expect(seen).toEqual(["u1"]);

    engine.setVisibility("u1", true);
    expect(engine.isViewportVisible("u1")).toBe(true);
    expect(seen).toEqual(["u1", "u1"]);
  });

  it("resets visibility, suspend, and stats", () => {
    const engine = new PeerQualityEngine();
    engine.setVisibility("u1", false);
    engine.setSuspended(true);
    engine.setStats(new Map([["u1", createQualityStats("u1", "poor")]]));

    engine.reset();

    expect(engine.isViewportVisible("u1")).toBe(true);
    expect(engine.isSuspended()).toBe(false);
    expect(engine.getPeerStats("u1")).toBeUndefined();
  });

  it("notifies per-peer subscribers only when a peer's score changes or disappears", () => {
    const engine = new PeerQualityEngine();
    const changes: string[] = [];
    engine.subscribePeer("u1", () => changes.push("u1"));

    engine.setStats(
      new Map([
        ["u1", createQualityStats("u1", "good")],
        ["u2", createQualityStats("u2", "poor")],
      ]),
    );
    expect(changes).toEqual(["u1"]);

    // Same score for u1: no notification even though the map is new.
    engine.setStats(
      new Map([
        ["u1", createQualityStats("u1", "good")],
        ["u2", createQualityStats("u2", "poor")],
      ]),
    );
    expect(changes).toEqual(["u1"]);

    // u1 drops out of the report: subscriber learns about it.
    engine.setStats(new Map([["u2", createQualityStats("u2", "poor")]]));
    expect(changes).toEqual(["u1", "u1"]);
    expect(engine.getPeerStats("u1")).toBeUndefined();
  });

  it("notifies suspend subscribers only on flips", () => {
    const engine = new PeerQualityEngine();
    let flips = 0;
    engine.subscribeSuspended(() => {
      flips += 1;
    });

    engine.setSuspended(false);
    engine.setSuspended(true);
    engine.setSuspended(true);
    engine.setSuspended(false);

    expect(flips).toBe(2);
    expect(engine.isSuspended()).toBe(false);
  });
});

describe("PeerQualityEngine adaptation", () => {
  let sfu: MockSfuManager;
  let setPreferredLayers: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    sfu = createMockSfuManager();
    setPreferredLayers = sfu.manager.setPreferredLayers as Mock;
    (sfu.manager.getVideoConsumerIdForUserId as Mock).mockReturnValue("consumer-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function bindEngine(engine: PeerQualityEngine, debounceMs?: number): void {
    engine.bind(sfu.manager as unknown as SfuManager, debounceMs === undefined ? {} : { debounceMs });
  }

  function emitStats(...entries: Array<[string, QualityLevel]>): void {
    act(() => {
      sfu.manager.emitQualityStats(
        new Map(entries.map(([userId, level]) => [userId, createQualityStats(userId, level)])),
      );
    });
  }

  it("starts stats collection with the configured interval", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine, undefined);

    expect(sfu.manager.startStatsCollection).toHaveBeenCalledWith(STATS_INTERVAL_MS.desktop);
    expect(engine.isSuspended()).toBe(false);
  });

  it("emits the score-mapped layer for a visible peer after the debounce", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "excellent"]);
    expect(setPreferredLayers).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenCalledTimes(1);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });

  it("maps fair quality to the mid layer", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "fair"]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 1);
  });

  it("clamps a hidden tile to the lowest layer and restores on return", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "excellent"]);
    engine.setVisibility("u1", false);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 0);

    engine.setVisibility("u1", true);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });

  it("recomputes toward fresher stats while a debounce is pending", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "poor"]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS / 2);
    emitStats(["u1", "excellent"]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    // The pending timer fired on the newer stats and re-checked inputs;
    // the poor-level timer was replaced, so no 0-layer emit happened.
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });

  it("never re-requests an unchanged layer", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "good"]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    emitStats(["u1", "excellent"]); // also maps to layer 2
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    expect(setPreferredLayers).toHaveBeenCalledTimes(1);
  });

  it("stays silent without a camera consumer, then adapts once one appears", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    (sfu.manager.getVideoConsumerIdForUserId as Mock).mockReturnValue(null);
    emitStats(["u1", "excellent"]);
    engine.setVisibility("u1", false);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).not.toHaveBeenCalled();

    (sfu.manager.getVideoConsumerIdForUserId as Mock).mockReturnValue("consumer-1");
    engine.setVisibility("u1", true);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });

  it("clamps every known peer while suspended and restores on resume", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "excellent"]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);

    engine.setSuspended(true);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 0);

    engine.setSuspended(false);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });

  it("drops pending adaptation when the participant leaves", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    emitStats(["u1", "excellent"]);
    engine.setVisibility("u1", false);
    act(() => {
      sfu.manager.emitPeerLeft("u1");
    });
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    expect(setPreferredLayers).not.toHaveBeenCalled();
  });

  it("unbinds completely and can rebind to a fresh manager", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);
    emitStats(["u1", "excellent"]);
    engine.setVisibility("u1", false);

    engine.unbind();

    expect(sfu.manager.stopStatsCollection).toHaveBeenCalled();
    // State reset: visibility back to default, stats cleared.
    expect(engine.isViewportVisible("u1")).toBe(true);
    expect(engine.getPeerStats("u1")).toBeUndefined();

    // A late timer from the old binding must not fire.
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).not.toHaveBeenCalled();

    const sfu2 = createMockSfuManager();
    (sfu2.manager.getVideoConsumerIdForUserId as Mock).mockReturnValue("consumer-2");
    engine.bind(sfu2.manager as unknown as SfuManager, {});
    act(() => {
      sfu2.manager.emitQualityStats(new Map([["u1", createQualityStats("u1", "good")]]));
    });
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(sfu2.manager.setPreferredLayers).toHaveBeenLastCalledWith("consumer-2", 2);
    expect(setPreferredLayers).not.toHaveBeenCalled();
  });
  it("suspends and pauses stats polling while the page is hidden", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    const visibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(engine.isSuspended()).toBe(true);
    expect(sfu.manager.stopStatsCollection).toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(engine.isSuspended()).toBe(false);
    expect(sfu.manager.startStatsCollection).toHaveBeenLastCalledWith(STATS_INTERVAL_MS.desktop);

    if (visibilityState) {
      Object.defineProperty(document, "visibilityState", visibilityState);
    }
  });

  it("ignores scheduling while unbound", () => {
    const engine = new PeerQualityEngine();
    engine.setVisibility("u1", false);
    engine.setSuspended(true);
    engine.setStats(new Map([["u1", createQualityStats("u1", "poor")]]));

    expect(setPreferredLayers).not.toHaveBeenCalled();
  });

  it("does not schedule for peers without stats (visibility-only writes)", () => {
    const engine = new PeerQualityEngine();
    bindEngine(engine);

    engine.setVisibility("ghost-user", false);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    expect(setPreferredLayers).not.toHaveBeenCalled();
  });
});
