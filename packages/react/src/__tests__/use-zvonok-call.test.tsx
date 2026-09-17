import { act, renderHook, waitFor } from "@testing-library/react";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionStore } from "../core/session-store.js";
import { useZvonokCall } from "../hooks/use-zvonok-call.js";
import type { UseZvonokConnectionResult } from "../hooks/use-zvonok-connection.js";
import {
  createMockMediaManager,
  createMockSfuManager,
  createTrack,
  type MockMediaManager,
  type MockSfuManager,
} from "./doubles.js";

const sessionDouble = vi.hoisted(() => ({
  mediaManager: null as unknown,
  store: null as unknown as { setManager(manager: unknown): void },
}));

vi.mock("../contexts/zvonok-context.js", () => ({
  useZvonokSession: () => sessionDouble,
}));

type CallProps = Parameters<typeof useZvonokCall>[0];

function createConnection(overrides: Record<string, unknown> = {}): UseZvonokConnectionResult {
  return {
    status: "joined",
    error: null,
    join: vi.fn(),
    leave: vi.fn(),
    isRoomLocked: false,
    wasKicked: false,
    roomEnded: false,
    ...overrides,
  } as unknown as UseZvonokConnectionResult;
}

/** Installs a fresh mock manager through the session store's front door. */
function attachManager(): MockSfuManager {
  const sfu = createMockSfuManager();
  sessionDouble.store.setManager(sfu.manager as unknown as SfuManager);
  return sfu;
}

function liveLocalTracks(manager: MockMediaManager) {
  const video = createTrack("video", "cam-1");
  const audio = createTrack("audio", "mic-1");
  const videoStream = { getTracks: () => [video] } as unknown as MediaStream;
  const audioStream = { getTracks: () => [audio] } as unknown as MediaStream;
  vi.mocked(manager.videoCapture.getTrack).mockReturnValue(video);
  vi.mocked(manager.audioCapture.getTrack).mockReturnValue(audio);
  vi.mocked(manager.videoCapture.getStream).mockReturnValue(videoStream);
  vi.mocked(manager.audioCapture.getStream).mockReturnValue(audioStream);
}

function renderCall(options: CallProps) {
  return renderHook((props: CallProps) => useZvonokCall(props), {
    initialProps: options,
  });
}

describe("useZvonokCall", () => {
  let mediaManager: MockMediaManager;

  beforeEach(() => {
    mediaManager = createMockMediaManager();
    sessionDouble.mediaManager = mediaManager;
    sessionDouble.store = new SessionStore();
    localStorage.clear();
  });

  it("publishes live captured tracks once joined", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    renderCall({ connection: createConnection() });
    await waitFor(() => expect(sfu.manager.produce).toHaveBeenCalledTimes(2));
    expect(sfu.manager.resumeProducer).toHaveBeenCalledWith("video-producer");
    expect(sfu.manager.resumeProducer).toHaveBeenCalledWith("audio-producer");
  });

  it("does not publish before the join and not twice per join", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    const joined = createConnection({ status: "connecting" });
    const utils = renderCall({ connection: joined });
    expect(sfu.manager.produce).not.toHaveBeenCalled();

    const active = { ...joined, status: "joined" as const };
    await act(async () => {
      utils.rerender({ connection: active });
    });
    await waitFor(() => expect(sfu.manager.produce).toHaveBeenCalledTimes(2));
    utils.rerender({ connection: active });
    expect(sfu.manager.produce).toHaveBeenCalledTimes(2);
  });

  it("rolls the control back when re-acquiring the microphone fails", async () => {
    mediaManager.audioCapture.start.mockResolvedValue(false);
    const sfu = attachManager();
    const utils = renderCall({ connection: createConnection() });
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(result).toBe("no-track");
    expect(utils.result.current.microphone.isEnabled).toBe(false);
    expect(sfu.manager.produce).not.toHaveBeenCalled();
    expect(sfu.manager.resumeProducer).not.toHaveBeenCalled();
  });

  it("rolls the control back when the track replacement fails", async () => {
    const audio = createTrack("audio", "mic-1");
    vi.mocked(mediaManager.audioCapture.getTrack).mockReturnValueOnce(null);
    const sfu = attachManager();
    sfu.manager.getProducerByKind.mockReturnValue({ id: "audio-producer" });
    sfu.manager.replaceTrack.mockResolvedValue(false);
    const utils = renderCall({ connection: createConnection() });
    expect(utils.result.current.microphone.isEnabled).toBe(false);

    vi.mocked(mediaManager.audioCapture.getTrack).mockReturnValue(audio);
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(result).toBe("replace-failed");
    expect(utils.result.current.microphone.isEnabled).toBe(false);
    expect(sfu.manager.resumeProducer).not.toHaveBeenCalled();
  });

  it("pauses the producer and releases capture hardware on toggle off", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    sfu.manager.getProducerByKind.mockReturnValue({ id: "audio-producer" });
    const utils = renderCall({ connection: createConnection() });
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(result).toBe("paused");
    expect(sfu.manager.pauseProducer).toHaveBeenCalledWith("audio-producer");
    expect(mediaManager.audioCapture.toggle).toHaveBeenCalledWith(false);
    expect(utils.result.current.microphone.isEnabled).toBe(false);
  });

  it("re-acquires capture through the default port when no live track exists", async () => {
    const audio = createTrack("audio", "mic-1");
    vi.mocked(mediaManager.audioCapture.getStream).mockReturnValue({
      getTracks: () => [audio],
    } as unknown as MediaStream);
    mediaManager.audioCapture.start.mockResolvedValue(true);
    attachManager();
    const utils = renderCall({ connection: createConnection(), capture: undefined });
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(mediaManager.audioCapture.start).toHaveBeenCalled();
    expect(result).toBe("published");
    expect(utils.result.current.microphone.isEnabled).toBe(true);
  });

  it("forces the microphone off and notifies once per host mute", async () => {
    liveLocalTracks(mediaManager);
    const onHostMuted = vi.fn();
    const sfu = attachManager();
    const utils = renderCall({
      connection: createConnection(),
      autoPublish: false,
      localUserId: "user-1",
      onHostMuted,
    });
    expect(utils.result.current.microphone.isEnabled).toBe(true);

    await act(async () => {
      sfu.manager.getSocket()!.fire("sfu:peer-muted", { userId: "user-1" });
      sfu.manager.getSocket()!.fire("sfu:peer-muted", { userId: "user-1" });
    });
    await waitFor(() => {
      expect(utils.result.current.mutedByHost).toBe(true);
      expect(utils.result.current.microphone.isEnabled).toBe(false);
    });
    expect(onHostMuted).toHaveBeenCalledTimes(1);
  });

  it("releases capture and notifies once when kicked", async () => {
    liveLocalTracks(mediaManager);
    const onKicked = vi.fn();
    const connection = createConnection({ wasKicked: true });
    renderCall({ connection, onKicked });
    await waitFor(() => expect(onKicked).toHaveBeenCalledTimes(1));
    expect(mediaManager.videoCapture.toggle).toHaveBeenCalledWith(false);
    expect(mediaManager.audioCapture.toggle).toHaveBeenCalledWith(false);
  });

  it("projects the local participant ahead of remote participants", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    const utils = renderCall({
      connection: createConnection(),
      localUserId: "user-1",
      localDisplayName: "Me",
    });
    expect(utils.result.current.camera.isEnabled).toBe(true);
    await act(async () => {
      sfu.manager.emitPeerJoined("peer-2", "Bob");
    });
    const { participants } = utils.result.current;
    expect(participants).toHaveLength(2);
    expect(participants[0]).toMatchObject({
      userId: "user-1",
      displayName: "Me",
      isCameraEnabled: true,
      cameraStream: expect.anything(),
    });
    expect(participants[1]).toMatchObject({ userId: "peer-2", displayName: "Bob" });
  });

  it("mirrors the manager connection state and capabilities", async () => {
    const sfu = attachManager();
    const utils = renderCall({ connection: createConnection() });
    await act(async () => {
      sfu.manager.simulateConnected("connected");
      sfu.manager.simulateCapabilities(["host.mute", "host.kick"]);
    });
    expect(utils.result.current.connectionState).toBe("connected");
    expect(utils.result.current.capabilities).toEqual(["host.mute", "host.kick"]);
  });

  it("exposes host controls bound to the manager", async () => {
    const sfu = attachManager();
    const utils = renderCall({ connection: createConnection() });
    await act(async () => {
      await utils.result.current.hostControls.kickPeer("peer-2");
    });
    expect(sfu.manager.kickPeer).toHaveBeenCalledWith("peer-2");
  });

  it("pauses the video producer while hidden and resumes the user's camera on return", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    sfu.manager.getProducerByKind.mockReturnValue({ id: "video-producer" });
    const utils = renderCall({
      connection: createConnection(),
      pauseVideoWhenHidden: true,
    });
    expect(utils.result.current.camera.isEnabled).toBe(true);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sfu.manager.pauseProducer).toHaveBeenCalledWith("video-producer");

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sfu.manager.resumeProducer).toHaveBeenCalledWith("video-producer");
  });

  it("does not resume a camera the user had disabled before hiding", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    sfu.manager.getProducerByKind.mockReturnValue({ id: "video-producer" });
    const utils = renderCall({
      connection: createConnection(),
      pauseVideoWhenHidden: true,
    });
    await act(async () => {
      await utils.result.current.camera.toggle();
    });
    expect(utils.result.current.camera.isEnabled).toBe(false);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sfu.manager.resumeProducer).not.toHaveBeenCalled();
  });

  it("leaves producer state untouched when the pause option is omitted", async () => {
    liveLocalTracks(mediaManager);
    const sfu = attachManager();
    sfu.manager.getProducerByKind.mockReturnValue({ id: "video-producer" });
    renderCall({ connection: createConnection() });

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(sfu.manager.pauseProducer).not.toHaveBeenCalled();
  });
});
