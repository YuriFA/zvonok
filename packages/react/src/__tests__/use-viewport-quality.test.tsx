import { act, render } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PeerQualityStats, QualityLevel } from "@zvonok/client/sfu/types";
import type { SfuManager } from "@zvonok/client/sfu/manager";

import {
  PeerQualityProvider,
  usePeerQualityContext,
} from "../contexts/peer-quality-context.js";
import { LAYER_SWITCH_DEBOUNCE_MS } from "../core/peer-quality-engine.js";
import { ZvonokProvider, useZvonokSession, type ZvonokSession } from "../contexts/zvonok-context.js";
import { useViewportQuality } from "../core/use-viewport-quality.js";
import { createMockSfuManager, stubMatchMedia, type MockSfuManager } from "./doubles.js";

type IntersectionEntry = { isIntersecting: boolean };

let intersectionCallback: ((entries: IntersectionEntry[]) => void) | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class MockIntersectionObserver {
  constructor(callback: (entries: IntersectionEntry[]) => void) {
    intersectionCallback = callback;
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
}

function fireIntersection(entries: IntersectionEntry[]) {
  act(() => {
    intersectionCallback?.(entries);
  });
}

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

describe("useViewportQuality", () => {
  let sfu: MockSfuManager;
  let setPreferredLayers: Mock;
  let getVideoConsumerIdForUserId: Mock;

  const setManager = async (manager: SfuManager | null) => {
    sessionRef?.update({ manager });
    await act(async () => {});
  };

  let sessionRef: ZvonokSession | null;
  let engineRef: ReturnType<typeof usePeerQualityContext> | null;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ZvonokProvider serverUrl="https://sfu.test">
        <PeerQualityProvider>{children}</PeerQualityProvider>
      </ZvonokProvider>
    );
  }

  // Captures the session and the engine so tests can attach the manager
  // and read engine state from the outside (updating the session from
  // inside a consumer would re-run on every context value change and loop).
  function Probe() {
    sessionRef = useZvonokSession();
    engineRef = usePeerQualityContext();
    return null;
  }

  function Tile({ userId }: { userId: string | null }) {
    const ref = useRef<HTMLDivElement>(null);
    useViewportQuality(ref, userId);
    return <div ref={ref} data-testid="tile" />;
  }

  function renderTile(userId: string | null) {
    return render(
      <>
        <Probe />
        <Tile userId={userId} />
      </>,
      { wrapper: Wrapper },
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    intersectionCallback = null;
    observe.mockClear();
    disconnect.mockClear();
    engineRef = null;
    sfu = createMockSfuManager();
    setPreferredLayers = sfu.manager.setPreferredLayers as Mock;
    getVideoConsumerIdForUserId = sfu.manager.getVideoConsumerIdForUserId as Mock;
    getVideoConsumerIdForUserId.mockReturnValue("consumer-1");
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function emitStats(userId: string, level: QualityLevel): void {
    act(() => {
      sfu.manager.emitQualityStats(new Map([[userId, createQualityStats(userId, level)]]));
    });
  }

  it("adapts a visible tile to the score-mapped layer after the debounce", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: true }]);
    emitStats("peer-1", "excellent");
    expect(setPreferredLayers).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenCalledWith("consumer-1", 2);
  });

  it("clamps a tile that left the viewport to the lowest layer", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: true }]);
    emitStats("peer-1", "excellent");
    fireIntersection([{ isIntersecting: false }]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 0);
  });

  it("cancels the pending clamp when the tile becomes visible again", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: true }]);
    emitStats("peer-1", "excellent");
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    fireIntersection([{ isIntersecting: false }]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS / 2);
    fireIntersection([{ isIntersecting: true }]);
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    expect(setPreferredLayers).toHaveBeenCalledTimes(1);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });
  it("restores visibility for the peer on unmount", async () => {
    const { unmount } = renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: false }]);
    expect(engineRef?.isViewportVisible("peer-1")).toBe(false);

    unmount();
    expect(engineRef?.isViewportVisible("peer-1")).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it("restores visibility for the peer on unmount", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: false }]);
    expect(engineRef?.isViewportVisible("peer-1")).toBe(false);

    const { unmount } = renderTile("peer-1");
    unmount();
    expect(engineRef?.isViewportVisible("peer-1")).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it("never observes for unwired tiles (null userId)", async () => {
    renderTile(null);
    await setManager(sfu.manager as unknown as SfuManager);

    expect(observe).not.toHaveBeenCalled();
    expect(intersectionCallback).toBeNull();
  });

  it("observes without a connected manager but never requests layers", async () => {
    renderTile("peer-1");

    fireIntersection([{ isIntersecting: true }]);
    emitStats("peer-1", "excellent");
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);

    expect(observe).toHaveBeenCalled();
    expect(setPreferredLayers).not.toHaveBeenCalled();
  });

  it("throws outside of a PeerQualityProvider", () => {
    function BareTile() {
      const ref = useRef<HTMLDivElement>(null);
      useViewportQuality(ref, "peer-1");
      return <div ref={ref} />;
    }
    expect(() =>
      render(<BareTile />, {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>
        ),
      }),
    ).toThrow(/PeerQualityProvider/);
  });
});
