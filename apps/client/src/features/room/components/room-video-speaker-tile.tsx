import { VideoTile } from "@/components/video-grid";
import { useActiveSpeakerId } from "@/features/room/contexts/room-audio.context";

interface Props extends React.ComponentProps<"div"> {
  userId: string;
}

export function RoomVideoSpeakerTile({ userId, children, ...rest }: Props) {
  const activeSpeakerId = useActiveSpeakerId();

  return (
    <VideoTile isActiveSpeaker={activeSpeakerId === userId} {...rest}>
      {children}
    </VideoTile>
  );
}
