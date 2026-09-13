import type { HostControls } from "@zvonok/react";
import type { UseZvonokConnectionResult } from "@zvonok/react";
import { useCallback } from "react";

import type { Participant } from "@/components/room/participants-list";
import { useMediaStreamContext } from "@/features/media/contexts/media-stream.context";
import type { UseMediaControlsReturn } from "@/features/media/hooks/use-media-controls";
import { useRoomParticipants } from "@/features/room/hooks/use-room-participants";
import { useRoomSfu, type RemotePeerMedia } from "@/features/room/hooks/use-room-sfu";

export interface UseRoomSessionOptions {
  userId: string | undefined;
  displayName: string;
  connection: UseZvonokConnectionResult;
}

export interface UseRoomSessionResult {
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  mediaControls: UseMediaControlsReturn;
  toggleVideo: () => Promise<void>;
  toggleAudio: () => Promise<void>;
  connectionState: string;
  capabilities: string[];
  remotePeers: RemotePeerMedia[];
  wasKicked: boolean;
  kickPeer: (userId: string) => Promise<void>;
  participants: Participant[];
  localUserId: string;
  isRoomLocked: boolean;
  mutedByHost: boolean;
  hostControls: HostControls;
}

export function useRoomSession({
  userId,
  displayName,
  connection,
}: UseRoomSessionOptions): UseRoomSessionResult {
  const {
    videoStream: localVideoStream,
    audioStream: localAudioStream,
    stop: stopMedia,
    ensureAudio,
    ensureVideo,
  } = useMediaStreamContext();

  const localUserId = userId ?? "local";

  const handleKicked = useCallback(() => {
    stopMedia();
  }, [stopMedia]);

  const {
    connectionState,
    capabilities,
    remotePeers,
    wasKicked,
    kickPeer,
    mediaControls,
    toggleVideo,
    toggleAudio,
    isRoomLocked,
    mutedByHost,
    hostControls,
  } = useRoomSfu({
    localVideoStream,
    localAudioStream,
    onKicked: handleKicked,
    connection,
    ensureAudio,
    ensureVideo,
  });

  const { participants } = useRoomParticipants({
    userId,
    username: displayName,
    isAudioEnabled: mediaControls.isAudioEnabled,
    isVideoEnabled: mediaControls.isVideoEnabled,
    connectionState,
    remotePeers,
  });

  return {
    localVideoStream,
    localAudioStream,
    mediaControls,
    toggleVideo,
    toggleAudio,
    connectionState,
    capabilities,
    remotePeers,
    wasKicked,
    kickPeer,
    participants,
    localUserId,
    isRoomLocked,
    mutedByHost,
    hostControls,
  };
}
