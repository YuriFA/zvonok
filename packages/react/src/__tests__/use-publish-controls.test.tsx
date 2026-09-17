import { renderHook, waitFor } from "@testing-library/react";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useSfuTrackSync } from "../core/use-sfu-track-sync.js";
import type { CapturePort } from "../hooks/capture-port.js";
import { usePublishControls, type PublishToggleResult } from "../hooks/use-publish-controls.js";

// Session double for the track-sync hook; the module mock below is
// hoisted, so the double lives here too.
const sessionDouble = vi.hoisted(() => ({
  mediaManager: {
    videoCapture: { onStateChange: vi.fn() },
    audioCapture: { onStateChange: vi.fn() },
  },
  manager: null as unknown,
}));

vi.mock("../contexts/zvonok-context.js", () => ({
  useZvonokSession: () => sessionDouble,
}));

function createLiveTrack(id: string, kind: "audio" | "video" = "audio"): MediaStreamTrack {
  return { kind, id, enabled: true, readyState: "live" } as unknown as MediaStreamTrack;
}

function createEndedTrack(id: string, kind: "audio" | "video" = "audio"): MediaStreamTrack {
  return { kind, id, enabled: true, readyState: "ended" } as unknown as MediaStreamTrack;
}

function createManager({
  producer,
  produceResult,
  replaceResult = true,
}: {
  producer?: { id: string };
  produceResult?: { id: string } | null;
  replaceResult?: boolean;
} = {}) {
  return {
    getProducerByKind: vi.fn(() => producer),
    produce: vi.fn(async () => produceResult ?? null),
    pauseProducer: vi.fn(),
    resumeProducer: vi.fn(),
    replaceTrack: vi.fn(async () => replaceResult),
  } as unknown as SfuManager;
}

function portWith(
  track: MediaStreamTrack | null | undefined,
  overrides: Partial<CapturePort> = {},
): CapturePort {
  return {
    getTrack: () => track,
    ...overrides,
  };
}

async function toggleOnce(
  manager: SfuManager | null,
  kind: "audio" | "video",
  enabled: boolean,
  port: CapturePort,
  isMobile?: boolean,
): Promise<PublishToggleResult> {
  const { result } = renderHook(() => usePublishControls(manager, { isMobile }));
  return result.current.toggle(kind, enabled, port);
}

describe("usePublishControls", () => {
  it("pauses the producer and releases capture when disabling", async () => {
    const manager = createManager({ producer: { id: "video-producer" } });
    const release = vi.fn(async () => {});

    const result = await toggleOnce(manager, "video", false, portWith(null, { release }));

    expect(manager.pauseProducer).toHaveBeenCalledWith("video-producer");
    expect(release).toHaveBeenCalledTimes(1);
    expect(result).toBe("paused");
  });

  it("still releases capture when no producer exists while disabling", async () => {
    const manager = createManager();
    const release = vi.fn();

    const result = await toggleOnce(manager, "audio", false, portWith(null, { release }));

    expect(manager.pauseProducer).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(result).toBe("paused");
  });

  it("produces a live track and resumes when no producer exists", async () => {
    const track = createLiveTrack("cam-1", "video");
    const manager = createManager({ produceResult: { id: "video-producer" } });

    const result = await toggleOnce(manager, "video", true, portWith(track), true);

    expect(manager.produce).toHaveBeenCalledWith(track, { isMobile: true });
    expect(manager.resumeProducer).toHaveBeenCalledWith("video-producer");
    expect(result).toBe("published");
  });

  it("re-acquires capture when the current track is not live", async () => {
    const dead = createEndedTrack("cam-dead", "video");
    const fresh = createLiveTrack("cam-fresh", "video");
    const manager = createManager({ produceResult: { id: "video-producer" } });
    const ensureTrack = vi.fn(async () => ({ getTracks: () => [fresh] }) as unknown as MediaStream);

    const result = await toggleOnce(manager, "video", true, portWith(dead, { ensureTrack }));

    expect(ensureTrack).toHaveBeenCalledTimes(1);
    expect(manager.produce).toHaveBeenCalledWith(fresh, undefined);
    expect(result).toBe("published");
  });

  it("fails with no-track when re-acquiring returns nothing live", async () => {
    const manager = createManager();
    const ensureTrack = vi.fn(async () => null);

    const result = await toggleOnce(manager, "audio", true, portWith(null, { ensureTrack }));

    expect(manager.produce).not.toHaveBeenCalled();
    expect(manager.resumeProducer).not.toHaveBeenCalled();
    expect(result).toBe("no-track");
  });

  it("fails with produce-failed and never resumes when producing fails", async () => {
    const track = createLiveTrack("mic-1");
    const manager = createManager({ produceResult: null });

    const result = await toggleOnce(manager, "audio", true, portWith(track));

    expect(manager.resumeProducer).not.toHaveBeenCalled();
    expect(result).toBe("produce-failed");
  });

  it("swaps the new track into an existing producer before resuming", async () => {
    const track = createLiveTrack("mic-2");
    const manager = createManager({ producer: { id: "existing-producer" } });

    const result = await toggleOnce(manager, "audio", true, portWith(track));

    expect(manager.produce).not.toHaveBeenCalled();
    expect(manager.replaceTrack).toHaveBeenCalledWith("audio", track);
    expect(manager.resumeProducer).toHaveBeenCalledWith("existing-producer");
    expect(result).toBe("published");
  });

  it("fails with replace-failed and never resumes when the swap fails", async () => {
    const track = createLiveTrack("cam-x", "video");
    const manager = createManager({
      producer: { id: "video-producer" },
      replaceResult: false,
    });

    const result = await toggleOnce(manager, "video", true, portWith(track));

    expect(manager.resumeProducer).not.toHaveBeenCalled();
    expect(result).toBe("replace-failed");
  });

  it("rejects with a typed error before the join created a manager", async () => {
    const { result } = renderHook(() => usePublishControls(null));
    await expect(result.current.toggle("audio", true, portWith(null))).rejects.toMatchObject({
      code: "DISCONNECTED",
    });
  });

  it("keeps the toggle stable across re-renders with the same inputs", () => {
    const manager = createManager();
    const { result, rerender } = renderHook(
      ({ sfuManager }: { sfuManager: SfuManager | null }) =>
        usePublishControls(sfuManager, { isMobile: false }),
      { initialProps: { sfuManager: manager } },
    );
    const first = result.current.toggle;
    rerender({ sfuManager: manager });
    expect(result.current.toggle).toBe(first);
  });
});

describe("useSfuTrackSync", () => {
  let replaceTrack: Mock;
  let getProducerByKind: Mock;
  let videoListeners: Set<(state: number, track: MediaStreamTrack | null) => void>;

  beforeEach(() => {
    replaceTrack = vi.fn(async () => true);
    getProducerByKind = vi.fn(() => ({ id: "producer-1" }));
    videoListeners = new Set();
    sessionDouble.manager = {
      getProducerByKind,
      replaceTrack,
    };
    sessionDouble.mediaManager = {
      videoCapture: {
        onStateChange: vi.fn((fn: (state: number, track: MediaStreamTrack | null) => void) => {
          videoListeners.add(fn);
          return () => videoListeners.delete(fn);
        }),
      },
      audioCapture: { onStateChange: vi.fn(() => () => {}) },
    };
  });

  it("swaps the published track when a capture restarts while a producer exists", async () => {
    renderHook(() => useSfuTrackSync());

    expect(sessionDouble.mediaManager.videoCapture.onStateChange).toHaveBeenCalledTimes(1);
    expect(sessionDouble.mediaManager.audioCapture.onStateChange).toHaveBeenCalledTimes(1);

    const activeState = 2; // CaptureState.ACTIVE
    const videoTrack = createLiveTrack("cam-new", "video");
    videoListeners.forEach((fn) => void fn(activeState, videoTrack));

    await waitFor(() => expect(replaceTrack).toHaveBeenCalledWith("video", videoTrack));
  });

  it("stays silent when no producer exists for the restarted capture", async () => {
    getProducerByKind.mockReturnValue(undefined);
    const { promise, resolve } = Promise.withResolvers<void>();
    renderHook(() => useSfuTrackSync());

    videoListeners.forEach((fn) => void fn(2, createLiveTrack("cam-1", "video")));
    setTimeout(resolve, 0);
    await promise;

    expect(replaceTrack).not.toHaveBeenCalled();
  });
});
