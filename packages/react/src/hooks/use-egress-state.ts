/**
 * Egress state: the room's egress session mirrored from egress:status
 * broadcasts, with recording/live derivations for UI gating.
 */

import { useEffect, useState } from "react";

import type { SfuEgressStatusPayload } from "@zvonok/client/sfu/types";

import { useZvonokSession } from "../contexts/zvonok-context.js";

export interface UseEgressStateResult {
  /** Latest session state broadcast; null while no session was announced. */
  egress: SfuEgressStatusPayload | null;
  /** A non-terminal session with the recording output is active. */
  isRecording: boolean;
  /** A live session with the HLS output is on air. */
  isLive: boolean;
}

const TERMINAL_STATUSES = new Set(["ended", "failed"]);

export function useEgressState(): UseEgressStateResult {
  const session = useZvonokSession();
  const [egress, setEgress] = useState<SfuEgressStatusPayload | null>(() => {
    if (typeof window === "undefined") return null;
    return session.manager?.getState().egress ?? null;
  });

  useEffect(() => {
    const manager = session.manager;
    if (!manager) {
      setEgress(null);
      return;
    }
    setEgress(manager.getState().egress);
    return manager.onStateChange((state) => setEgress(state.egress));
  }, [session.manager]);

  const isSessionActive =
    egress !== null && !TERMINAL_STATUSES.has(egress.status);
  return {
    egress,
    isRecording: isSessionActive && egress.outputs.record,
    isLive: egress?.status === "live" && egress.outputs.hls,
  };
}
