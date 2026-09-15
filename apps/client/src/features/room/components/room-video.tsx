import { Tile } from "@zvonok/react";
import { Mic, MicOff } from "lucide-react";
import { memo } from "react";

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
 *
 * Media plumbing (video element binding, viewport-visibility tracking)
 * lives in the package Tile; this component only layers the app's visual
 * seams on top: speaker ring wrapper, avatar overlay, badges.
 */
export const RoomVideo = memo(function RoomVideo({
  userId,
  stream,
  username,
  isVideoEnabled,
  isAudioEnabled,
  style,
}: Props) {
  return (
    <RoomVideoSpeakerTile userId={userId} style={style}>
      <Tile
        userId={userId}
        stream={stream}
        isVideoEnabled={isVideoEnabled}
        isMuted
        className="size-full overflow-hidden rounded-lg bg-muted"
        videoClassName="size-full mirror object-cover"
        OverlayUI={<RoomVideoAudioOverlay userId={userId} username={username} />}
      >
        {username && (
          <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
            {username}
          </div>
        )}

        <div className="absolute right-2 bottom-2 flex gap-1">
          <RoomVideoQualityBadge userId={userId} />
          <div className="rounded bg-black/50 px-2 py-1 text-white">
            {isAudioEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </div>
        </div>
      </Tile>
    </RoomVideoSpeakerTile>
  );
});
