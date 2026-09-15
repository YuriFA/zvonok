import type { SfuManager } from "@zvonok/client/sfu/manager";
import {
  createHostControls,
  EMPTY_ROOM_STATE,
  RoomTracker,
  usePublishControls,
  useSfuTrackSync,
  useStoreSelector,
  type HostControls,
  type RoomTrackerState,
  type UseZvonokConnectionResult,
  type ZvonokParticipant,
} from "@zvonok/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/features/auth/contexts/auth.context";
import {
  useMediaControls,
  type UseMediaControlsReturn,
} from "@/features/media/hooks/use-media-controls";
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
  isConnected: boolean;
  mutedByHost: boolean;
}

export interface UseRoomSfuOptions {
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  onKicked: () => void;
  connection: UseZvonokConnectionResult;
  /** (Re)acquires the camera; used when no live video track exists. */
  ensureVideo: () => Promise<MediaStream | null>;
  /** (Re)acquires the microphone; used when no live audio track exists. */
  ensureAudio: () => Promise<MediaStream | null>;
  /** Releases the camera capture track when the camera is toggled off. */
  stopVideoCapture: () => Promise<boolean>;
  /** Releases the microphone capture track when the mic is toggled off. */
  stopAudioCapture: () => Promise<boolean>;
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
    isConnected: participant.isConnected,
    mutedByHost: participant.mutedByHost,
  };
}

export function useRoomSfu({
  localVideoStream,
  localAudioStream,
  onKicked,
  connection,
  ensureVideo,
  ensureAudio,
  stopVideoCapture,
  stopAudioCapture,
}: UseRoomSfuOptions): UseRoomSfuResult {
  const isMobile = useIsMobile();
  const manager = connection.manager;
  const mediaControls = useMediaControls();

  // When a capture restarts (device switch) while a producer exists, the
  // published track is swapped in place.
  useSfuTrackSync();

  const publish = usePublishControls(connection, { isMobile });

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
  const roomState = useStoreSelector(tracker, selectRoomState) ?? EMPTY_ROOM_STATE;

  // Manager connection state, mirrored for consumers (participants list,
  // auto-quality gate). Same vocabulary as before the migration.
  const [connectionState, setConnectionState] = useState(
    () => manager?.getState().connectionState ?? "disconnected",
  );
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

  const toggleVideo = useCallback(async () => {
    const nextEnabled = !mediaControls.isVideoEnabled;
    mediaControls.setVideoEnabled(nextEnabled);
    const result = await publish.toggle("video", nextEnabled, {
      getTrack: () => localVideoStream?.getVideoTracks()[0],
      ensureTrack: ensureVideo,
      release: stopVideoCapture,
    });
    if (result === "no-track" || result === "produce-failed") {
      mediaControls.setVideoEnabled(false);
    } else if (result === "replace-failed") {
      toast.error("Failed to restart the camera");
      mediaControls.setVideoEnabled(false);
    }
  }, [mediaControls, localVideoStream, ensureVideo, publish, stopVideoCapture]);

  const toggleAudio = useCallback(async () => {
    const nextEnabled = !mediaControls.isAudioEnabled;
    mediaControls.setAudioEnabled(nextEnabled);
    const result = await publish.toggle("audio", nextEnabled, {
      getTrack: () => localAudioStream?.getAudioTracks()[0],
      ensureTrack: ensureAudio,
      release: stopAudioCapture,
    });
    if (result === "no-track" || result === "produce-failed") {
      mediaControls.setAudioEnabled(false);
    } else if (result === "replace-failed") {
      toast.error("Failed to restart the microphone");
      mediaControls.setAudioEnabled(false);
    }
  }, [mediaControls, localAudioStream, ensureAudio, publish, stopAudioCapture]);

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

  const remotePeers = useMemo(
    () => roomState.participants.map(toRemotePeer),
    [roomState.participants],
  );

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

const selectRoomState = (state: RoomTrackerState) => state;
