import { act, render } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SfuManager } from "@zvonok/client/sfu/manager";

import { ZvonokProvider, useZvonokSession, type ZvonokSession } from "../zvonok-context.js";
import { useViewportQuality } from "../use-viewport-quality.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

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

describe("useViewportQuality", () => {
  let sfu: MockSfuManager;
  let setPreferredLayers: Mock;
  let getVideoConsumerIdForUserId: Mock;

  const setManager = async (manager: SfuManager | null) => {
    sessionRef?.update({ manager });
    await act(async () => {});
  };

  let sessionRef: ZvonokSession | null;

  function Wrapper({ children }: { children: ReactNode }) {
    return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
  }

  // Captures the session so tests can attach the manager from the outside
  // (updating the session from inside a consumer would re-run on every
  // context value change and loop).
  function Probe() {
    sessionRef = useZvonokSession();
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
    sfu = createMockSfuManager();
    setPreferredLayers = sfu.manager.setPreferredLayers as Mock;
    getVideoConsumerIdForUserId = sfu.manager.getVideoConsumerIdForUserId as Mock;
    getVideoConsumerIdForUserId.mockReturnValue("consumer-1");
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requests the full layer when the tile is visible", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    expect(observe).toHaveBeenCalledTimes(1);
    fireIntersection([{ isIntersecting: true }]);

    expect(setPreferredLayers).toHaveBeenCalledWith("consumer-1", 2);
  });

  it("demotes a hidden tile to the lowest layer after the delay", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: false }]);
    expect(setPreferredLayers).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(setPreferredLayers).toHaveBeenCalledWith("consumer-1", 0);
  });

  it("cancels the pending demotion when the tile becomes visible again", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: false }]);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireIntersection([{ isIntersecting: true }]);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(setPreferredLayers).toHaveBeenCalledTimes(1);
    expect(setPreferredLayers).toHaveBeenCalledWith("consumer-1", 2);
  });

  it("does not re-request an unchanged layer", async () => {
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: true }]);
    fireIntersection([{ isIntersecting: true }]);
    fireIntersection([{ isIntersecting: false }]);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    fireIntersection([{ isIntersecting: false }]);

    expect(setPreferredLayers).toHaveBeenCalledTimes(2);
  });

  it("stays silent while no camera consumer exists for the user", async () => {
    getVideoConsumerIdForUserId.mockReturnValue(undefined);
    renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: true }]);
    fireIntersection([{ isIntersecting: false }]);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(setPreferredLayers).not.toHaveBeenCalled();
  });

  it("never observes for unwired tiles (null userId)", async () => {
    renderTile(null);
    await setManager(sfu.manager as unknown as SfuManager);

    expect(observe).not.toHaveBeenCalled();
  });

  it("does not attach without a connected manager", () => {
    renderTile("peer-1");
    expect(observe).not.toHaveBeenCalled();
  });

  it("cancels the pending demotion on unmount", async () => {
    const { unmount } = renderTile("peer-1");
    await setManager(sfu.manager as unknown as SfuManager);

    fireIntersection([{ isIntersecting: false }]);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(setPreferredLayers).not.toHaveBeenCalled();
  });
});
