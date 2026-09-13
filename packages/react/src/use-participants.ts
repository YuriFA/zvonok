/**
 * Participants hook: peer join/leave and track subscribe/unsubscribe as
 * React state, grouped per participant by media source. Thin React binding
 * over the framework-free RoomTracker.
 */

import { useEffect, useMemo } from "react";

import { EMPTY_ROOM_STATE, RoomTracker, type RoomTrackerState } from "./room-tracker.js";
import type { ZvonokParticipant } from "./types.js";
import { useStoreSelector } from "./use-store-selector.js";
import { useZvonokSession } from "./zvonok-context.js";

export interface UseParticipantsResult {
  participants: ZvonokParticipant[];
}

export function useParticipants(): UseParticipantsResult {
  const session = useZvonokSession();
  const manager = session.manager;
  const tracker = useMemo(() => (manager ? new RoomTracker(manager) : null), [manager]);

  useEffect(() => () => tracker?.stop(), [tracker]);

  const participants =
    useStoreSelector(tracker, selectParticipants) ?? EMPTY_ROOM_STATE.participants;

  return { participants };
}

const selectParticipants = (state: RoomTrackerState): ZvonokParticipant[] => state.participants;
