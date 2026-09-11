import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SfuManager } from "@zvonok/client/sfu/manager";

import {
  AudioActivityEngine,
  useActiveSpeaker,
  useAudioLevels,
} from "../use-audio-activity.js";
import { ZvonokProvider, useZvonokSession } from "../zvonok-context.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

/** Scriptable stand-in for AudioLevelSampler's engine-facing surface. */
function createFakeSampler() {
  const owned = new Map<string, unknown>();
  const borrowed = new Map<string, unknown>();
  let levels = new Map<string, number>();
  return {
    owned,
    borrowed,
    setLevels(next: Map<string, number>) {
      levels = next;
    },
    addOwned: vi.fn((id: string, stream: unknown) => owned.set(id, stream)),
    addBorrowed: vi.fn((id: string, analyser: unknown) =>
      borrowed.set(id, analyser),
    ),
    remove: vi.fn((id: string) => {
      owned.delete(id);
      borrowed.delete(id);
    }),
    clear: vi.fn(() => {
      owned.clear();
      borrowed.clear();
    }),
    sample: vi.fn(() => levels),
  };
}

function createFakeContext(): AudioContext {
  return {
    state: "running",
    resume: vi.fn(),
    close: vi.fn(),
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createAnalyser: vi.fn(() => ({ frequencyBinCount: 4 })),
  } as unknown as AudioContext;
}

function createEngine(manager: MockSfuManager["manager"]) {
  const sampler = createFakeSampler();
  const engine = new AudioActivityEngine(manager as never, {
    intervalMs: 100,
    sampler,
    audioContextFactory: createFakeContext,
  });
  return { engine, sampler };
}

/** Advances the clock by whole ticks, flushing each interval callback. */
function advanceTicks(ms: number) {
  vi.advanceTimersByTime(ms);
}

describe("AudioActivityEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks onto the first speaker above threshold", () => {
    const sfu = createMockSfuManager();
    const { engine, sampler } = createEngine(sfu.manager);
    engine.acquire();

    sampler.setLevels(new Map([["r1", 0.5]]));
    advanceTicks(300);

    expect(engine.getSnapshot().activeSpeakerId).toBe("r1");
    engine.release();
  });

  it("switches to a louder sustained speaker after the switch window", () => {
    const sfu = createMockSfuManager();
    const { engine, sampler } = createEngine(sfu.manager);
    engine.acquire();

    sampler.setLevels(new Map([["r1", 0.5]]));
    advanceTicks(300);
    sampler.setLevels(
      new Map([
        ["r1", 0.4],
        ["r2", 0.9],
      ]),
    );
    advanceTicks(1000);

    expect(engine.getSnapshot().activeSpeakerId).toBe("r2");
    engine.release();
  });

  it("returns to null after sustained silence", () => {
    const sfu = createMockSfuManager();
    const { engine, sampler } = createEngine(sfu.manager);
    engine.acquire();

    sampler.setLevels(new Map([["r1", 0.5]]));
    advanceTicks(300);
    sampler.setLevels(new Map());
    advanceTicks(1000);

    expect(engine.getSnapshot().activeSpeakerId).toBeNull();
    expect(engine.getSnapshot().levels).toEqual({});
    engine.release();
  });

  it("samples the local microphone under the local participant id", () => {
    const sfu = createMockSfuManager();
    const localTrack = {
      kind: "audio",
      id: "local-mic",
    } as unknown as MediaStreamTrack;
    sfu.manager.getProducerByKind.mockReturnValue({
      id: "audio-producer",
      track: localTrack,
    });
    sfu.manager.simulateLocalUser("me");
    const { engine, sampler } = createEngine(sfu.manager);
    engine.acquire();

    advanceTicks(100);

    expect(sampler.addOwned).toHaveBeenCalledWith("me", expect.anything());
    sampler.setLevels(new Map([["me", 0.6]]));
    advanceTicks(100);

    expect(engine.getSnapshot().activeSpeakerId).toBe("me");
    expect(engine.getSnapshot().levels).toEqual({ me: 0.6 });
    engine.release();
  });

  it("attaches remote analysers on audio tracks and detaches on participant leave", () => {
    const sfu = createMockSfuManager();
    const { engine, sampler } = createEngine(sfu.manager);
    engine.acquire();
    const remoteTrack = {
      kind: "audio",
      id: "remote-mic",
      onended: null,
    } as unknown as MediaStreamTrack;

    act(() => {
      sfu.manager.emitTrack(remoteTrack as MediaStreamTrack, "audio", "r1");
    });

    expect(sampler.addBorrowed).toHaveBeenCalledWith("r1", expect.anything());

    act(() => {
      sfu.manager.emitPeerLeft("r1");
    });

    expect(sampler.remove).toHaveBeenCalledWith("r1");
    engine.release();
  });

  it("stops sampling and clears state on release", () => {
    const sfu = createMockSfuManager();
    const { engine, sampler } = createEngine(sfu.manager);
    engine.acquire();
    sampler.setLevels(new Map([["r1", 0.5]]));
    advanceTicks(200);

    engine.release();

    expect(sampler.clear).toHaveBeenCalled();
    expect(engine.getSnapshot().activeSpeakerId).toBeNull();
    expect(engine.getSnapshot().levels).toEqual({});
  });
});

function Provider({ children }: { children: ReactNode }) {
  return (
    <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>
  );
}

function renderAudioHooks() {
  return renderHook(
    () => ({
      activeSpeaker: useActiveSpeaker(),
      levels: useAudioLevels(),
      session: useZvonokSession(),
    }),
    { wrapper: Provider },
  );
}

describe("useActiveSpeaker and useAudioLevels", () => {
  it("report silence and empty levels without a session", () => {
    const { result } = renderAudioHooks();

    expect(result.current.activeSpeaker).toBeNull();
    expect(result.current.levels).toEqual({});
  });

  it("default to silence with a manager attached and survive audio track events", async () => {
    const sfu = createMockSfuManager();
    const { result, unmount } = renderAudioHooks();
    await act(async () => {
      result.current.session.update({
        manager: sfu.manager as unknown as SfuManager,
        status: "joined",
      });
    });

    const remoteTrack = {
      kind: "audio",
      id: "remote-mic",
      onended: null,
    } as unknown as MediaStreamTrack;
    await act(async () => {
      sfu.manager.emitTrack(remoteTrack as MediaStreamTrack, "audio", "r1");
    });

    expect(result.current.activeSpeaker).toBeNull();
    expect(result.current.levels).toEqual({});
    unmount();
  });
});
