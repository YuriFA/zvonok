/**
 * Guest join-request queue as one hook: wraps the manager's
 * sfu:guest-join-request stream and owns the pending-queue state.
 * Approval and denial stay with the consumer (owner cookie session is app
 * domain); the hook only reflects removals.
 */

import type { SfuGuestJoinRequestPayload } from "@zvonok/client/sfu/types";
import { useCallback, useEffect, useState } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";

export type GuestJoinRequest = SfuGuestJoinRequestPayload;

export interface UseGuestJoinRequestsResult {
  /** Pending requests in arrival order; the newest last. */
  pendingRequests: GuestJoinRequest[];
  /** Drops a request from the queue after the consumer acted on it. */
  removeRequest(requestId: string): void;
}

export function useGuestJoinRequests(): UseGuestJoinRequestsResult {
  const session = useZvonokSession();
  const manager = session.manager;
  const [pendingRequests, setPendingRequests] = useState<GuestJoinRequest[]>([]);

  useEffect(() => {
    if (!manager) {
      setPendingRequests([]);
      return;
    }
    // A fresh session starts with an empty queue; requests arriving while
    // subscribed are appended once (the id guards reconnect replays).
    setPendingRequests([]);
    const seen = new Set<string>();
    const offRequest = manager.onGuestJoinRequest((payload) => {
      if (seen.has(payload.requestId)) {
        return;
      }
      seen.add(payload.requestId);
      setPendingRequests((prev) => [...prev, payload]);
    });
    return () => {
      offRequest();
    };
  }, [manager]);

  const removeRequest = useCallback((requestId: string) => {
    setPendingRequests((prev) => prev.filter((request) => request.requestId !== requestId));
  }, []);

  return { pendingRequests, removeRequest };
}
