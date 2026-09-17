/**
 * Participants panel preset: roster with capability-gated host actions and
 * the guest-request section, zk-styled. Runs the panel core internally;
 * approval policy and custom item markup stay with the consumer.
 */

import { Fragment } from "react";

import type { UseZvonokCallResult } from "../../index.js";
import type { PanelNotice, PanelParticipant } from "./participants-panel.js";
import { useParticipantsPanel } from "./participants-panel.js";

export interface ParticipantsPanelPresetProps {
  call: UseZvonokCallResult;
  /** Room-owner knowledge stays with the consumer. */
  isOwner?: boolean;
  /** Roster override; defaults to the call's participant projection. */
  participants?: PanelParticipant[];
  pendingRequests?: Parameters<typeof useParticipantsPanel>[0]["pendingRequests"];
  onApproveRequest?: (requestId: string) => Promise<void>;
  onDenyRequest?: (requestId: string) => Promise<void>;
  onNotice?: (notice: PanelNotice) => void;
  /** Replace one roster row (headless equivalent of the item markup). */
  renderItem?: (participant: PanelParticipant) => React.ReactNode;
  className?: string;
}

const COPY = {
  muteAll: "Mute all",
  lock: "Lock room",
  unlock: "Unlock room",
  mute: "Mute",
  kick: "Remove",
  approve: "Approve",
  deny: "Deny",
  pending: "Pending requests",
} as const;

export function ParticipantsPanelPreset({
  call,
  isOwner,
  participants,
  pendingRequests,
  onApproveRequest,
  onDenyRequest,
  onNotice,
  renderItem,
  className,
}: ParticipantsPanelPresetProps) {
  const panel = useParticipantsPanel({
    call,
    participants,
    isOwner,
    pendingRequests,
    onApproveRequest,
    onDenyRequest,
    onNotice,
  });

  return (
    <div className={["zk-panel", className].filter(Boolean).join(" ")}>
      {(panel.canMuteAll || panel.canLockRoom) && (
        <div className="zk-panel-actions">
          {panel.canMuteAll && (
            <button type="button" className="zk-button" onClick={() => void panel.muteAll()}>
              {COPY.muteAll}
            </button>
          )}
          {panel.canLockRoom && (
            <button
              type="button"
              className="zk-button"
              aria-pressed={panel.isRoomLocked}
              onClick={() => void panel.toggleLock()}
            >
              {panel.isRoomLocked ? COPY.unlock : COPY.lock}
            </button>
          )}
        </div>
      )}
      <ul className="zk-participants" aria-label="Participants list">
        {panel.participants.map((participant) => (
          <Fragment key={participant.id}>
            {renderItem ? (
              renderItem(participant)
            ) : (
              <li className="zk-participant" aria-label={`Participant ${participant.username}`}>
                <span className="zk-participant-name">{participant.username}</span>
                {panel.canMuteParticipant(participant) && (
                  <button
                    type="button"
                    className="zk-button"
                    onClick={() => void panel.muteParticipant(participant.id)}
                  >
                    {COPY.mute}
                  </button>
                )}
                {panel.canKickParticipant(participant) && (
                  <button
                    type="button"
                    className="zk-button zk-button-leave"
                    onClick={() => void panel.kickParticipant(participant.id)}
                  >
                    {COPY.kick}
                  </button>
                )}
              </li>
            )}
          </Fragment>
        ))}
      </ul>
      {panel.hasPendingRequests && (
        <div className="zk-panel-requests">
          <span className="zk-panel-requests-title">{COPY.pending}</span>
          <ul aria-label="Pending join requests">
            {panel.pendingRequests.map((request) => (
              <li key={request.requestId} className="zk-participant">
                <span className="zk-participant-name">{request.displayName}</span>
                <button
                  type="button"
                  className="zk-button zk-button-join"
                  onClick={() => void panel.approveRequest(request.requestId)}
                >
                  {COPY.approve}
                </button>
                <button
                  type="button"
                  className="zk-button"
                  onClick={() => void panel.denyRequest(request.requestId)}
                >
                  {COPY.deny}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
