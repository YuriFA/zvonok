import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureState } from "@zvonok/client/media/capture-state";
import { ZvonokJoinError } from "../errors.js";
import {
  ZvonokEmbeddedRoom,
  type ZvonokEmbeddedRoomProps,
} from "../embedded/ZvonokEmbeddedRoom.js";
import {
  createMockMediaManager,
  createMockScreenShareService,
  createMockSfuManager,
  createTrack,
  stubMatchMedia,
  tokenFor,
  type MockMediaManager,
  type MockScreenShareService,
  type MockSfuManager,
} from "./doubles.js";

const sfuHarness = vi.hoisted(() => ({ instances: [] as unknown[] }));
const mediaHarness = vi.hoisted(() => ({ instances: [] as unknown[] }));
const screenShareHarness = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("@zvonok/client/sfu/manager", () => {
  const SfuManagerModule = {
    SfuManager: vi.fn(function () {
      const mock = createMockSfuManager();
      sfuHarness.instances.push(mock);
      return mock.manager;
    }),
  };
  return {
    SfuManager: SfuManagerModule.SfuManager,
    createSfuManager: vi.fn(() => new SfuManagerModule.SfuManager()),
  };
});
vi.mock("@zvonok/client/media/manager-factory", () => ({
  createMediaManager: () => {
    const instance = createMockMediaManager();
    mediaHarness.instances.push(instance);
    return instance;
  },
}));
vi.mock("@zvonok/client/screen-share/service", () => ({
  ScreenShareService: vi.fn(function () {
    // The client's mock factory predates `destroy()`; add the cleanup hook.
    const instance = Object.assign(createMockScreenShareService(), {
      destroy: vi.fn(),
    });
    screenShareHarness.instances.push(instance);
    return instance;
  }),
  browserDisplayMediaService: { getDisplayMedia: vi.fn() },
}));
vi.mock("@zvonok/client/audio/remote-audio-mixer", () => ({
  RemoteAudioMixer: vi.fn(function () {
    return {
      addPeer: vi.fn(),
      removePeer: vi.fn(),
      updatePeerTrack: vi.fn(),
      setGain: vi.fn(),
      setSink: vi.fn(async () => true),
      getAnalyser: vi.fn(() => undefined),
      destroy: vi.fn(),
    };
  }),
}));
vi.mock("@zvonok/client/audio/audio-level-sampler", () => ({
  AudioLevelSampler: vi.fn(function () {
    return {
      addOwned: vi.fn(),
      addBorrowed: vi.fn(),
      remove: vi.fn(),
      ids: vi.fn(() => []),
      sample: vi.fn(() => new Map()),
      clear: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));
vi.mock("@zvonok/client/audio/active-speaker-detector", () => ({
  ActiveSpeakerDetector: vi.fn(function () {
    return { detect: vi.fn(() => null), reset: vi.fn() };
  }),
}));

const TOKEN = tokenFor({ participantId: "participant-9", roomId: "room-1" });

function lastSfu(): MockSfuManager {
  return sfuHarness.instances.at(-1) as MockSfuManager;
}

function lastMedia(): MockMediaManager {
  return mediaHarness.instances.at(-1) as MockMediaManager;
}

function lastScreenShareService(): MockScreenShareService {
  return screenShareHarness.instances.at(-1) as MockScreenShareService;
}

/** Flushes the microtask and timer queue so in-flight async joins settle. */
async function flush() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function renderJoined(props?: Partial<ZvonokEmbeddedRoomProps>) {
  const view = render(
    <ZvonokEmbeddedRoom
      serverUrl="https://sfu.test"
      roomSlug="room-1"
      token={TOKEN}
      skipPrejoin
      {...props}
    />,
  );
  await flush();
  act(() => {
    lastSfu().socket.fire("sfu:joined");
  });
  await flush();
  return view;
}

describe("ZvonokEmbeddedRoom", () => {
  beforeEach(() => {
    sfuHarness.instances.length = 0;
    mediaHarness.instances.length = 0;
    screenShareHarness.instances.length = 0;
    stubMatchMedia(false);
  });

  it("auto-joins with skipPrejoin and renders local and remote tiles", async () => {
    const view = await renderJoined();

    act(() => {
      lastSfu().manager.emitPeerJoined("peer-1", "Alice");
      lastSfu().manager.emitTrack(
        createTrack("video", "cam-1"),
        "video",
        "peer-1",
      );
      lastSfu().manager.emitTrack(
        createTrack("audio", "mic-1"),
        "audio",
        "peer-1",
      );
      lastMedia().emitVideoState(
        CaptureState.ACTIVE,
        createTrack("video", "cam-local"),
      );
    });

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("You (you)")).toBeTruthy();
    expect(screen.getByText("2 participants")).toBeTruthy();
    expect(view.container.querySelectorAll("audio")).toHaveLength(0);
    expect(screen.queryByText("Join room")).toBeNull();
  });

  it("publishes the active local tracks once joined", async () => {
    render(
      <ZvonokEmbeddedRoom
        serverUrl="https://sfu.test"
        roomSlug="room-1"
        token={TOKEN}
        skipPrejoin
      />,
    );
    // Seed the captures before the join completes so the initial publish
    // observes active tracks.
    const video = createTrack("video", "cam-local");
    const audio = createTrack("audio", "mic-local");
    const media = lastMedia();
    media.videoCapture.getState.mockReturnValue(CaptureState.ACTIVE);
    (media.videoCapture.getTrack as Mock).mockReturnValue(video);
    media.audioCapture.getState.mockReturnValue(CaptureState.ACTIVE);
    (media.audioCapture.getTrack as Mock).mockReturnValue(audio);
    await flush();
    lastSfu().manager.getProducerByKind.mockImplementation(
      (kind: "audio" | "video") => ({
        id: `${kind}-producer`,
      }),
    );
    act(() => {
      lastSfu().socket.fire("sfu:joined");
    });
    await flush();

    expect(lastSfu().manager.produce).toHaveBeenCalledWith(video, undefined);
    expect(lastSfu().manager.produce).toHaveBeenCalledWith(audio, undefined);
    expect(lastSfu().manager.resumeProducer).toHaveBeenCalledWith(
      "video-producer",
    );
    expect(lastSfu().manager.resumeProducer).toHaveBeenCalledWith(
      "audio-producer",
    );
  });

  it("renders the typed join error state and calls onError", async () => {
    const onError = vi.fn();
    render(
      <ZvonokEmbeddedRoom
        serverUrl="https://sfu.test"
        roomSlug="room-1"
        token={TOKEN}
        skipPrejoin
        onError={onError}
      />,
    );
    await flush();

    act(() => {
      lastSfu().socket.fire("sfu:join-error", {
        code: "ROOM_TOKEN_INVALID",
        message: "The room token is not valid",
      });
    });
    await flush();

    expect(screen.getByText("Could not join the room")).toBeTruthy();
    expect(screen.getByText("ROOM_TOKEN_INVALID")).toBeTruthy();
    expect(screen.getByText("The room token is not valid")).toBeTruthy();
    expect(screen.queryByText("2 participants")).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(ZvonokJoinError);
  });

  it("pauses producers and flips capture state from the room controls", async () => {
    await renderJoined();

    const audioTrack = createTrack("audio", "mic-1");
    const cameraTrack = createTrack("video", "cam-1");
    act(() => {
      lastMedia().emitAudioState(CaptureState.ACTIVE, audioTrack);
      lastMedia().emitVideoState(CaptureState.ACTIVE, cameraTrack);
    });
    const micButton = screen.getByRole("button", { name: "Mic" });
    const cameraButton = screen.getByRole("button", { name: "Camera" });
    expect(micButton.getAttribute("aria-pressed")).toBe("true");

    lastSfu().manager.getProducerByKind.mockReturnValue({
      id: "audio-producer",
    });
    fireEvent.click(micButton);
    await flush();
    act(() => {
      lastMedia().emitAudioState(CaptureState.STOPPED, null);
    });
    expect(lastMedia().audioCapture.toggle).toHaveBeenCalledWith(false);
    expect(lastSfu().manager.pauseProducer).toHaveBeenCalledWith(
      "audio-producer",
    );
    expect(micButton.getAttribute("aria-pressed")).toBe("false");

    lastSfu().manager.getProducerByKind.mockReturnValue({
      id: "video-producer",
    });
    fireEvent.click(cameraButton);
    await flush();
    expect(lastSfu().manager.pauseProducer).toHaveBeenCalledWith(
      "video-producer",
    );

    lastSfu().manager.getProducerByKind.mockReturnValue(undefined);
    (lastMedia().audioCapture.getTrack as Mock).mockReturnValue(
      createTrack("audio", "mic-2"),
    );
    fireEvent.click(micButton);
    await flush();
    expect(lastMedia().audioCapture.toggle).toHaveBeenLastCalledWith(true);
    expect(lastSfu().manager.produce).toHaveBeenCalledWith(
      createTrack("audio", "mic-2"),
      undefined,
    );
  });

  it("collects the name and device choices in the pre-join card", async () => {
    render(
      <ZvonokEmbeddedRoom
        serverUrl="https://sfu.test"
        roomSlug="room-1"
        token={TOKEN}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Your name"), {
      target: { value: "Alice" },
    });
    const cameraToggle = screen.getByRole("button", { name: "Camera" });
    fireEvent.click(cameraToggle);
    expect(cameraToggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await flush();

    expect(lastMedia().start).toHaveBeenCalledWith({
      video: false,
      audio: true,
    });
    act(() => {
      lastSfu().socket.fire("sfu:joined");
    });
    await flush();

    expect(screen.getByText("Alice (you)")).toBeTruthy();
    expect(screen.queryByText("Join room")).toBeNull();
  });

  it("renders no record control without the start-recording capability", async () => {
    await renderJoined();

    expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
  });

  it("records through the egress controls when the capability is granted", async () => {
    await renderJoined();

    act(() => {
      lastSfu().manager.simulateCapabilities([
        "send-audio",
        "send-video",
        "start-recording",
      ]);
    });
    const recordButton = screen.getByRole("button", { name: "Record" });
    expect(recordButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(recordButton);
    await flush();
    expect(lastSfu().manager.startEgress).toHaveBeenCalledWith({
      record: true,
    });

    act(() => {
      lastSfu().manager.simulateEgressStatus({
        sessionId: "egress-1",
        outputs: { record: true, hls: false },
        status: "live",
      });
    });
    const stopButton = screen.getByRole("button", { name: "Stop recording" });
    expect(stopButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(stopButton);
    await flush();
    expect(lastSfu().manager.stopEgress).toHaveBeenCalledWith();
  });

  it("skips the pre-join card when displayName is provided", async () => {
    render(
      <ZvonokEmbeddedRoom
        serverUrl="https://sfu.test"
        roomSlug="room-1"
        token={TOKEN}
        displayName="Bob"
      />,
    );

    expect(screen.queryByPlaceholderText("Your name")).toBeNull();

    await flush();
    act(() => {
      lastSfu().socket.fire("sfu:joined");
    });
    await flush();

    expect(screen.queryByText("Join room")).toBeNull();
    expect(lastMedia().start).toHaveBeenCalledWith({
      video: true,
      audio: true,
    });
    expect(screen.getByText("Bob (you)")).toBeTruthy();
  });

  it("gates screen share and renders a friendly blocked notice", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn() } });
    await renderJoined();

    const service = lastScreenShareService();
    const shareButton = screen.getByRole("button", { name: "Share screen" });

    act(() => {
      service.setState({ isScreenShareBlocked: true });
    });
    expect((shareButton as HTMLButtonElement).disabled).toBe(true);
    (service.start as Mock).mockRejectedValueOnce("blocked");
    act(() => {
      service.setState({ isScreenShareBlocked: false });
    });
    (service.start as Mock).mockRejectedValueOnce("blocked");
    fireEvent.click(shareButton);
    await flush();

    const notice = screen.getByRole("alert");
    expect(notice.textContent).toBe(
      "Another participant is already sharing their screen",
    );

    act(() => {
      service.setState({ isSharing: true, screenStream: new MediaStream() });
    });
    expect(shareButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(shareButton);
    expect(service.stop).toHaveBeenCalled();
  });

  it("declares the embedded and css export paths in the manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      exports: Record<string, string>;
      publishConfig: { exports: Record<string, string> };
      sideEffects: string[];
    };

    expect(manifest.exports["./embedded"]).toBeTruthy();
    expect(manifest.exports["./css/component-kit.css"]).toBe(
      "./src/css/component-kit.css",
    );
    expect(manifest.exports["./css/embedded.css"]).toBe("./src/css/embedded.css");
    expect(manifest.publishConfig.exports["./css/embedded.css"]).toBe(
      "./dist/css/embedded.css",
    );
    expect(manifest.sideEffects).toContain("*.css");
  });
});
