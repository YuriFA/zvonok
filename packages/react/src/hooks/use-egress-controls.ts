/**
 * Egress control actions: start a client-initiated session (record and/or
 * HLS; RTMP stays server-side) and stop the room's active session. Every
 * action settles on the server's acknowledgement; denials reject with
 * ZvonokEgressError carrying the server's coded error.
 */

import type { SfuManager } from "@zvonok/client/sfu/manager";
import { SfuEgressActionError, type SfuEgressOutputRequest } from "@zvonok/client/sfu/types";
import { useMemo } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import { ZvonokEgressError } from "../errors.js";

export interface UseEgressControlsResult {
  start(outputs: SfuEgressOutputRequest): Promise<void>;
  stop(): Promise<void>;
}

/** Re-exposes the core's typed egress error as the SDK error type. */
function toZvonokEgressError(error: unknown): ZvonokEgressError {
  if (error instanceof SfuEgressActionError) {
    return new ZvonokEgressError(error.code, error.message);
  }
  return new ZvonokEgressError(
    "EGRESS_ACTION_FAILED",
    error instanceof Error ? error.message : "Egress action failed",
  );
}

export function useEgressControls(): UseEgressControlsResult {
  const session = useZvonokSession();

  return useMemo(() => {
    const requireManager = (): SfuManager => {
      const manager = session.manager;
      if (!manager) {
        throw new ZvonokEgressError("DISCONNECTED", "Join the room before controlling egress");
      }
      return manager;
    };

    const run = (action: (manager: SfuManager) => Promise<void>): Promise<void> =>
      action(requireManager()).catch((error: unknown) => {
        throw toZvonokEgressError(error);
      });

    return {
      start: (outputs) => run((manager) => manager.startEgress(outputs)),
      stop: () => run((manager) => manager.stopEgress()),
    };
  }, [session.manager]);
}
