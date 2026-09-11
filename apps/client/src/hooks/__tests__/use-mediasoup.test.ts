import { act, renderHook, waitFor } from "@testing-library/react";
import type { SfuState } from "@zvonok/client/sfu/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

vi.stubGlobal("MediaStream", MockMediaStream);

const testContext = vi.hoisted(() => ({
  baseState: {
    connectionState: "disconnected",
    isDeviceLoaded: false,
    sendTransportConnected: false,
    recvTransportConnected: false,
    audioProducerId: null,
    videoProducerId: null,
    screenProducerId: null,
    isScreenShareBlocked: false,
  } as SfuState,
}));

const mockUseAuth = vi.hoisted(() => vi.fn());
const sfuMock = vi.hoisted(() => {
  const { baseState } = testContext;
  let currentState = { ...baseState };
  const stateListeners = new Set<(state: typeof baseState) => void>();
  const trackListeners = new Set<
    (
      track: MediaStreamTrack,
      kind: "audio" | "video",
      userId: string,
      source?: "camera" | "screen",
    ) => void
  >();
  const peerJoinedListeners = new Set<
    (peer: {
      userId: string;
      username: string;
      producers: Map<string, { kind: "audio" | "video" }>;
    }) => void
  >();
  const peerLeftListeners = new Set<(userId: string) => void>();
  const kickedListeners = new Set<(payload: { roomId: string }) => void>();
  const producerStateChangeListeners = new Set<
    (payload: { userId: string; kind: "audio" | "video"; paused: boolean }) => void
  >();
  const screenShareStoppedListeners = new Set<(payload: { userId: string }) => void>();

  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    leaveRoom: vi.fn(),
    kickPeer: vi.fn(),
    joinRoom: vi.fn().mockResolvedValue(undefined),
    hasJoinedSession: vi.fn(() => false),
    produce: vi.fn().mockImplementation(async (track: MediaStreamTrack) => ({
      id: `${track.kind}-producer`,
      kind: track.kind,
    })),
    produceScreen: vi.fn().mockImplementation(async (_track: MediaStreamTrack) => ({
      id: "screen-producer",
      kind: "video",
    })),
    closeScreenProducer: vi.fn(),
    isScreenShareBlocked: vi.fn(() => false),
    onProduceError: vi.fn(() => () => {}),
    onJoinError: vi.fn(() => () => {}),
    pauseProducer: vi.fn(),
    resumeProducer: vi.fn(),
    replaceTrack: vi.fn().mockResolvedValue(true),
    getProducerByKind: vi.fn(),
    getState: vi.fn(() => currentState),
    onStateChange: vi.fn((callback: (state: typeof baseState) => void) => {
      stateListeners.add(callback);
      callback(currentState);
      return () => stateListeners.delete(callback);
    }),
    onTrack: vi.fn(
      (
        callback: (
          track: MediaStreamTrack,
          kind: "audio" | "video",
          userId: string,
          source?: "camera" | "screen",
        ) => void,
      ) => {
        trackListeners.add(callback);
        return () => trackListeners.delete(callback);
      },
    ),
    onParticipantJoined: vi.fn(
      (
        callback: (peer: {
          userId: string;
          username: string;
          producers: Map<string, { kind: "audio" | "video" }>;
        }) => void,
      ) => {
        peerJoinedListeners.add(callback);
        return () => peerJoinedListeners.delete(callback);
      },
    ),
    onParticipantLeft: vi.fn((callback: (userId: string) => void) => {
      peerLeftListeners.add(callback);
      return () => peerLeftListeners.delete(callback);
    }),
    onKicked: vi.fn((callback: (payload: { roomId: string }) => void) => {
      kickedListeners.add(callback);
      return () => kickedListeners.delete(callback);
    }),
    onProducerStateChange: vi.fn(
      (
        callback: (payload: { userId: string; kind: "audio" | "video"; paused: boolean }) => void,
      ) => {
        producerStateChangeListeners.add(callback);
        return () => producerStateChangeListeners.delete(callback);
      },
    ),
    onScreenShareStopped: vi.fn((callback: (payload: { userId: string }) => void) => {
      screenShareStoppedListeners.add(callback);
      return () => screenShareStoppedListeners.delete(callback);
    }),
    emitState(state: typeof baseState) {
      currentState = state;
      stateListeners.forEach((callback) => {
        callback(state);
      });
    },
    emitTrack(
      track: MediaStreamTrack,
      kind: "audio" | "video",
      userId: string,
      source?: "camera" | "screen",
    ) {
      trackListeners.forEach((callback) => {
        callback(track, kind, userId, source);
      });
    },
    emitPeerJoined(peer: {
      userId: string;
      username: string;
      producers: Map<string, { kind: "audio" | "video" }>;
    }) {
      peerJoinedListeners.forEach((callback) => {
        callback(peer);
      });
    },
    emitPeerLeft(userId: string) {
      peerLeftListeners.forEach((callback) => {
        callback(userId);
      });
    },
    emitKicked(payload: { roomId: string }) {
      kickedListeners.forEach((callback) => {
        callback(payload);
      });
    },
    emitProducerStateChange(payload: { userId: string; kind: "audio" | "video"; paused: boolean }) {
      producerStateChangeListeners.forEach((callback) => {
        callback(payload);
      });
    },
    emitScreenShareStopped(payload: { userId: string }) {
      screenShareStoppedListeners.forEach((callback) => {
        callback(payload);
      });
    },
    reset() {
      currentState = { ...baseState };
      stateListeners.clear();
      trackListeners.clear();
      peerJoinedListeners.clear();
      peerLeftListeners.clear();
      kickedListeners.clear();
      producerStateChangeListeners.clear();
      screenShareStoppedListeners.clear();
      this.connect.mockClear();
      this.disconnect.mockClear();
      this.leaveRoom.mockClear();
      this.kickPeer.mockClear();
      this.joinRoom.mockClear();
      this.produce.mockClear();
      this.produceScreen.mockClear();
      this.closeScreenProducer.mockClear();
      this.isScreenShareBlocked.mockImplementation(() => false);
      this.pauseProducer.mockClear();
      this.resumeProducer.mockClear();
      this.replaceTrack.mockReset();
      this.replaceTrack.mockResolvedValue(true);
      this.getProducerByKind.mockReset();
      this.getState.mockImplementation(() => currentState);
      this.onStateChange.mockClear();
      this.onTrack.mockClear();
      this.onParticipantJoined.mockClear();
      this.onParticipantLeft.mockClear();
      this.onKicked.mockClear();
      this.onProducerStateChange.mockClear();
      this.onScreenShareStopped.mockClear();
    },
  };
});

vi.mock("@/features/auth/contexts/auth.context", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("@/features/sfu/contexts/sfu-manager.context", () => ({
  useSfuManager: () => sfuMock,
}));

import { useMediasoup } from "../use-mediasoup";

const createTrack = (id: string, kind: "audio" | "video") =>
  ({
    id,
    kind,
    enabled: true,
    onmute: null,
    onunmute: null,
    onended: null,
  }) as unknown as MediaStreamTrack;

describe("useMediasoup", () => {
  const { baseState } = testContext;

  beforeEach(() => {
    sfuMock.reset();
    mockUseAuth.mockReturnValue({
      user: {
        id: "user-1",
        username: "alice",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connects, joins the room, and produces local tracks after send transport is ready", async () => {
    const videoTrack = createTrack("video-1", "video");
    const audioTrack = createTrack("audio-1", "audio");
    const localVideoStream = new MockMediaStream([videoTrack]) as unknown as MediaStream;
    const localAudioStream = new MockMediaStream([audioTrack]) as unknown as MediaStream;

    renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream,
        localAudioStream,
        enabled: true,
        displayName: "alice",
      }),
    );

    expect(sfuMock.connect).toHaveBeenCalled();

    act(() => {
      sfuMock.emitState({
        ...baseState,
        connectionState: "connected",
      });
    });

    await waitFor(() => {
      expect(sfuMock.joinRoom).toHaveBeenCalledWith({
        roomId: "room-1",
      });
    });

    act(() => {
      sfuMock.emitState({
        ...baseState,
        connectionState: "connected",
        isSendTransportCreated: true,
      });
    });

    await waitFor(() => {
      expect(sfuMock.produce).toHaveBeenCalledTimes(2);
    });

    expect(sfuMock.produce).toHaveBeenCalledWith(videoTrack, { isMobile: false });
    expect(sfuMock.produce).toHaveBeenCalledWith(audioTrack, { isMobile: false });
  });

  it("collects remote peer media and removes it when the peer leaves", async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream: null,
        localAudioStream: null,
        enabled: true,
      }),
    );

    act(() => {
      sfuMock.emitPeerJoined({
        userId: "user-2",
        username: "bob",
        producers: new Map(),
      });
    });

    const videoTrack = createTrack("remote-video", "video");
    const audioTrack = createTrack("remote-audio", "audio");

    act(() => {
      sfuMock.emitTrack(videoTrack, "video", "user-2");
      sfuMock.emitTrack(audioTrack, "audio", "user-2");
    });

    await waitFor(() => {
      expect(result.current.remotePeers).toHaveLength(1);
    });

    expect(result.current.remotePeers[0]?.username).toBe("bob");
    expect(result.current.remotePeers[0]?.cameraStream.getTracks()).toHaveLength(1);
    expect(result.current.remotePeers[0]?.audioStream.getTracks()).toHaveLength(1);

    act(() => {
      sfuMock.emitPeerLeft("user-2");
    });

    await waitFor(() => {
      expect(result.current.remotePeers).toHaveLength(0);
    });
  });

  it("sets wasKicked and clears remote peers when kicked event fires", async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream: null,
        localAudioStream: null,
        enabled: true,
      }),
    );

    act(() => {
      sfuMock.emitPeerJoined({ userId: "user-2", username: "bob", producers: new Map() });
    });

    await waitFor(() => {
      expect(result.current.remotePeers).toHaveLength(1);
    });

    act(() => {
      sfuMock.emitKicked({ roomId: "room-1" });
    });

    await waitFor(() => {
      expect(result.current.wasKicked).toBe(true);
      expect(result.current.remotePeers).toHaveLength(0);
    });
  });

  it("exposes pauseProducer and resumeProducer that delegate to sfuManager", async () => {
    sfuMock.getProducerByKind.mockReturnValue({ id: "video-producer" });

    const { result } = renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream: null,
        localAudioStream: null,
        enabled: true,
      }),
    );

    act(() => {
      result.current.pauseProducer("video");
    });

    expect(sfuMock.pauseProducer).toHaveBeenCalledWith("video-producer");

    act(() => {
      result.current.resumeProducer("video");
    });

    expect(sfuMock.resumeProducer).toHaveBeenCalledWith("video-producer");
  });

  it("exposes replaceTrack that delegates to sfuManager", async () => {
    const newTrack = createTrack("video-2", "video");

    const { result } = renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream: null,
        localAudioStream: null,
        enabled: true,
      }),
    );

    let success = false;
    await act(async () => {
      success = await result.current.replaceTrack("video", newTrack);
    });

    expect(success).toBe(true);
    expect(sfuMock.replaceTrack).toHaveBeenCalledWith("video", newTrack);
  });

  it("exposes hasProducer that reflects sfuManager.getProducerByKind", () => {
    sfuMock.getProducerByKind.mockReturnValue({ id: "audio-producer" });

    const { result } = renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream: null,
        localAudioStream: null,
        enabled: true,
      }),
    );

    expect(result.current.hasProducer("audio")).toBe(true);

    sfuMock.getProducerByKind.mockReturnValue(undefined);
    expect(result.current.hasProducer("video")).toBe(false);
  });
});
