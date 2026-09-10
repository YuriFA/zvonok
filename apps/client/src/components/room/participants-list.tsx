import type { SfuGuestJoinRequestPayload } from "@zvonok/client/sfu/types";
import type { QualityScore, QualityStats } from "@zvonok/client/sfu/types";

import { Button } from "@/components/ui/button";

import { ParticipantItem } from "./participant-item";

export interface Participant {
  id: string;
  userId?: string;
  username: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isConnected: boolean;
  isSpeaking?: boolean;
  qualityScore?: QualityScore;
  qualityStats?: QualityStats;
}

export interface ParticipantsListProps {
  className?: string;
  participants: Participant[];
  currentUserId?: string;
  roomOwnerId?: string;
  onKickParticipant?: (participantId: string) => void;
  onMuteParticipant?: (participantId: string) => void;
  pendingRequests?: SfuGuestJoinRequestPayload[];
  onApproveRequest?: (requestId: string) => Promise<void>;
  onDenyRequest?: (requestId: string) => Promise<void>;
}

export function ParticipantsList({
  participants,
  currentUserId,
  roomOwnerId,
  onKickParticipant,
  onMuteParticipant,
  pendingRequests,
  onApproveRequest,
  onDenyRequest,
  className,
}: ParticipantsListProps) {
  const isOwner = currentUserId === roomOwnerId;

  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    if (a.isConnected !== b.isConnected) {
      return a.isConnected ? -1 : 1;
    }
    return a.username.localeCompare(b.username);
  });

  const hasPendingRequests = isOwner && pendingRequests && pendingRequests.length > 0;

  return (
    <div className={className}>
      {participants.length === 0 ? (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">No participants</p>
      ) : (
        <ul className="space-y-1" aria-label="Participants list">
          {sortedParticipants.map((participant) => (
            <ParticipantItem
              key={participant.id}
              {...participant}
              isLocalUser={participant.id === currentUserId}
              canKick={Boolean(onKickParticipant)}
              onKick={onKickParticipant}
              canMute={Boolean(onMuteParticipant)}
              onMute={onMuteParticipant}
            />
          ))}
        </ul>
      )}

      {hasPendingRequests && (
        <div className="border-t">
          <div className="px-4 py-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Pending Requests
            </span>
          </div>
          <ul className="space-y-1 px-2 pb-2" aria-label="Pending join requests">
            {pendingRequests.map((req) => (
              <li
                key={req.requestId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
              >
                <span className="truncate text-sm">{req.displayName}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onApproveRequest?.(req.requestId)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => onDenyRequest?.(req.requestId)}
                  >
                    Deny
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
