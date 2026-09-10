import type { SfuState } from "@zvonok/client/sfu/types";
import type { HostControls } from "@zvonok/react";
import { useCallback } from "react";

import type { Participant } from "@/components/room/participants-list";
import { useMediaStreamContext } from "@/features/media/contexts/media-stream.context";
import type { UseMediaControlsReturn } from "@/features/media/hooks/use-media-controls";
import { useRoomParticipants } from "@/features/room/hooks/use-room-participants";
import { useRoomSfu } from "@/features/room/hooks/use-room-sfu";
import type { Room } from "@/features/room/types/room.types";
import type { RemotePeerMedia } from "@/hooks/use-mediasoup";

export interface UseRoomSessionOptions {
  room: Room;
  userId: string | undefined;
  displayName: string;
}

export interface UseRoomSessionResult {
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  mediaControls: UseMediaControlsReturn;
  toggleVideo: () => Promise<void>;
  toggleAudio: () => Promise<void>;
  sfuState: SfuState;
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
  room,
  userId,
  displayName,
}: UseRoomSessionOptions): UseRoomSessionResult {
  const {
    videoStream: localVideoStream,
    audioStream: localAudioStream,
    stop: stopMedia,
  } = useMediaStreamContext();

  const localUserId = userId ?? "local";

  const handleKicked = useCallback(() => {
    stopMedia();
  }, [stopMedia]);

  const {
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
  } = useRoomSfu({
    roomId: room.id,
    roomSlug: room.slug,
    localVideoStream,
    localAudioStream,
    onKicked: handleKicked,
    displayName,
  });

  const { participants } = useRoomParticipants({
    userId,
    username: displayName,
    isAudioEnabled: mediaControls.isAudioEnabled,
    isVideoEnabled: mediaControls.isVideoEnabled,
    connectionState: sfuState.connectionState,
    remotePeers,
  });

  return {
    localVideoStream,
    localAudioStream,
    mediaControls,
    toggleVideo,
    toggleAudio,
    sfuState,
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
