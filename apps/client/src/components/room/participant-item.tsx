import type { PanelParticipant } from "@zvonok/react";
import { Mic, MicOff, Video, VideoOff, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAvatarColor } from "@/lib/utils/display-name";

import { QualityIndicator } from "./quality-indicator";

export interface ParticipantItemProps {
  participant: PanelParticipant;
  isLocalUser?: boolean;
  canKick?: boolean;
  onKick?: (id: string) => void;
  canMute?: boolean;
  onMute?: (id: string) => void;
}

export function ParticipantItem({
  participant,
  isLocalUser,
  canKick,
  onKick,
  canMute,
  onMute,
}: ParticipantItemProps) {
  const {
    id,
    username,
    isMuted,
    isVideoOff,
    isConnected,
    isMutedByHost,
    qualityScore,
    qualityStats,
  } = participant;
  const initial = username.charAt(0).toUpperCase() || "?";
  const avatarColor = getAvatarColor(username);

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        !isConnected && "opacity-50",
      )}
      aria-label={`Participant ${username}${isLocalUser ? " (you)" : ""}`}
    >
      <div className="relative flex-shrink-0">
        <div
          className="flex size-8 items-center justify-center rounded-full text-sm"
          style={{ backgroundColor: avatarColor }}
        >
          {initial}
        </div>
        {!isConnected && (
          <div
            className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-red-500"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{username}</span>
          {isLocalUser && <span className="text-xs text-muted-foreground">(you)</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {!isConnected && <span className="text-red-500">Disconnected</span>}
          {isMutedByHost && (
            <span className="flex items-center gap-1 text-amber-500" aria-label="Muted by host">
              <MicOff className="size-3" />
              Muted by host
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {isMuted ? (
          <MicOff className="size-4 text-red-500" aria-label="Muted" />
        ) : (
          <Mic className="size-4 text-green-500" aria-label="Microphone on" />
        )}
        {isVideoOff ? (
          <VideoOff className="size-4 text-red-500" aria-label="Camera off" />
        ) : (
          <Video className="size-4 text-green-500" aria-label="Camera on" />
        )}
      </div>

      {/* Quality indicator - only show for remote users with quality data */}
      {qualityScore && <QualityIndicator score={qualityScore} stats={qualityStats} />}

      {canMute && onMute && !isLocalUser && !isMutedByHost && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Mute ${username}`}
          onClick={() => onMute(id)}
        >
          <MicOff className="size-3.5" />
        </Button>
      )}

      {canKick && onKick && !isLocalUser && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-red-500 hover:text-red-600"
          aria-label={`Kick ${username}`}
          onClick={() => onKick(id)}
        >
          <UserX className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
