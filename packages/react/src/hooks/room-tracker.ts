/**
 * Framework-free room state tracker over a connected SFU manager: peer
 * join/leave, per-participant media grouping, muted-by-host, and room lock.
 * useParticipants wraps this with useSyncExternalStore; framework-less
 * consumers can use the class directly.
 */

import type { SfuManager } from "@zvonok/client/sfu/manager";
import type { SfuMediaSource } from "@zvonok/client/sfu/types";

import type { ZvonokParticipant } from "../types.js";

export interface RoomTrackerState {
  participants: ZvonokParticipant[];
  /** Latest sfu:room-locked value; false until the server reports a lock. */
  locked: boolean;
  /** True while the local user is under a server-enforced host mute. */
  mutedByHost: boolean;
}

/** Stable fallback snapshot for tracker-less consumers. */
export const EMPTY_ROOM_STATE: RoomTrackerState = {
  participants: [],
  locked: false,
  mutedByHost: false,
};

type ParticipantMap = Map<string, ZvonokParticipant>;

export interface RoomTrackerOptions {
  /** Local participant id; enables the local mutedByHost flag. */
  localUserId?: string;
}

function upsertParticipant(
  participants: ParticipantMap,
  userId: string,
  updater: (current: ZvonokParticipant) => ZvonokParticipant,
): ParticipantMap {
  const next = new Map(participants);
  const current = next.get(userId) ?? {
    userId,
    displayName: "Participant",
    cameraStream: null,
    screenStream: null,
    audioStream: null,
    isCameraEnabled: false,
    isScreenSharing: false,
    isAudioEnabled: false,
    isConnected: true,
    mutedByHost: false,
  };
  next.set(userId, updater(current));
  return next;
}

function withStream(
  current: MediaStream | null,
  track: MediaStreamTrack,
  filter: (existing: MediaStreamTrack) => boolean,
): MediaStream {
  const stream = new MediaStream(current ? current.getTracks().filter(filter) : []);
  stream.addTrack(track);
  return stream;
}

function trackUpdate(
  current: ZvonokParticipant,
  track: MediaStreamTrack,
  kind: "audio" | "video",
  source?: SfuMediaSource,
): ZvonokParticipant {
  if (kind === "video" && source === "screen") {
    return {
      ...current,
      screenStream: withStream(current.screenStream, track, (existing) => existing.id !== track.id),
      isScreenSharing: true,
    };
  }
  if (kind === "video") {
    return {
      ...current,
      cameraStream: withStream(current.cameraStream, track, (existing) => existing.kind !== "video"),
      isCameraEnabled: track.enabled,
    };
  }
  return {
    ...current,
    audioStream: withStream(current.audioStream, track, (existing) => existing.kind !== "audio"),
    isAudioEnabled: track.enabled,
  };
}

/** Rebuilds a stream without the given track; null when nothing remains. */
function withoutTrack(
  current: MediaStream | null,
  filter: (existing: MediaStreamTrack) => boolean,
): MediaStream | null {
  const remaining = new MediaStream(current ? current.getTracks().filter(filter) : []);
  return remaining.getTracks().length > 0 ? remaining : null;
}

function trackEndedUpdate(
  current: ZvonokParticipant,
  track: MediaStreamTrack,
  kind: "audio" | "video",
  source?: SfuMediaSource,
): ZvonokParticipant {
  if (kind === "video" && source === "screen") {
    return {
      ...current,
      screenStream: withoutTrack(current.screenStream, (existing) => existing.id !== track.id),
      isScreenSharing: false,
    };
  }
  if (kind === "video") {
    return {
      ...current,
      cameraStream: withoutTrack(current.cameraStream, (existing) => existing.id !== track.id),
      isCameraEnabled: false,
    };
  }
  return {
    ...current,
    audioStream: withoutTrack(current.audioStream, (existing) => existing.id !== track.id),
    isAudioEnabled: false,
  };
}

/**
 * Reference-stability invariant: a participant object keeps its identity
 * across snapshot recomputes unless that participant itself is patched.
 * Memoized consumer tiles rely on this to bail out of unrelated updates.
 */
export class RoomTracker {
  private readonly manager: SfuManager;
  private readonly localUserId: string | undefined;
  private participants: ParticipantMap = new Map();
  private locked = false;
  private localMutedByHost = false;
  private snapshot: RoomTrackerState = { participants: [], locked: false, mutedByHost: false };
  private readonly listeners = new Set<() => void>();
  private unsubscribes: Array<() => void> = [];
  private socketBound = false;

  constructor(manager: SfuManager, options: RoomTrackerOptions = {}) {
    this.manager = manager;
    this.localUserId = options.localUserId;
    this.bind();
    // The socket may not exist yet at construction time (manager still
    // connecting); bind socket-level listeners as soon as it appears.
    this.unsubscribes.push(
      manager.onStateChange((state) => {
        if (state.connectionState === "connected") {
          this.bindSocket();
        }
      }),
    );
    this.bindSocket();
  }

  /** Stable reference between mutations; safe for useSyncExternalStore. */
  getSnapshot = (): RoomTrackerState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Drops all participant and lock state (e.g. after being kicked). */
  reset(): void {
    this.participants = new Map();
    this.locked = false;
    this.localMutedByHost = false;
    this.recompute();
  }

  /** Unsubscribes everything; the tracker cannot be reused afterwards. */
  stop(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];
    this.listeners.clear();
  }

  private bind(): void {
    const manager = this.manager;

    this.unsubscribes.push(
      manager.onParticipantJoined((peer) => {
        this.update(peer.userId, (current) => ({
          ...current,
          displayName: peer.username || current.displayName,
          isConnected: true,
        }));
      }),
    );

    this.unsubscribes.push(
      manager.onTrack((track, kind, userId, source) => {
        this.update(userId, (current) =>
          // Media flowing means any earlier detach has been restored.
          trackUpdate({ ...current, isConnected: true }, track, kind, source),
        );

        track.onmute = () => {
          this.update(userId, (current) => ({
            ...current,
            isCameraEnabled:
              kind === "video" && source !== "screen" ? false : current.isCameraEnabled,
            isScreenSharing:
              kind === "video" && source === "screen" ? false : current.isScreenSharing,
            isAudioEnabled: kind === "audio" ? false : current.isAudioEnabled,
          }));
        };

        track.onunmute = () => {
          this.update(userId, (current) => ({
            ...current,
            isCameraEnabled:
              kind === "video" && source !== "screen" ? true : current.isCameraEnabled,
            isScreenSharing:
              kind === "video" && source === "screen" ? true : current.isScreenSharing,
            isAudioEnabled: kind === "audio" ? true : current.isAudioEnabled,
          }));
        };

        track.onended = () => {
          if (!this.participants.has(userId)) {
            return;
          }
          this.update(userId, (current) => trackEndedUpdate(current, track, kind, source));
        };
      }),
    );

    this.unsubscribes.push(
      manager.onProducerStateChange(({ userId, kind, paused, source }) => {
        this.update(userId, (current) => ({
          ...current,
          isCameraEnabled:
            kind === "video" && source !== "screen" ? !paused : current.isCameraEnabled,
          isAudioEnabled: kind === "audio" ? !paused : current.isAudioEnabled,
          mutedByHost: kind === "audio" && !paused ? false : current.mutedByHost,
        }));
      }),
    );

    this.unsubscribes.push(
      manager.onParticipantLeft((userId) => {
        if (!this.participants.has(userId)) {
          return;
        }
        const next = new Map(this.participants);
        next.delete(userId);
        this.participants = next;
        this.recompute();
      }),
    );

    this.unsubscribes.push(
      manager.onScreenShareStopped(({ userId }) => {
        this.update(userId, (current) => ({
          ...current,
          isScreenSharing: false,
          screenStream: null,
        }));
      }),
    );

    this.unsubscribes.push(
      manager.onPeerMediaDetached(({ userId }) => {
        if (!this.participants.has(userId)) {
          return;
        }
        this.update(userId, (current) => ({
          ...current,
          isConnected: false,
        }));
      }),
    );
    this.bindSocket();
  }


  /** Idempotently attaches sfu:peer-muted / sfu:room-locked listeners. */
  private bindSocket(): void {
    if (this.socketBound) {
      return;
    }
    const socket = this.manager.getSocket?.() ?? null;
    if (!socket) {
      return;
    }
    this.socketBound = true;
    const onPeerMuted = (payload: unknown) => {
      const { userId } = (payload ?? {}) as { userId?: string };
      if (!userId) {
        return;
      }
      // The manager's server-verified identity wins over caller hints: a
      // guest client generates its own id that never matches the payload's
      // server-issued userId, which would fabricate a phantom participant.
      const selfId = this.manager.getLocalUserId?.() ?? this.localUserId;
      if (selfId !== undefined && selfId !== null && userId === selfId) {
        // The local user is not a tracked (remote) participant; reflect the
        // mute only in the local flag instead of upserting a phantom entry.
        this.localMutedByHost = true;
        this.recompute();
        return;
      }
      // A mute only decorates live participants; upserting an unknown id
      // would create a phantom entry named after the fallback displayName.
      if (!this.participants.has(userId)) {
        return;
      }
      // The server paused the target's producers: their media stopped and
      // the room is told whose media it is. Reflect both, so listeners see
      // the mute immediately instead of waiting for track events.
      this.update(userId, (current) => ({
        ...current,
        isAudioEnabled: false,
        isCameraEnabled: false,
        mutedByHost: true,
      }));
    };
    const onRoomLocked = (payload: unknown) => {
      const { locked } = (payload ?? {}) as { locked?: boolean };
      this.locked = locked === true;
      this.recompute();
    };
    socket.on("sfu:peer-muted", onPeerMuted);
    socket.on("sfu:room-locked", onRoomLocked);
    this.unsubscribes.push(() => {
      socket.off("sfu:peer-muted", onPeerMuted);
      socket.off("sfu:room-locked", onRoomLocked);
    });
  }
  private update(
    userId: string,
    updater: (current: ZvonokParticipant) => ZvonokParticipant,
  ): void {
    this.participants = upsertParticipant(this.participants, userId, updater);
    this.recompute();
  }

  private recompute(): void {
    const participants = Array.from(this.participants.values());
    // Identity-stable array: a patch touches one participant while the rest
    // keep their references, so the array itself can stay identical when
    // membership and order did not change. Memoized tiles rely on this.
    const previous = this.snapshot.participants;
    const stable =
      previous.length === participants.length &&
      participants.every((participant, index) => participant === previous[index]);
    this.snapshot = {
      participants: stable ? previous : participants,
      locked: this.locked,
      mutedByHost: this.localMutedByHost,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
