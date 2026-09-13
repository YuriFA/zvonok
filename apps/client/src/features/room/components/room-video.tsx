import { useVideoStream } from "@zvonok/react";
import { Mic, MicOff } from "lucide-react";
import { memo, useRef } from "react";

import { usePeerQualityContext, usePeerViewport } from "../contexts/peer-quality.context";
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

/**
 * Memoized: the room tracker preserves per-participant references, so a
 * room event that touches someone else must not re-render this tile. The
 * grid keeps style objects stable across unrelated updates (see
 * active-room-view).
 */
export const RoomVideo = memo(function RoomVideo({
  userId,
  stream,
  username,
  isVideoEnabled,
  isAudioEnabled,
  style,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  usePeerViewport(tileRef, userId);
  const { store: qualityStore } = usePeerQualityContext();

  useVideoStream(videoRef, stream);

  return (
    <RoomVideoSpeakerTile ref={tileRef} userId={userId} style={style}>
      <div className="relative size-full overflow-hidden rounded-lg bg-muted">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="size-full mirror object-cover"
        />

        {!isVideoEnabled && <RoomVideoAudioOverlay userId={userId} username={username} />}

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
});
