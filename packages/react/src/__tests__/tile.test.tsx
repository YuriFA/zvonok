import { act, render } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PeerQualityStats, QualityLevel } from "@zvonok/client/sfu/types";
import type { SfuManager } from "@zvonok/client/sfu/manager";

import { LAYER_SWITCH_DEBOUNCE_MS } from "../core/peer-quality-engine.js";
import {
  PeerQualityProvider,
  usePeerQualityContext,
} from "../contexts/peer-quality-context.js";
import { Tile, useTileContext } from "../core/tile.js";
import { ZvonokProvider, useZvonokSession, type ZvonokSession } from "../contexts/zvonok-context.js";
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

describe("Tile", () => {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ZvonokProvider serverUrl="https://sfu.test">
        <PeerQualityProvider>{children}</PeerQualityProvider>
      </ZvonokProvider>
    );
  }

  function renderTile(ui: ReactNode) {
    return render(ui, { wrapper: Wrapper });
  }

  beforeEach(() => {
    intersectionCallback = null;
    observe.mockClear();
    disconnect.mockClear();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders its own video element and honors isMuted", () => {
    const { container } = renderTile(<Tile userId="u1" stream={null} isMuted />);

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.srcObject).toBeNull();
    expect(video?.muted).toBe(true);
  });

  it("covers the video with the default overlay while the camera is off", () => {
    const { container } = renderTile(
      <Tile userId="ada" stream={null} isVideoEnabled={false} />,
    );

    const overlay = container.querySelector("div div");
    expect(overlay?.textContent).toBe("A");
  });

  it("renders nothing over the video when OverlayUI is null", () => {
    const { container } = renderTile(
      <Tile userId="u1" stream={null} isVideoEnabled={false} OverlayUI={null} />,
    );

    // Only the root and the video element exist.
    expect(container.querySelectorAll("div")).toHaveLength(1);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("swaps the overlay for a custom ReactElement", () => {
    const { container } = renderTile(
      <Tile
        userId="u1"
        stream={null}
        isVideoEnabled={false}
        OverlayUI={<div data-testid="custom-overlay">off</div>}
      />,
    );

    expect(container.querySelector("[data-testid='custom-overlay']")?.textContent).toBe("off");
  });

  it("swaps the overlay for a custom ComponentType reading the context", () => {
    function CustomOverlay() {
      const { userId, isVideoEnabled } = useTileContext();
      return <span data-testid="ctx">{userId}:{String(isVideoEnabled)}</span>;
    }
    const { container } = renderTile(
      <Tile userId="u1" stream={null} isVideoEnabled={false} OverlayUI={CustomOverlay} />,
    );

    expect(container.querySelector("[data-testid='ctx']")?.textContent).toBe("u1:false");
  });

  it("renders children above the media", () => {
    const { container } = renderTile(
      <Tile userId="u1" stream={null}>
        <span data-testid="badge">Ann</span>
      </Tile>,
    );

    expect(container.querySelector("[data-testid='badge']")?.textContent).toBe("Ann");
  });

  it("skips visibility tracking without a userId", () => {
    renderTile(<Tile userId={null} stream={null} />);

    expect(observe).not.toHaveBeenCalled();
  });

  it("throws for useTileContext outside of a Tile", () => {
    function Orphan() {
      useTileContext();
      return null;
    }
    expect(() => render(<Orphan />, { wrapper: Wrapper })).toThrow(/within a Tile/);
  });

  it("throws outside of a PeerQualityProvider (visibility tracking is core)", () => {
    function Bare() {
      return <Tile userId="u1" stream={null} />;
    }
    expect(() =>
      render(<Bare />, {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>
        ),
      }),
    ).toThrow(/PeerQualityProvider/);
  });
});

describe("Tile visibility plumbing", () => {
  let sfu: MockSfuManager;
  let engineRef: ReturnType<typeof usePeerQualityContext> | null;
  let sessionRef: ZvonokSession | null;
  let setPreferredLayers: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    intersectionCallback = null;
    observe.mockClear();
    disconnect.mockClear();
    engineRef = null;
    sessionRef = null;
    sfu = createMockSfuManager();
    setPreferredLayers = sfu.manager.setPreferredLayers as Mock;
    (sfu.manager.getVideoConsumerIdForUserId as Mock).mockReturnValue("consumer-1");
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function Probe() {
    sessionRef = useZvonokSession();
    engineRef = usePeerQualityContext();
    return null;
  }

  function renderWithProbe(ui: ReactNode) {
    return render(
      <>
        <Probe />
        {ui}
      </>,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <ZvonokProvider serverUrl="https://sfu.test">
            <PeerQualityProvider>{children}</PeerQualityProvider>
          </ZvonokProvider>
        ),
      },
    );
  }

  const attach = async (manager: SfuManager) => {
    sessionRef?.update({ manager });
    await act(async () => {});
  };

  it("observes its own root element and reports flips to the engine", async () => {
    renderWithProbe(<Tile userId="u1" stream={null} />);
    await attach(sfu.manager as unknown as SfuManager);

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0].tagName).toBe("DIV");

    act(() => {
      intersectionCallback?.([{ isIntersecting: false }]);
    });
    expect(engineRef?.isViewportVisible("u1")).toBe(false);

    act(() => {
      intersectionCallback?.([{ isIntersecting: true }]);
    });
    expect(engineRef?.isViewportVisible("u1")).toBe(true);
  });

  it("disconnects on unmount and restores visibility", async () => {
    const { unmount } = renderWithProbe(<Tile userId="u1" stream={null} />);
    await attach(sfu.manager as unknown as SfuManager);

    act(() => {
      intersectionCallback?.([{ isIntersecting: false }]);
    });
    expect(engineRef?.isViewportVisible("u1")).toBe(false);

    unmount();
    expect(engineRef?.isViewportVisible("u1")).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it("integration: tile visibility clamps the engine's layer selection", async () => {
    renderWithProbe(<Tile userId="peer-1" stream={null} />);
    await attach(sfu.manager as unknown as SfuManager);

    act(() => {
      sfu.manager.emitQualityStats(new Map([["peer-1", createQualityStats("peer-1", "excellent")]]));
    });
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);

    // The tile leaves the viewport: the engine clamps to the lowest layer.
    act(() => {
      intersectionCallback?.([{ isIntersecting: false }]);
    });
    vi.advanceTimersByTime(LAYER_SWITCH_DEBOUNCE_MS);
    expect(setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 0);
  });
});
