/**
 * Mediasoup hook for SFU integration.
 * Uses dependency injection via SfuManagerContext; remote peer media state
 * and room lock state come from the @zvonok/react RoomTracker, and host
 * actions from the SDK host controls factory.
 */

import type { SfuState } from "@zvonok/client/sfu/types";
import {
  createHostControls,
  EMPTY_ROOM_STATE,
  RoomTracker,
  type HostControls,
  type ZvonokParticipant,
} from "@zvonok/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/features/auth/contexts/auth.context";
import { useSfuManager } from "@/features/sfu/contexts/sfu-manager.context";

import { useIsMobile } from "./use-is-mobile";

export interface UseMediasoupOptions {
  roomId?: string;
  roomSlug?: string;
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  enabled?: boolean;
  displayName?: string;
}

export interface RemotePeerMedia {
  userId: string;
  username: string;
  cameraStream: MediaStream;
  screenStream: MediaStream | null;
  audioStream: MediaStream;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isAudioEnabled: boolean;
  mutedByHost: boolean;
}

export interface UseMediasoupResult {
  state: SfuState;
  remotePeers: RemotePeerMedia[];
  isRoomLocked: boolean;
  mutedByHost: boolean;
  hostControls: HostControls;
  kickPeer: (userId: string) => Promise<void>;
  wasKicked: boolean;
  produceTrack: (track: MediaStreamTrack) => Promise<boolean>;
  pauseProducer: (kind: "audio" | "video") => void;
  resumeProducer: (kind: "audio" | "video") => void;
  replaceTrack: (kind: "audio" | "video", track: MediaStreamTrack | null) => Promise<boolean>;
  hasProducer: (kind: "audio" | "video") => boolean;
}

function toRemotePeer(participant: ZvonokParticipant): RemotePeerMedia {
  return {
    userId: participant.userId,
    username: participant.displayName,
    cameraStream: participant.cameraStream ?? new MediaStream(),
    screenStream: participant.screenStream,
    audioStream: participant.audioStream ?? new MediaStream(),
    isCameraEnabled: participant.isCameraEnabled,
    isScreenSharing: participant.isScreenSharing,
    isAudioEnabled: participant.isAudioEnabled,
    mutedByHost: participant.mutedByHost,
  };
}

export function useMediasoup({
  roomId,
  roomSlug,
  localVideoStream,
  localAudioStream,
  enabled = true,
  displayName,
}: UseMediasoupOptions): UseMediasoupResult {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const sfuManager = useSfuManager();
  const [state, setState] = useState<SfuState>(() => sfuManager.getState());
  const [tracker, setTracker] = useState<RoomTracker | null>(null);
  const [wasKicked, setWasKicked] = useState(false);

  const joinedRef = useRef(false);
  const producedKindsRef = useRef<Set<"audio" | "video">>(new Set());
  const guestUserIdRef = useRef(`guest-${Math.random().toString(36).slice(2, 10)}`);

  // Local UI identity (recording labels, trackers). The SFU derives the
  // authoritative identity from the authenticated session; it is echoed
  // back on join.
  const identity = {
    userId: user?.id ?? guestUserIdRef.current,
    username: displayName ?? "Guest",
  };

  useEffect(() => {
    if (!roomId || !enabled) {
      return;
    }

    // Snapshot the Set object at effect setup time. Using the snapshot (rather
    // than producedKindsRef.current) in callbacks and cleanup avoids the
    // exhaustive-deps lint warning about accessing .current inside cleanup.
    // The snapshot is safe because we only call .clear() - never reassign the ref.
    const producedKinds = producedKindsRef.current;

    const unsubscribeState = sfuManager.onStateChange((nextState) => {
      setState(nextState);

      if (nextState.connectionState !== "connected") {
        joinedRef.current = false;
        producedKinds.clear();
      }
    });

    const roomTracker = new RoomTracker(sfuManager, { localUserId: identity.userId });
    setTracker(roomTracker);

    const unsubscribeKicked = sfuManager.onKicked(() => {
      joinedRef.current = false;
      setWasKicked(true);
      roomTracker.reset();
    });

    // A server-refused join (expired session, wrong room) surfaces through
    // the same leave flow as a kick.
    const unsubscribeJoinError = sfuManager.onJoinError(() => {
      joinedRef.current = false;
      setWasKicked(true);
      roomTracker.reset();
    });

    sfuManager.connect();

    return () => {
      unsubscribeState();
      unsubscribeKicked();
      unsubscribeJoinError();
      producedKinds.clear();
      joinedRef.current = false;
      setWasKicked(false);
      setTracker(null);
      roomTracker.stop();
      sfuManager.leaveRoom();
      sfuManager.disconnect();
    };
  }, [roomId, enabled, sfuManager, identity.userId]);

  const subscribe = useCallback(
    (listener: () => void) => tracker?.subscribe(listener) ?? (() => {}),
    [tracker],
  );
  const getSnapshot = useCallback(() => tracker?.getSnapshot() ?? EMPTY_ROOM_STATE, [tracker]);
  const roomState = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!roomId || !enabled || state.connectionState !== "connected" || joinedRef.current) {
      return;
    }

    joinedRef.current = true;
    const joinPayload = {
      roomId,
      ...(roomSlug ? { roomSlug } : {}),
    };

    void sfuManager.joinRoom({ ...joinPayload }).catch((error) => {
      console.error("[SFU] Failed to join room:", error);
      joinedRef.current = false;
    });
  }, [enabled, roomId, roomSlug, state.connectionState, sfuManager]);

  useEffect(() => {
    if (!state.isSendTransportCreated) {
      return;
    }

    const streams = [localVideoStream, localAudioStream];

    for (const stream of streams) {
      if (!stream) continue;
      stream.getTracks().forEach((track) => {
        if (
          (track.kind === "audio" || track.kind === "video") &&
          track.readyState !== "ended" &&
          !producedKindsRef.current.has(track.kind)
        ) {
          producedKindsRef.current.add(track.kind);
          sfuManager
            .produce(track, { isMobile })
            .then((producer) => {
              if (!producer) {
                producedKindsRef.current.delete(track.kind as "audio" | "video");
              }
            })
            .catch((error) => {
              console.error("[SFU] Failed to produce track:", track.kind, error);
              producedKindsRef.current.delete(track.kind as "audio" | "video");
            });
        }
      });
    }
  }, [localVideoStream, localAudioStream, state.isSendTransportCreated, sfuManager, isMobile]);

  const kickPeer = useCallback(
    async (userId: string): Promise<void> => {
      // Denials surface here (capability or target races); the participant
      // list updates from peer-left events either way.
      await sfuManager.kickPeer(userId);
    },
    [sfuManager],
  );

  const produceTrack = useCallback(
    async (track: MediaStreamTrack): Promise<boolean> => {
      const kind = track.kind as "audio" | "video";
      producedKindsRef.current.add(kind);
      const producer = await sfuManager.produce(track, { isMobile });
      if (!producer) {
        producedKindsRef.current.delete(kind);
      }
      return producer !== null;
    },
    [sfuManager, isMobile],
  );

  const pauseProducer = useCallback(
    (kind: "audio" | "video") => {
      const producer = sfuManager.getProducerByKind(kind);
      if (producer) {
        sfuManager.pauseProducer(producer.id);
      }
    },
    [sfuManager],
  );

  const resumeProducer = useCallback(
    (kind: "audio" | "video") => {
      const producer = sfuManager.getProducerByKind(kind);
      if (producer) {
        sfuManager.resumeProducer(producer.id);
      }
    },
    [sfuManager],
  );

  const replaceTrack = useCallback(
    async (kind: "audio" | "video", track: MediaStreamTrack | null): Promise<boolean> => {
      return sfuManager.replaceTrack(kind, track);
    },
    [sfuManager],
  );

  const hasProducer = useCallback(
    (kind: "audio" | "video"): boolean => {
      return sfuManager.getProducerByKind(kind) !== undefined;
    },
    [sfuManager],
  );

  const hostControls = useMemo(() => createHostControls(sfuManager), [sfuManager]);
  const remotePeers = useMemo(() => roomState.participants.map(toRemotePeer), [roomState]);

  return {
    state,
    remotePeers,
    isRoomLocked: roomState.locked,
    mutedByHost: roomState.mutedByHost,
    hostControls,
    kickPeer,
    wasKicked,
    produceTrack,
    pauseProducer,
    resumeProducer,
    replaceTrack,
    hasProducer,
  };
}
