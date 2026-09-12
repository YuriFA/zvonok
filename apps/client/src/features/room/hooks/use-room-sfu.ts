import type { SfuManager } from "@zvonok/client/sfu/manager";
import {
  createHostControls,
  EMPTY_ROOM_STATE,
  RoomTracker,
  type HostControls,
  type UseZvonokConnectionResult,
  type ZvonokParticipant,
} from "@zvonok/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useAuth } from "@/features/auth/contexts/auth.context";
import { useMediaControls, type UseMediaControlsReturn } from "@/features/media/hooks/use-media-controls";
import { useIsMobile } from "@/hooks/use-is-mobile";

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

export interface UseRoomSfuOptions {
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  onKicked: () => void;
  connection: UseZvonokConnectionResult;
}

export interface UseRoomSfuResult {
  connectionState: string;
  capabilities: string[];
  remotePeers: RemotePeerMedia[];
  wasKicked: boolean;
  kickPeer: (userId: string) => Promise<void>;
  mediaControls: UseMediaControlsReturn;
  toggleVideo: () => Promise<void>;
  toggleAudio: () => Promise<void>;
  isRoomLocked: boolean;
  mutedByHost: boolean;
  hostControls: HostControls;
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

export function useRoomSfu({
  localVideoStream,
  localAudioStream,
  onKicked,
  connection,
}: UseRoomSfuOptions): UseRoomSfuResult {
  const isMobile = useIsMobile();
  const manager = connection.manager;
  const mediaControls = useMediaControls();

  // Local UI identity for the tracker (muted-by-host of the local tile).
  // The SFU derives the authoritative identity from the verified session.
  const { user } = useAuth();
  const guestUserIdRef = useRef(`guest-${Math.random().toString(36).slice(2, 10)}`);
  const localUserId = user?.id ?? guestUserIdRef.current;

  // Participant membership as React state, from the framework-free tracker.
  const tracker = useMemo(
    () => (manager ? new RoomTracker(manager, { localUserId }) : null),
    [manager, localUserId],
  );
  useEffect(() => () => tracker?.stop(), [tracker]);
  const subscribe = useCallback(
    (listener: () => void) => tracker?.subscribe(listener) ?? (() => {}),
    [tracker],
  );
  const getSnapshot = useCallback(() => tracker?.getSnapshot() ?? EMPTY_ROOM_STATE, [tracker]);
  const roomState = useSyncExternalStore(subscribe, getSnapshot);

  // Manager connection state, mirrored for consumers (participants list,
  // auto-quality gate). Same vocabulary as before the migration.
  const [connectionState, setConnectionState] = useState(() => manager?.getState().connectionState ?? "disconnected");
  useEffect(() => {
    if (!manager) {
      setConnectionState("disconnected");
      return;
    }
    setConnectionState(manager.getState().connectionState);
    return manager.onStateChange((state) => setConnectionState(state.connectionState));
  }, [manager]);

  // A kicked peer lost the room; surface it and stop local media.
  useEffect(() => {
    if (connection.wasKicked) {
      onKicked();
    }
  }, [connection.wasKicked, onKicked]);

  // Publish the captured local tracks once joined. The manager buffers
  // produces until the send transport exists, so publishing immediately
  // after the join is safe.
  const publishedRef = useRef(false);
  useEffect(() => {
    if (connection.status !== "joined") {
      publishedRef.current = false;
      return;
    }
    if (publishedRef.current) {
      return;
    }
    publishedRef.current = true;
    const streams = [localVideoStream, localAudioStream];
    for (const stream of streams) {
      for (const track of stream?.getTracks() ?? []) {
        if (
          (track.kind === "audio" || track.kind === "video") &&
          track.readyState === "live" &&
          !connection.hasProducer(track.kind)
        ) {
          void connection
            .produceTrack(track, { isMobile })
            .then((produced) => {
              if (produced) {
                connection.resumeProducer(track.kind as "audio" | "video");
              }
            })
            .catch((error: unknown) => {
              console.error("[SFU] Failed to produce track:", track.kind, error);
            });
        }
      }
    }
  }, [connection, connection.status, localVideoStream, localAudioStream, isMobile]);

  // A server-enforced host mute pauses our producer; reflect it in the mic
  // control and tell the user once per occurrence.
  const mutedByHost = roomState.mutedByHost;
  const announcedHostMuteRef = useRef(false);
  useEffect(() => {
    if (!mutedByHost) {
      announcedHostMuteRef.current = false;
      return;
    }
    if (announcedHostMuteRef.current) {
      return;
    }
    announcedHostMuteRef.current = true;
    mediaControls.setAudioEnabled(false);
    toast.info("Muted by the room host");
  }, [mutedByHost, mediaControls]);

  const { hasProducer, produceTrack, replaceTrack, pauseProducer, resumeProducer } = connection;

  const toggleVideo = useCallback(async () => {
    const nextEnabled = !mediaControls.isVideoEnabled;
    mediaControls.setVideoEnabled(nextEnabled);

    if (nextEnabled) {
      const track = localVideoStream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        mediaControls.setVideoEnabled(false);
        return;
      }
      if (!hasProducer("video")) {
        const produced = await produceTrack(track, { isMobile });
        if (!produced) {
          mediaControls.setVideoEnabled(false);
          return;
        }
        resumeProducer("video");
        return;
      }

      // The producer still references the track that "off" ended. Swap it in
      // first: resuming first would stream silence until the swap lands.
      const replaced = await replaceTrack("video", track);
      if (!replaced) {
        toast.error("Failed to restart the camera");
        mediaControls.setVideoEnabled(false);
        return;
      }
      resumeProducer("video");
    } else {
      if (hasProducer("video")) {
        pauseProducer("video");
      }
    }
  }, [
    mediaControls,
    localVideoStream,
    produceTrack,
    replaceTrack,
    hasProducer,
    pauseProducer,
    resumeProducer,
    isMobile,
  ]);

  const toggleAudio = useCallback(async () => {
    const nextEnabled = !mediaControls.isAudioEnabled;
    mediaControls.setAudioEnabled(nextEnabled);

    if (nextEnabled) {
      const track = localAudioStream?.getAudioTracks()[0];
      if (!track || track.readyState !== "live") {
        mediaControls.setAudioEnabled(false);
        return;
      }
      if (!hasProducer("audio")) {
        const produced = await produceTrack(track, { isMobile });
        if (!produced) {
          mediaControls.setAudioEnabled(false);
          return;
        }
        resumeProducer("audio");
        return;
      }

      // The producer still references the track that "off" ended. Swap it in
      // first: resuming first would stream silence until the swap lands.
      const replaced = await replaceTrack("audio", track);
      if (!replaced) {
        toast.error("Failed to restart the microphone");
        mediaControls.setAudioEnabled(false);
        return;
      }
      resumeProducer("audio");
    } else {
      if (hasProducer("audio")) {
        pauseProducer("audio");
      }
    }
  }, [
    mediaControls,
    localAudioStream,
    produceTrack,
    replaceTrack,
    hasProducer,
    pauseProducer,
    resumeProducer,
    isMobile,
  ]);

  const kickPeer = useCallback(
    async (userId: string): Promise<void> => {
      // Denials surface here (capability or target races); the participant
      // list updates from peer-left events either way.
      const currentManager = connection.manager as SfuManager | null;
      if (!currentManager) {
        return;
      }
      await currentManager.kickPeer(userId);
    },
    [connection.manager],
  );

  const hostControls = useMemo(
    () => createHostControls(connection.manager as SfuManager),
    [connection.manager],
  );

  const remotePeers = useMemo(() => roomState.participants.map(toRemotePeer), [roomState]);

  return {
    connectionState,
    capabilities: connection.manager?.getState().capabilities ?? [],
    remotePeers,
    wasKicked: connection.wasKicked,
    kickPeer,
    mediaControls,
    toggleVideo,
    toggleAudio,
    isRoomLocked: connection.isRoomLocked,
    mutedByHost,
    hostControls,
  };
}
