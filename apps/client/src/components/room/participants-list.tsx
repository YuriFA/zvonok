import type { ParticipantsPanel } from "@zvonok/react";

import { Button } from "@/components/ui/button";

import { ParticipantItem } from "./participant-item";

export interface ParticipantsListProps {
  /** The package panel projection: roster ordering, capability gating, actions. */
  panel: ParticipantsPanel;
  /** Local participant identity, for the "(you)" marker. */
  currentUserId?: string;
  className?: string;
}

/**
 * App markup for the participants panel. All behavior - ordering, mute/kick
 * capability gating, host actions, guest-request queue - comes from the
 * package's `ParticipantsPanel`; this component renders it in app style.
 */
export function ParticipantsList({ panel, currentUserId, className }: ParticipantsListProps) {
  return (
    <div className={className}>
      {panel.participants.length === 0 ? (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">No participants</p>
      ) : (
        <ul className="space-y-1" aria-label="Participants list">
          {panel.participants.map((participant) => (
            <ParticipantItem
              key={participant.id}
              participant={participant}
              isLocalUser={participant.id === currentUserId}
              canMute={panel.canMuteParticipant(participant)}
              onMute={(id) => void panel.muteParticipant(id)}
              canKick={panel.canKickParticipant(participant)}
              onKick={(id) => void panel.kickParticipant(id)}
            />
          ))}
        </ul>
      )}

      {panel.hasPendingRequests && (
        <div className="border-t">
          <div className="px-4 py-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Pending Requests
            </span>
          </div>
          <ul className="space-y-1 px-2 pb-2" aria-label="Pending join requests">
            {panel.pendingRequests.map((req) => (
              <li
                key={req.requestId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
              >
                <span className="truncate text-sm">{req.displayName}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => void panel.approveRequest(req.requestId)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => void panel.denyRequest(req.requestId)}
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
