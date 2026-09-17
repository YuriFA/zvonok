import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useSfuTrackSync } from "../core/use-sfu-track-sync.js";
import type { CapturePort } from "../hooks/capture-port.js";
import { usePublishControls, type PublishToggleResult } from "../hooks/use-publish-controls.js";
import type { UseZvonokConnectionResult } from "../hooks/use-zvonok-connection.js";

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

function createConnection(overrides: Record<string, unknown> = {}) {
  return {
    status: "joined",
    hasProducer: vi.fn(() => false),
    produceTrack: vi.fn(async () => true),
    resumeProducer: vi.fn(),
    pauseProducer: vi.fn(),
    replaceTrack: vi.fn(async () => true),
    ...overrides,
  } as unknown as UseZvonokConnectionResult;
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
  connection: UseZvonokConnectionResult,
  kind: "audio" | "video",
  enabled: boolean,
  port: CapturePort,
  isMobile?: boolean,
): Promise<PublishToggleResult> {
  const { result } = renderHook(() => usePublishControls(connection, { isMobile }));
  return result.current.toggle(kind, enabled, port);
}

describe("usePublishControls", () => {
  it("pauses the producer and releases capture when disabling", async () => {
    const connection = createConnection({ hasProducer: vi.fn(() => true) });
    const release = vi.fn(async () => {});

    const result = await toggleOnce(connection, "video", false, portWith(null, { release }));

    expect(connection.pauseProducer).toHaveBeenCalledWith("video");
    expect(release).toHaveBeenCalledTimes(1);
    expect(result).toBe("paused");
  });

  it("still releases capture when no producer exists while disabling", async () => {
    const connection = createConnection({ hasProducer: vi.fn(() => false) });
    const release = vi.fn();

    const result = await toggleOnce(connection, "audio", false, portWith(null, { release }));

    expect(connection.pauseProducer).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(result).toBe("paused");
  });

  it("produces a live track and resumes when no producer exists", async () => {
    const track = createLiveTrack("cam-1", "video");
    const connection = createConnection();

    const result = await toggleOnce(connection, "video", true, portWith(track), true);

    expect(connection.produceTrack).toHaveBeenCalledWith(track, { isMobile: true });
    expect(connection.resumeProducer).toHaveBeenCalledWith("video");
    expect(result).toBe("published");
  });

  it("re-acquires capture when the current track is not live", async () => {
    const dead = createEndedTrack("cam-dead", "video");
    const fresh = createLiveTrack("cam-fresh", "video");
    const connection = createConnection();
    const ensureTrack = vi.fn(async () => ({ getTracks: () => [fresh] }) as unknown as MediaStream);

    const result = await toggleOnce(connection, "video", true, portWith(dead, { ensureTrack }));

    expect(ensureTrack).toHaveBeenCalledTimes(1);
    expect(connection.produceTrack).toHaveBeenCalledWith(fresh, undefined);
    expect(result).toBe("published");
  });

  it("fails with no-track when re-acquiring returns nothing live", async () => {
    const connection = createConnection();
    const ensureTrack = vi.fn(async () => null);

    const result = await toggleOnce(connection, "audio", true, portWith(null, { ensureTrack }));

    expect(connection.produceTrack).not.toHaveBeenCalled();
    expect(connection.resumeProducer).not.toHaveBeenCalled();
    expect(result).toBe("no-track");
  });

  it("fails with produce-failed and never resumes when producing fails", async () => {
    const track = createLiveTrack("mic-1");
    const connection = createConnection({ produceTrack: vi.fn(async () => false) });

    const result = await toggleOnce(connection, "audio", true, portWith(track));

    expect(connection.resumeProducer).not.toHaveBeenCalled();
    expect(result).toBe("produce-failed");
  });

  it("swaps the new track into an existing producer before resuming", async () => {
    const track = createLiveTrack("mic-2");
    const connection = createConnection({ hasProducer: vi.fn(() => true) });

    const result = await toggleOnce(connection, "audio", true, portWith(track));

    expect(connection.produceTrack).not.toHaveBeenCalled();
    expect(connection.replaceTrack).toHaveBeenCalledWith("audio", track);
    expect(connection.resumeProducer).toHaveBeenCalledWith("audio");
    expect(result).toBe("published");
  });

  it("fails with replace-failed and never resumes when the swap fails", async () => {
    const track = createLiveTrack("cam-x", "video");
    const connection = createConnection({
      hasProducer: vi.fn(() => true),
      replaceTrack: vi.fn(async () => false),
    });

    const result = await toggleOnce(connection, "video", true, portWith(track));

    expect(connection.resumeProducer).not.toHaveBeenCalled();
    expect(result).toBe("replace-failed");
  });

  it("keeps the toggle stable across re-renders with the same inputs", () => {
    const connection = createConnection();
    const { result, rerender } = renderHook(
      ({ connection }: { connection: UseZvonokConnectionResult }) =>
        usePublishControls(connection, { isMobile: false }),
      { initialProps: { connection } },
    );
    const first = result.current.toggle;
    rerender({ connection });
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
