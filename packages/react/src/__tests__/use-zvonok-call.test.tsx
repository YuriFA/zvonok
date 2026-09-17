import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useZvonokCall } from "../hooks/use-zvonok-call.js";
import type { UseZvonokConnectionResult } from "../hooks/use-zvonok-connection.js";
import {
  createMockMediaManager,
  createMockSfuManager,
  createTrack,
  type MockMediaManager,
  type MockSfuManager,
} from "./doubles.js";

const sessionDouble = vi.hoisted(() => ({ mediaManager: null as unknown }));

vi.mock("../contexts/zvonok-context.js", () => ({
  useZvonokSession: () => sessionDouble,
}));

type CallProps = Parameters<typeof useZvonokCall>[0];

/** Test seam: the mock simulator surface hiding behind the SfuManager type. */
function mockOf(connection: UseZvonokConnectionResult): MockSfuManager["manager"] {
  return connection.manager as unknown as MockSfuManager["manager"];
}

function createConnection(overrides: Record<string, unknown> = {}): UseZvonokConnectionResult {
  const { manager } = createMockSfuManager();
  return {
    status: "joined",
    error: null,
    join: vi.fn(),
    leave: vi.fn(),
    isRoomLocked: false,
    wasKicked: false,
    roomEnded: false,
    manager,
    produceTrack: vi.fn(async () => true),
    pauseProducer: vi.fn(),
    resumeProducer: vi.fn(),
    closeProducer: vi.fn(),
    replaceTrack: vi.fn(async () => true),
    hasProducer: vi.fn(() => false),
    ...overrides,
  } as unknown as UseZvonokConnectionResult;
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
    localStorage.clear();
  });

  it("publishes live captured tracks once joined", async () => {
    liveLocalTracks(mediaManager);
    const connection = createConnection();
    renderCall({ connection });
    await waitFor(() => expect(connection.produceTrack).toHaveBeenCalledTimes(2));
    expect(connection.resumeProducer).toHaveBeenCalledWith("video");
    expect(connection.resumeProducer).toHaveBeenCalledWith("audio");
  });

  it("does not publish before the join and not twice per join", async () => {
    liveLocalTracks(mediaManager);
    const joined = createConnection({ status: "connecting" });
    const utils = renderCall({ connection: joined });
    expect(joined.produceTrack).not.toHaveBeenCalled();

    const active = { ...joined, status: "joined" as const };
    await act(async () => {
      utils.rerender({ connection: active });
    });
    await waitFor(() => expect(joined.produceTrack).toHaveBeenCalledTimes(2));
    utils.rerender({ connection: active });
    expect(joined.produceTrack).toHaveBeenCalledTimes(2);
  });

  it("rolls the control back when re-acquiring the microphone fails", async () => {
    mediaManager.audioCapture.start.mockResolvedValue(false);
    const connection = createConnection();
    const utils = renderCall({ connection });
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(result).toBe("no-track");
    expect(utils.result.current.microphone.isEnabled).toBe(false);
    expect(connection.produceTrack).not.toHaveBeenCalled();
    expect(connection.resumeProducer).not.toHaveBeenCalled();
  });

  it("rolls the control back when the track replacement fails", async () => {
    const audio = createTrack("audio", "mic-1");
    vi.mocked(mediaManager.audioCapture.getTrack).mockReturnValueOnce(null);
    const connection = createConnection({
      hasProducer: vi.fn(() => true),
      replaceTrack: vi.fn(async () => false),
    });
    const utils = renderCall({ connection });
    expect(utils.result.current.microphone.isEnabled).toBe(false);

    vi.mocked(mediaManager.audioCapture.getTrack).mockReturnValue(audio);
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(result).toBe("replace-failed");
    expect(utils.result.current.microphone.isEnabled).toBe(false);
    expect(connection.resumeProducer).not.toHaveBeenCalled();
  });

  it("pauses the producer and releases capture hardware on toggle off", async () => {
    liveLocalTracks(mediaManager);
    const connection = createConnection({ hasProducer: vi.fn(() => true) });
    const utils = renderCall({ connection });
    let result: string | undefined;
    await act(async () => {
      result = await utils.result.current.microphone.toggle();
    });
    expect(result).toBe("paused");
    expect(connection.pauseProducer).toHaveBeenCalledWith("audio");
    expect(mediaManager.audioCapture.toggle).toHaveBeenCalledWith(false);
    expect(utils.result.current.microphone.isEnabled).toBe(false);
  });

  it("re-acquires capture through the default port when no live track exists", async () => {
    const audio = createTrack("audio", "mic-1");
    vi.mocked(mediaManager.audioCapture.getStream).mockReturnValue({
      getTracks: () => [audio],
    } as unknown as MediaStream);
    mediaManager.audioCapture.start.mockResolvedValue(true);
    const connection = createConnection();
    const utils = renderCall({ connection, capture: undefined });
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
    const connection = createConnection();
    const utils = renderCall({
      connection,
      autoPublish: false,
      localUserId: "user-1",
      onHostMuted,
    });
    expect(utils.result.current.microphone.isEnabled).toBe(true);

    const manager = mockOf(connection);
    await act(async () => {
      manager.getSocket()!.fire("sfu:peer-muted", { userId: "user-1" });
      manager.getSocket()!.fire("sfu:peer-muted", { userId: "user-1" });
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
    const connection = createConnection();
    const utils = renderCall({
      connection,
      localUserId: "user-1",
      localDisplayName: "Me",
    });
    expect(utils.result.current.camera.isEnabled).toBe(true);
    await act(async () => {
      mockOf(connection).emitPeerJoined("peer-2", "Bob");
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
    const connection = createConnection();
    const utils = renderCall({ connection });
    const manager = mockOf(connection);
    await act(async () => {
      manager.simulateConnected("connected");
      manager.simulateCapabilities(["host.mute", "host.kick"]);
    });
    expect(utils.result.current.connectionState).toBe("connected");
    expect(utils.result.current.capabilities).toEqual(["host.mute", "host.kick"]);
  });

  it("exposes host controls bound to the manager", async () => {
    const connection = createConnection();
    const utils = renderCall({ connection });
    await act(async () => {
      await utils.result.current.hostControls.kickPeer("peer-2");
    });
    expect(mockOf(connection).kickPeer).toHaveBeenCalledWith("peer-2");
  });
});
