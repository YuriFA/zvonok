import type { SfuState } from "@zvonok/client/sfu/types";
import type { HostControls } from "@zvonok/react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  useVideoCaptureControl,
  useAudioCaptureControl,
  useCaptureTrackProvider,
} from "@/features/media/contexts/media-manager.context";
import {
  useMediaControls,
  type UseMediaControlsReturn,
} from "@/features/media/hooks/use-media-controls";
import { useSfuTrackSync } from "@/features/media/hooks/use-sfu-track-sync";
import { useMediasoup, type RemotePeerMedia } from "@/hooks/use-mediasoup";

export interface UseRoomSfuOptions {
  roomId: string;
  roomSlug: string;
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  onKicked: () => void;
  displayName: string;
}

export interface UseRoomSfuResult {
  sfuState: SfuState;
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

export function useRoomSfu({
  roomId,
  roomSlug,
  localVideoStream,
  localAudioStream,
  onKicked,
  displayName,
}: UseRoomSfuOptions): UseRoomSfuResult {
  const videoControl = useVideoCaptureControl();
  const audioControl = useAudioCaptureControl();
  const videoTrackProvider = useCaptureTrackProvider("video");
  const audioTrackProvider = useCaptureTrackProvider("audio");
  const mediaControls = useMediaControls();

  useSfuTrackSync();

  const {
    state: sfuState,
    remotePeers,
    kickPeer,
    wasKicked,
    produceTrack,
    pauseProducer,
    resumeProducer,
    replaceTrack,
    hasProducer,
    isRoomLocked,
    mutedByHost,
    hostControls,
  } = useMediasoup({
    roomId,
    roomSlug,
    localVideoStream,
    localAudioStream,
    displayName,
  });

  useEffect(() => {
    if (wasKicked) {
      onKicked();
    }
  }, [wasKicked, onKicked]);

  // A server-enforced host mute pauses our producer; reflect it in the mic
  // control and tell the user once per occurrence.
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

    if (nextEnabled) {
      const success = await videoControl.toggle(true);
      if (!success) {
        mediaControls.setVideoEnabled(false);
        return;
      }

      const track = videoTrackProvider.getTrack();
      if (!track) {
        mediaControls.setVideoEnabled(false);
        return;
      }

      if (!hasProducer("video")) {
        const produced = await produceTrack(track);
        if (!produced) {
          videoControl.stop();
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
        videoControl.stop();
        mediaControls.setVideoEnabled(false);
        return;
      }
      resumeProducer("video");
    } else {
      if (hasProducer("video")) {
        pauseProducer("video");
      }
      videoControl.stop();
    }
  }, [
    videoControl,
    videoTrackProvider,
    produceTrack,
    replaceTrack,
    mediaControls,
    hasProducer,
    pauseProducer,
    resumeProducer,
  ]);

  const toggleAudio = useCallback(async () => {
    const nextEnabled = !mediaControls.isAudioEnabled;
    mediaControls.setAudioEnabled(nextEnabled);

    if (nextEnabled) {
      const success = await audioControl.toggle(true);
      if (!success) {
        mediaControls.setAudioEnabled(false);
        return;
      }

      const track = audioTrackProvider.getTrack();
      if (!track) {
        mediaControls.setAudioEnabled(false);
        return;
      }

      if (!hasProducer("audio")) {
        const produced = await produceTrack(track);
        if (!produced) {
          audioControl.stop();
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
        audioControl.stop();
        mediaControls.setAudioEnabled(false);
        return;
      }
      resumeProducer("audio");
    } else {
      if (hasProducer("audio")) {
        pauseProducer("audio");
      }
      audioControl.stop();
    }
  }, [
    audioControl,
    audioTrackProvider,
    produceTrack,
    replaceTrack,
    mediaControls,
    hasProducer,
    pauseProducer,
    resumeProducer,
  ]);

  return {
    sfuState,
    remotePeers,
    wasKicked,
    kickPeer,
    mediaControls,
    toggleVideo,
    toggleAudio,
    isRoomLocked,
    mutedByHost,
    hostControls,
  };
}
