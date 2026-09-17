import { PeerQualityProvider, type UseZvonokConnectionResult } from "@zvonok/react";
import { useNavigate } from "react-router";

import { useIsMobile } from "@/hooks/use-is-mobile";

import { RoomAudioContextProvider } from "../contexts/room-audio.context";
import { useRoomIdentity } from "../contexts/room-identity.context";
import { RoomSessionProvider, useRoomSession } from "../contexts/room-session.context";
import { useEndRoom } from "../hooks/use-end-room";
import type { Room } from "../types/room.types";
import { ActiveRoomHeader } from "./active-room-header";
import { ActiveRoomView } from "./active-room-view";
import { RoomAlerts } from "./room-alerts";

interface Props {
  room: Room;
  connection: UseZvonokConnectionResult;
}

export const RoomView = ({ room, connection }: Props) => (
  <RoomSessionProvider connection={connection}>
    <RoomViewContent room={room} />
  </RoomSessionProvider>
);

/** Inside the session provider: composes the providers and chrome around the room. */
function RoomViewContent({ room }: { room: Room }) {
  const navigate = useNavigate();
  const endRoom = useEndRoom({
    onSuccess: () => navigate("/"),
  });
  const { userId } = useRoomIdentity();
  const { camera, microphone, connectionState, wasKicked } = useRoomSession();
  const isMobile = useIsMobile();
  const isOwner = userId === room.ownerId;

  return (
    <PeerQualityProvider enabled={connectionState === "connected"} isMobile={isMobile}>
      <RoomAudioContextProvider>
        <div className="flex h-dscreen flex-col" data-testid="room-view">
          <ActiveRoomHeader
            isVideoEnabled={camera.isEnabled}
            isAudioEnabled={microphone.isEnabled}
            isOwner={isOwner}
            onEndRoom={() => endRoom.mutate(room.id)}
            isEndingRoom={endRoom.isPending}
          />

          <RoomAlerts endRoomError={!!endRoom.error} wasKicked={wasKicked} />

          <ActiveRoomView room={room} />
        </div>
      </RoomAudioContextProvider>
    </PeerQualityProvider>
  );
}
