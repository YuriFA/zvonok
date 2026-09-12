import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { DeviceSettingsPanel } from "@/features/media/components/device-settings-panel";

import { useRoomAudioContext } from "../contexts/room-audio.context";

interface Props {
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  isOwner: boolean;
  onEndRoom: () => void;
  isEndingRoom: boolean;
}

export function ActiveRoomHeader({
  isVideoEnabled,
  isAudioEnabled,
  isOwner,
  onEndRoom,
  isEndingRoom,
}: Props) {
  const { setSink } = useRoomAudioContext();

  return (
    <Header>
      <div className="flex items-center gap-2">
        <DeviceSettingsPanel
          setSink={setSink}
          isVideoEnabled={isVideoEnabled}
          isAudioEnabled={isAudioEnabled}
        />
        {isOwner && (
          <Button variant="destructive" onClick={onEndRoom} disabled={isEndingRoom}>
            {isEndingRoom ? "Ending..." : "End Room"}
          </Button>
        )}
      </div>
    </Header>
  );
}
