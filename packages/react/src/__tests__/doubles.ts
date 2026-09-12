/**
 * Test doubles for the @zvonok/react suite: mock SfuManager, mock socket,
 * mock media manager, and a MediaStream stub for jsdom.
 */

import { vi } from "vitest";

import type { CaptureState } from "@zvonok/client/media/capture-state";

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

export type MockSocket = ReturnType<typeof createMockSocket>;

export function createMockSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const emissions: Array<{ event: string; payload: unknown }> = [];
  const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler);
  });
  const off = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    handlers.get(event)?.delete(handler);
  });
  return {
    on,
    off,
    emit: vi.fn((event: string, payload?: unknown) => {
      emissions.push({ event, payload });
    }),
    fire(event: string, payload?: unknown): void {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    emissions,
  };
}

export type MockSfuManager = ReturnType<typeof createMockSfuManager>;

type StateListener = (state: Record<string, unknown>) => void;
type TrackListener = (
  track: MediaStreamTrack,
  kind: "audio" | "video",
  userId: string,
  source?: "camera" | "screen",
) => void;

export function createMockSfuManager() {
  const socket = createMockSocket();
  const stateListeners = new Set<StateListener>();
  const trackListeners = new Set<TrackListener>();
  const peerJoinedListeners = new Set<
    (peer: { userId: string; username: string }) => void
  >();
  const peerLeftListeners = new Set<(userId: string) => void>();
  const kickedListeners = new Set<(payload: { roomId: string }) => void>();
  const roomEndedListeners = new Set<(payload: { roomId: string }) => void>();
  const producerStateListeners = new Set<
    (payload: {
      userId: string;
      kind: "audio" | "video";
      paused: boolean;
      source?: "camera" | "screen";
    }) => void
  >();
  const screenShareStoppedListeners = new Set<
    (payload: { userId: string }) => void
  >();
  const produceErrorListeners = new Set<(code: string) => void>();
  const reconnectErrorListeners = new Set<
    (error: { code: string; message: string }) => void
  >();
  const guestJoinRequestListeners = new Set<
    (payload: { requestId: string; displayName: string }) => void
  >();
  const broadcastListeners = new Set<
    (message: {
      senderId: string;
      topic: string;
      payload: unknown;
      timestamp: string;
    }) => void
  >();

  let connectionState = "disconnected";
  let capabilities: string[] = [];
  let egress: Record<string, unknown> | null = null;
  let localUserId: string | null = null;

  const manager = {
    connect: vi.fn(() => {
      connectionState = "connected";
      stateListeners.forEach((listener) =>
        listener({ connectionState, capabilities, egress }),
      );
    }),
    disconnect: vi.fn(),
    leaveRoom: vi.fn(),
    isConnected: vi.fn(() => true),
    getSocket: vi.fn(() => socket),
    joinRoom: vi.fn(async () => {}),
    kickPeer: vi.fn(async () => {}),
    mutePeer: vi.fn(async () => {}),
    muteAll: vi.fn(async () => {}),
    lockRoom: vi.fn(async () => {}),
    startEgress: vi.fn(async () => {}),
    stopEgress: vi.fn(async () => {}),
    sendBroadcast: vi.fn(async () => {}),
    setPreferredLayers: vi.fn(),
    getVideoConsumerIdForUserId: vi.fn(),
    produce: vi.fn(async (track: MediaStreamTrack) => ({
      id: `${track.kind}-producer`,
    })),
    produceScreen: vi.fn(async () => ({ id: "screen-producer" })),
    closeScreenProducer: vi.fn(),
    closeProducer: vi.fn(),
    pauseProducer: vi.fn(),
    resumeProducer: vi.fn(),
    replaceTrack: vi.fn(async () => true),
    getProducerByKind:
      vi.fn<
        (
          kind: "audio" | "video",
        ) => { id: string; track?: MediaStreamTrack } | undefined
      >(),
    getLocalUserId: vi.fn(() => localUserId),
    getState: vi.fn(() => ({ connectionState, capabilities, egress })),
    startStatsCollection: vi.fn(),
    stopStatsCollection: vi.fn(),
    getStats: vi.fn(() => new Map()),
    onQualityStats: vi.fn(() => () => {}),
    onBroadcast: vi.fn(
      (
        listener: (message: {
          senderId: string;
          topic: string;
          payload: unknown;
          timestamp: string;
        }) => void,
      ) => {
        broadcastListeners.add(listener);
        return () => broadcastListeners.delete(listener);
      },
    ),
    onProduceError: vi.fn((callback: (code: string) => void) => {
      produceErrorListeners.add(callback);
      return () => produceErrorListeners.delete(callback);
    }),
    onStateChange: vi.fn((listener: StateListener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    }),
    onReconnectError: vi.fn(
      (listener: (error: { code: string; message: string }) => void) => {
        reconnectErrorListeners.add(listener);
        return () => reconnectErrorListeners.delete(listener);
      },
    ),
    onTrack: vi.fn((listener: TrackListener) => {
      trackListeners.add(listener);
      return () => trackListeners.delete(listener);
    }),
    onParticipantJoined: vi.fn(
      (listener: (peer: { userId: string; username: string }) => void) => {
        peerJoinedListeners.add(listener);
        return () => peerJoinedListeners.delete(listener);
      },
    ),
    onParticipantLeft: vi.fn((listener: (userId: string) => void) => {
      peerLeftListeners.add(listener);
      return () => peerLeftListeners.delete(listener);
    }),
    onKicked: vi.fn((listener: (payload: { roomId: string }) => void) => {
      kickedListeners.add(listener);
      return () => kickedListeners.delete(listener);
    }),
    onRoomEnded: vi.fn((listener: (payload: { roomId: string }) => void) => {
      roomEndedListeners.add(listener);
      return () => roomEndedListeners.delete(listener);
    }),
    onProducerStateChange: vi.fn(
      (
        listener: (payload: {
          userId: string;
          kind: "audio" | "video";
          paused: boolean;
          source?: "camera" | "screen";
        }) => void,
      ) => {
        producerStateListeners.add(listener);
        return () => producerStateListeners.delete(listener);
      },
    ),
    onScreenShareStopped: vi.fn(
      (listener: (payload: { userId: string }) => void) => {
        screenShareStoppedListeners.add(listener);
        return () => screenShareStoppedListeners.delete(listener);
      },
    ),
    onGuestJoinRequest: vi.fn(
      (
        listener: (payload: { requestId: string; displayName: string }) => void,
      ) => {
        guestJoinRequestListeners.add(listener);
        return () => guestJoinRequestListeners.delete(listener);
      },
    ),
    simulateCapabilities(next: string[]): void {
      capabilities = next;
      stateListeners.forEach((listener) =>
        listener({ connectionState, capabilities, egress }),
      );
    },
    simulateEgressStatus(next: Record<string, unknown> | null): void {
      egress = next;
      stateListeners.forEach((listener) =>
        listener({ connectionState, capabilities, egress }),
      );
    },
    simulateBroadcast(message: {
      senderId: string;
      topic: string;
      payload: unknown;
      timestamp: string;
    }): void {
      broadcastListeners.forEach((listener) => listener(message));
    },
    simulateLocalUser(next: string | null): void {
      localUserId = next;
    },
    simulateConnected(state = "connected"): void {
      connectionState = state;
      stateListeners.forEach((listener) => listener({ connectionState }));
    },
    simulateReconnectError(code: string, message: string): void {
      reconnectErrorListeners.forEach((listener) =>
        listener({ code, message }),
      );
    },
    emitTrack(
      track: MediaStreamTrack,
      kind: "audio" | "video",
      userId: string,
      source?: "camera" | "screen",
    ): void {
      trackListeners.forEach((listener) =>
        listener(track, kind, userId, source),
      );
    },
    emitPeerJoined(userId: string, username: string): void {
      peerJoinedListeners.forEach((listener) => listener({ userId, username }));
    },
    emitPeerLeft(userId: string): void {
      peerLeftListeners.forEach((listener) => listener(userId));
    },
    emitKicked(roomId = "room-1"): void {
      kickedListeners.forEach((listener) => listener({ roomId }));
    },
    emitRoomEnded(roomId = "room-1"): void {
      roomEndedListeners.forEach((listener) => listener({ roomId }));
    },
    emitGuestJoinRequest(payload: {
      requestId: string;
      displayName: string;
    }): void {
      guestJoinRequestListeners.forEach((listener) => listener(payload));
    },
    emitProducerState(payload: {
      userId: string;
      kind: "audio" | "video";
      paused: boolean;
      source?: "camera" | "screen";
    }): void {
      producerStateListeners.forEach((listener) => listener(payload));
    },
    emitScreenShareStopped(userId: string): void {
      screenShareStoppedListeners.forEach((listener) => listener({ userId }));
    },
  };

  return { manager, socket };
}

export type MockMediaManager = ReturnType<typeof createMockMediaManager>;

export function createMockMediaManager() {
  const videoStateListeners = new Set<
    (state: CaptureState, track: MediaStreamTrack | null) => void
  >();
  const audioStateListeners = new Set<
    (state: CaptureState, track: MediaStreamTrack | null) => void
  >();

  const makeCapture = (listeners: typeof videoStateListeners) => ({
    getStream: vi.fn(() => null),
    getState: vi.fn(() => 0 as CaptureState),
    getTrack: vi.fn(() => null),
    onStateChange: vi.fn(
      (
        listener: (state: CaptureState, track: MediaStreamTrack | null) => void,
      ) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    ),
    start: vi.fn(async () => true),
    stop: vi.fn(),
    switchDevice: vi.fn(async () => true),
    toggle: vi.fn(async () => true),
  });

  const videoCapture = makeCapture(videoStateListeners);
  const audioCapture = makeCapture(audioStateListeners);

  const deviceService = {
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn(async () => []),
    queryPermission: vi.fn(),
  };

  return {
    videoCapture,
    audioCapture,
    getDeviceService: vi.fn(() => deviceService),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    onVideoStateChange: vi.fn(videoCapture.onStateChange),
    onAudioStateChange: vi.fn(audioCapture.onStateChange),
    emitVideoState(state: CaptureState, track: MediaStreamTrack | null): void {
      videoStateListeners.forEach((listener) => listener(state, track));
    },
    emitAudioState(state: CaptureState, track: MediaStreamTrack | null): void {
      audioStateListeners.forEach((listener) => listener(state, track));
    },
  };
}

export interface MockScreenShareState {
  isSharing: boolean;
  screenStream: MediaStream | null;
  isScreenShareBlocked: boolean;
}

export type MockScreenShareService = ReturnType<
  typeof createMockScreenShareService
>;

/** Socket-level double standing in for the client's ScreenShareService. */
export function createMockScreenShareService() {
  const listeners = new Set<(state: MockScreenShareState) => void>();
  let state: MockScreenShareState = {
    isSharing: false,
    screenStream: null,
    isScreenShareBlocked: false,
  };
  const emit = () => listeners.forEach((listener) => listener(state));
  return {
    getState: vi.fn(() => state),
    setState: vi.fn((patch: Partial<MockScreenShareState>) => {
      state = { ...state, ...patch };
      emit();
    }),
    onStateChange: vi.fn((listener: (state: MockScreenShareState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    destroy: vi.fn(),
  };
}

/** Builds a syntactically valid unsigned JWT with the given payload. */
export function tokenFor(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

export function createTrack(
  kind: "audio" | "video",
  id: string,
  enabled = true,
): MediaStreamTrack {
  return {
    kind,
    id,
    enabled,
    onmute: null,
    onunmute: null,
    onended: null,
  } as unknown as MediaStreamTrack;
}
