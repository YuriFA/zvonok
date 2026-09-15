/**
 * Deterministic SFU double for the visual harness: event-emitter shape the
 * app's room hooks consume (RoomTracker, useRoomSfu) without any network.
 * The harness drives peers by emitting manager events, so every screenshot
 * sees the same room state.
 */

import type { SfuManager } from "@zvonok/client/sfu/manager";

type Unsubscribe = () => void;

/**
 * A live video track rendering one static canvas frame: real enough for
 * the tracker, identical in every screenshot, independent of device
 * capture timing.
 */
export function staticScreenShareTrack(label: string): MediaStreamTrack {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#3b3f4a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "64px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }
  return canvas.captureStream(25).getVideoTracks()[0];
}

interface ListenerSet<T> {
  add(handler: (payload: T) => void): Unsubscribe;
  emit(payload: T): void;
}

function listenerSet<T>(): ListenerSet<T> {
  const handlers = new Set<(payload: T) => void>();
  return {
    add(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit(payload) {
      handlers.forEach((handler) => handler(payload));
    },
  };
}

interface FakeManagerEvents {
  joined: { userId: string; username: string };
  left: string;
  producerState: { userId: string; kind: "audio" | "video"; paused: boolean; source?: string };
}

export function createFakeSfuManager() {
  const events = {
    state: listenerSet<{ connectionState: string }>(),
    joined: listenerSet<FakeManagerEvents["joined"]>(),
    left: listenerSet<FakeManagerEvents["left"]>(),
    producerState: listenerSet<FakeManagerEvents["producerState"]>(),
    screenShareStopped: listenerSet<{ userId: string }>(),
    peerMediaDetached: listenerSet<{ userId: string }>(),
  };
  // onTrack handlers take positional arguments, matching the real manager.
  const qualityHandlers = new Set<(stats: Map<string, { userId: string }>) => void>();
  const trackHandlers = new Set<
    (
      track: MediaStreamTrack,
      kind: "audio" | "video",
      userId: string,
      source?: "camera" | "screen",
    ) => void
  >();

  const manager = {
    getState: () => ({
      connectionState: "connected",
      capabilities: ["start-recording", "mute-users", "lock-room", "remove-participants"],
    }),
    onStateChange: events.state.add,
    onParticipantJoined: events.joined.add,
    onParticipantLeft: events.left.add,
    onTrack: (
      handler: (
        track: MediaStreamTrack,
        kind: "audio" | "video",
        userId: string,
        source?: "camera" | "screen",
      ) => void,
    ): Unsubscribe => {
      trackHandlers.add(handler);
      return () => trackHandlers.delete(handler);
    },
    onProducerStateChange: events.producerState.add,
    onScreenShareStopped: events.screenShareStopped.add,
    onPeerMediaDetached: events.peerMediaDetached.add,
    // Emission helpers used by the harness scenes.
    emitJoined: events.joined.emit,
    emitLeft: events.left.emit,
    emitTrack: (
      track: MediaStreamTrack,
      kind: "audio" | "video",
      userId: string,
      source?: "camera" | "screen",
    ) => {
      trackHandlers.forEach((handler) => handler(track, kind, userId, source));
    },
    emitProducerState: events.producerState.emit,
    // Quality-adaptation surface: the engine binds but stays idle without
    // consumers; emitQualityStats exists for future scenes.
    onQualityStats: (handler: (stats: Map<string, { userId: string }>) => void): Unsubscribe => {
      qualityHandlers.add(handler);
      return () => qualityHandlers.delete(handler);
    },
    emitQualityStats: (stats: Map<string, { userId: string }>) => {
      qualityHandlers.forEach((handler) => handler(stats));
    },
    startStatsCollection: () => {},
    stopStatsCollection: () => {},
    getVideoConsumerIdForUserId: () => null,
    setPreferredLayers: () => {},
  };

  return manager;
}

export type FakeSfuManager = ReturnType<typeof createFakeSfuManager>;

export interface FakePeer {
  userId: string;
  username: string;
  /** Marks this peer as the spotlight scene's screen sharer. */
  screenShare?: boolean;
}

export function createFakeConnection(manager: FakeSfuManager, options?: { wasKicked?: boolean }) {
  const connection = {
    status: "joined" as const,
    error: null,
    isRoomLocked: false,
    wasKicked: options?.wasKicked ?? false,
    roomEnded: false,
    manager: manager as unknown as SfuManager,
    join: async () => {},
    leave: () => {},
    produceTrack: async () => true,
    pauseProducer: () => {},
    resumeProducer: () => {},
    closeProducer: () => {},
    replaceTrack: async () => true,
    hasProducer: () => false,
  };
  return connection;
}
