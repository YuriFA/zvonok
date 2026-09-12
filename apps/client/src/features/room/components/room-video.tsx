import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef } from "react";

import { usePeerQualityContext } from "../contexts/peer-quality.context";
import { RoomVideoAudioOverlay } from "./room-video-audio-overlay";
import { RoomVideoQualityBadge } from "./room-video-quality-badge";
import { RoomVideoSpeakerTile } from "./room-video-speaker-tile";

interface Props extends React.ComponentProps<"div"> {
  userId: string;
  stream: MediaStream | null;
  username?: string;
  isVideoEnabled?: boolean;
  isAudioEnabled?: boolean;
}

export function RoomVideo({
  userId,
  stream,
  username,
  isVideoEnabled,
  isAudioEnabled,
  style,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { store: qualityStore } = usePeerQualityContext();

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <RoomVideoSpeakerTile userId={userId} style={style}>
      <div className="relative size-full overflow-hidden rounded-lg bg-muted">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="size-full mirror object-cover"
        />

        {!isVideoEnabled && (
          <RoomVideoAudioOverlay userId={userId} username={username} />
        )}

        {username && (
          <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
            {username}
          </div>
        )}

        <div className="absolute right-2 bottom-2 flex gap-1">
          <RoomVideoQualityBadge qualityStore={qualityStore} userId={userId} />
          <div className="rounded bg-black/50 px-2 py-1 text-white">
            {isAudioEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </div>
        </div>
      </div>
    </RoomVideoSpeakerTile>
  );
}
