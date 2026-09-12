import type { UseZvonokConnectionResult } from "@zvonok/react";
import { useNavigate } from "react-router";

import { useAuth } from "@/features/auth/contexts/auth.context";

import { PeerQualityProvider } from "../contexts/peer-quality.context";
import { RoomAudioContextProvider } from "../contexts/room-audio.context";
import { useEndRoom } from "../hooks/use-end-room";
import { useRoomSession } from "../hooks/use-room-session";
import type { Room } from "../types/room.types";
import { ActiveRoomHeader } from "./active-room-header";
import { ActiveRoomView } from "./active-room-view";
import { RoomAlerts } from "./room-alerts";

interface Props {
  room: Room;
  displayName: string;
  currentUserId: string | undefined;
  connection: UseZvonokConnectionResult;
}

export const RoomView = ({ room, displayName, currentUserId, connection }: Props) => {
  const navigate = useNavigate();
  const endRoom = useEndRoom({
    onSuccess: () => navigate("/"),
  });
  const { user } = useAuth();
  const isOwner = user?.id === room.ownerId;
  const session = useRoomSession({ userId: user?.id, displayName, connection });


  return (
    <PeerQualityProvider enabled={session.connectionState === "connected"}>
      <RoomAudioContextProvider session={session}>
        <div className="flex h-dscreen flex-col" data-testid="room-view">
          <ActiveRoomHeader
            isVideoEnabled={session.mediaControls.isVideoEnabled}
            isAudioEnabled={session.mediaControls.isAudioEnabled}
            isOwner={isOwner}
            onEndRoom={() => endRoom.mutate(room.id)}
            isEndingRoom={endRoom.isPending}
          />

          <RoomAlerts endRoomError={!!endRoom.error} wasKicked={session.wasKicked} />

          <ActiveRoomView
            session={session}
            room={room}
            currentUserId={currentUserId}
            currentUsername={displayName}
          />
        </div>
      </RoomAudioContextProvider>
    </PeerQualityProvider>
  );
};
