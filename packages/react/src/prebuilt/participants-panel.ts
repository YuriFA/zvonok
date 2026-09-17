/**
 * Participants panel block: roster ordering, capability-gated host actions,
 * and guest-request pass-through, plus the preset-styled panel. The core is
 * markup-free; host-action outcomes surface as typed notices so copy and
 * notification channels stay with the consumer.
 */

import type { QualityScore, QualityStats } from "@zvonok/client/sfu/types";
import type { SfuGuestJoinRequestPayload } from "@zvonok/client/sfu/types";

import { hasCapabilities } from "../wrappers/capability-gate.js";
import type { UseZvonokCallResult } from "../hooks/use-zvonok-call.js";
import { useCallback, useMemo } from "react";

/** The projection a panel renders per participant. */
export interface PanelParticipant {
  id: string;
  userId?: string;
  username: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isConnected: boolean;
  isSpeaking?: boolean;
  isMutedByHost?: boolean;
  qualityScore?: QualityScore;
  qualityStats?: QualityStats;
}

export type PanelNoticeKey =
  | "mute-all-failed"
  | "lock-failed"
  | "mute-participant-failed"
  | "kick-participant-failed";

export interface PanelNotice {
  key: PanelNoticeKey;
  message: string;
}

export interface UseParticipantsPanelOptions {
  call: UseZvonokCallResult;
  /** Roster override; defaults to the call's participant projection. */
  participants?: PanelParticipant[];
  /** Defaults to the call's local user id. */
  currentUserId?: string;
  /** Room-owner knowledge stays with the consumer (default false). */
  isOwner?: boolean;
  /** Capability overrides; default derived from the call's capabilities. */
  canMuteAll?: boolean;
  canLockRoom?: boolean;
  canRemoveParticipants?: boolean;
  /** Guest approval policy stays with the consumer. */
  pendingRequests?: SfuGuestJoinRequestPayload[];
  onApproveRequest?: (requestId: string) => Promise<void>;
  onDenyRequest?: (requestId: string) => Promise<void>;
  onNotice?: (notice: PanelNotice) => void;
}

export interface ParticipantsPanel {
  participants: PanelParticipant[];
  isRoomLocked: boolean;
  canMuteAll: boolean;
  canLockRoom: boolean;
  muteAll(): Promise<boolean>;
  toggleLock(): Promise<boolean>;
  canMuteParticipant(participant: PanelParticipant): boolean;
  canKickParticipant(participant: PanelParticipant): boolean;
  muteParticipant(userId: string): Promise<boolean>;
  kickParticipant(userId: string): Promise<boolean>;
  pendingRequests: SfuGuestJoinRequestPayload[];
  hasPendingRequests: boolean;
  canReviewRequests: boolean;
  approveRequest(requestId: string): Promise<void>;
  denyRequest(requestId: string): Promise<void>;
}

const NOTICE_COPY: Record<PanelNoticeKey, string> = {
  "mute-all-failed": "Could not mute everyone",
  "lock-failed": "Could not change the room lock",
  "mute-participant-failed": "Could not mute the participant",
  "kick-participant-failed": "Could not remove the participant",
};

export function useParticipantsPanel(
  options: UseParticipantsPanelOptions,
): ParticipantsPanel {
  const {
    call,
    participants: participantsOverride,
    currentUserId = call.localUserId,
    isOwner = false,
    canMuteAll: canMuteAllOverride,
    canLockRoom: canLockRoomOverride,
    canRemoveParticipants: canRemoveOverride,
    pendingRequests = [],
    onApproveRequest,
    onDenyRequest,
    onNotice,
  } = options;

  const participants = useMemo(() => {
    if (participantsOverride) {
      return participantsOverride;
    }
    return call.participants.map((participant) => ({
      id: participant.userId,
      userId: participant.userId,
      username: participant.displayName || participant.userId,
      isMuted: !participant.isAudioEnabled,
      isVideoOff: !participant.isCameraEnabled,
      isConnected: participant.isConnected,
      isMutedByHost: participant.mutedByHost,
    }));
  }, [participantsOverride, call.participants]);

  // Local first, connected before disconnected, then by name.
  const sorted = useMemo(
    () =>
      [...participants].sort((a, b) => {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
        if (a.isConnected !== b.isConnected) {
          return a.isConnected ? -1 : 1;
        }
        return a.username.localeCompare(b.username);
      }),
    [participants, currentUserId],
  );

  const canMuteAll = canMuteAllOverride ?? hasCapabilities(call.capabilities, "mute-users");
  const canLockRoom = canLockRoomOverride ?? hasCapabilities(call.capabilities, "lock-room");
  const canRemove =
    canRemoveOverride ?? hasCapabilities(call.capabilities, "remove-participants");

  const runAction = useCallback(
    async (key: PanelNoticeKey, action: () => Promise<void>): Promise<boolean> => {
      try {
        await action();
        return true;
      } catch {
        onNotice?.({ key, message: NOTICE_COPY[key] });
        return false;
      }
    },
    [onNotice],
  );

  const muteAll = useCallback(
    () => runAction("mute-all-failed", () => call.hostControls.muteAll()),
    [runAction, call.hostControls],
  );

  const toggleLock = useCallback(
    () =>
      runAction("lock-failed", () => call.hostControls.lockRoom(!call.isRoomLocked)),
    [runAction, call.hostControls, call.isRoomLocked],
  );

  const canMuteParticipant = useCallback(
    (participant: PanelParticipant) =>
      canMuteAll && participant.id !== currentUserId && !participant.isMutedByHost,
    [canMuteAll, currentUserId],
  );

  const canKickParticipant = useCallback(
    (participant: PanelParticipant) => canRemove && participant.id !== currentUserId,
    [canRemove, currentUserId],
  );

  const muteParticipant = useCallback(
    (userId: string) =>
      runAction("mute-participant-failed", () => call.hostControls.mutePeer(userId)),
    [runAction, call.hostControls],
  );

  const kickParticipant = useCallback(
    (userId: string) => runAction("kick-participant-failed", () => call.kickPeer(userId)),
    [runAction, call.kickPeer],
  );

  const hasPendingRequests = isOwner && pendingRequests.length > 0;

  const approveRequest = useCallback(
    async (requestId: string) => {
      await onApproveRequest?.(requestId);
    },
    [onApproveRequest],
  );

  const denyRequest = useCallback(
    async (requestId: string) => {
      await onDenyRequest?.(requestId);
    },
    [onDenyRequest],
  );

  return {
    participants: sorted,
    isRoomLocked: call.isRoomLocked,
    canMuteAll,
    canLockRoom,
    muteAll,
    toggleLock,
    canMuteParticipant,
    canKickParticipant,
    muteParticipant,
    kickParticipant,
    pendingRequests,
    hasPendingRequests,
    canReviewRequests: isOwner,
    approveRequest,
    denyRequest,
  };
}
