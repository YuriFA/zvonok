import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaCapturePort } from "../hooks/capture-port.js";
import { createMockMediaManager, type MockMediaManager } from "./doubles.js";

function liveTrack(kind: "audio" | "video"): MediaStreamTrack {
  return { kind, id: `${kind}-1`, readyState: "live" } as unknown as MediaStreamTrack;
}

function streamWith(track: MediaStreamTrack): MediaStream {
  return { getTracks: () => [track] } as unknown as MediaStream;
}

function managerWithLiveTrack(manager: MockMediaManager, kind: "audio" | "video") {
  const capture = kind === "video" ? manager.videoCapture : manager.audioCapture;
  const track = liveTrack(kind);
  const stream = streamWith(track);
  vi.mocked(capture.getTrack).mockReturnValue(track);
  vi.mocked(capture.getStream).mockReturnValue(stream);
  return { capture, track, stream };
}

describe("createMediaCapturePort", () => {
  let manager: MockMediaManager;

  beforeEach(() => {
    manager = createMockMediaManager();
    localStorage.clear();
  });

  it("routes getTrack and getStream to the kind's capture", () => {
    const port = createMediaCapturePort(manager as never);
    port.getTrack("video");
    port.getTrack("audio");
    port.getStream!("video");
    expect(manager.videoCapture.getTrack).toHaveBeenCalled();
    expect(manager.audioCapture.getTrack).toHaveBeenCalled();
    expect(manager.videoCapture.getStream).toHaveBeenCalled();
  });

  it("keeps a live capture running and returns its stream", async () => {
    managerWithLiveTrack(manager, "video");
    const port = createMediaCapturePort(manager as never);
    const stream = await port.ensureTrack!("video");
    expect(manager.videoCapture.start).not.toHaveBeenCalled();
    expect(stream).not.toBeNull();
  });

  it("starts capture with the persisted device selection", async () => {
    localStorage.setItem(
      "zvonok:device-selection",
      JSON.stringify({ videoDeviceId: "cam-2", audioDeviceId: "mic-3" }),
    );
    manager.videoCapture.start.mockResolvedValue(true);
    managerWithLiveTrack(manager, "video");
    vi.mocked(manager.videoCapture.getTrack).mockReturnValue(null);
    const port = createMediaCapturePort(manager as never);
    await port.ensureTrack!("video");
    expect(manager.videoCapture.start).toHaveBeenCalledWith("cam-2");
  });

  it("returns null when the capture cannot start", async () => {
    manager.audioCapture.start.mockResolvedValue(false);
    const port = createMediaCapturePort(manager as never);
    const stream = await port.ensureTrack!("audio");
    expect(stream).toBeNull();
  });

  it("releases the kind's capture hardware on pause", async () => {
    const port = createMediaCapturePort(manager as never);
    await port.release!("video");
    await port.release!("audio");
    expect(manager.videoCapture.toggle).toHaveBeenCalledWith(false);
    expect(manager.audioCapture.toggle).toHaveBeenCalledWith(false);
  });

  it("notifies on capture state changes", () => {
    const port = createMediaCapturePort(manager as never);
    const listener = vi.fn();
    port.onStateChange!("video", listener);
    expect(manager.videoCapture.onStateChange).toHaveBeenCalled();
    manager.emitVideoState(2, null);
    expect(listener).toHaveBeenCalledWith(2);
  });
});
