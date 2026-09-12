import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemotePeerMedia } from "@/features/room/hooks/use-room-sfu";

import { useCallRecording } from "../use-call-recording";

// --- fakes (jsdom has no canvas/audio/MediaRecorder) ---

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  options?: { mimeType?: string };

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "video/webm" }) });
    this.onstop?.();
  }
}
class FakeMediaStream {
  tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
}
function makeLiveTrack(kind: "video" | "audio"): MediaStreamTrack {
  return { kind, readyState: "live", muted: false, stop: vi.fn() } as unknown as MediaStreamTrack;
}
class FakeAudioContext {
  createMediaStreamDestination() {
    return {
      stream: {
        getAudioTracks: () => [makeLiveTrack("audio")],
      },
    };
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  resume = vi.fn(async () => undefined);

  close = vi.fn(async () => undefined);
}

const fakeCanvasContext = {
  fillRect: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  measureText: vi.fn(() => ({ width: 10 })),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  fill: vi.fn(),
  font: "",
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  textAlign: "",
  textBaseline: "",
};

function makePeerStream(hasVideo: boolean, hasAudio: boolean): MediaStream {
  return {
    getVideoTracks: () => (hasVideo ? [makeLiveTrack("video")] : []),
    getAudioTracks: () => (hasAudio ? [makeLiveTrack("audio")] : []),
  } as unknown as MediaStream;
}

function makePeer(userId: string, overrides: Partial<RemotePeerMedia> = {}): RemotePeerMedia {
  return {
    userId,
    username: `User ${userId}`,
    cameraStream: makePeerStream(true, false),
    screenStream: null,
    audioStream: makePeerStream(false, true),
    isCameraEnabled: true,
    isScreenSharing: false,
    isAudioEnabled: true,
    mutedByHost: false,
    ...overrides,
  };
}

const localVideoStream = makePeerStream(true, false);
const localAudioStream = makePeerStream(false, true);

function renderCallRecording(remotePeers: RemotePeerMedia[]) {
  return renderHook(
    (props: { remotePeers: RemotePeerMedia[] }) =>
      useCallRecording({
        roomSlug: "my-room",
        localUserId: "me",
        localDisplayName: "Me",
        localVideoStream,
        localAudioStream,
        remotePeers: props.remotePeers,
        activeScreenShare: null,
        activeSpeakerId: null,
      }),
    { initialProps: { remotePeers } },
  );
}

describe("useCallRecording", () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeCanvasContext as unknown as CanvasRenderingContext2D,
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      value: () => ({
        getVideoTracks: () => [makeLiveTrack("video")],
        getTracks: () => [makeLiveTrack("video")],
      }),
      configurable: true,
      writable: true,
    });
    vi.spyOn(HTMLVideoElement.prototype, "play").mockImplementation(async () => {
      return undefined as never;
    });
    const anchorClick = vi.fn();
    vi.spyOn(HTMLElement.prototype, "click").mockImplementation(anchorClick);
    Object.defineProperty(window.URL, "createObjectURL", {
      value: vi.fn(() => "blob:mock"),
      configurable: true,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports unsupported when canvas captureStream is unavailable", () => {
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
    const { result } = renderCallRecording([]);
    expect(result.current.isSupported).toBe(false);
  });

  it("keeps one recorder across membership changes while recording", () => {
    const { result, rerender } = renderCallRecording([makePeer("peer-1")]);

    act(() => {
      result.current.start();
    });
    expect(result.current.state).toBe("recording");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    const recorder = FakeMediaRecorder.instances[0];

    // A late joiner joins and another one leaves mid-recording.
    rerender({ remotePeers: [makePeer("peer-2"), makePeer("peer-3")] });

    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0]).toBe(recorder);

    act(() => {
      result.current.stop();
    });
    expect(recorder.state).toBe("inactive");
    expect(result.current.state).toBe("idle");
  });

  it("stops and saves on unmount while recording", () => {
    const { result, unmount } = renderCallRecording([makePeer("peer-1")]);

    act(() => {
      result.current.start();
    });
    const recorder = FakeMediaRecorder.instances[0];

    unmount();

    expect(recorder.state).toBe("inactive");
  });
});
