/**
 * Framework-free host control actions over a connected SFU manager.
 * Every action settles on the server's acknowledgement: success resolves,
 * denials reject with ZvonokHostError carrying the server's coded error.
 * useHostControls wraps this factory for React consumers.
 */

import type { SfuManager } from "@zvonok/client/sfu/manager";
import { SfuHostActionError } from "@zvonok/client/sfu/types";

import { ZvonokHostError } from "../errors.js";

export interface HostControls {
  mutePeer(userId: string): Promise<void>;
  muteAll(): Promise<void>;
  lockRoom(locked: boolean): Promise<void>;
  kickPeer(userId: string): Promise<void>;
}

/** Re-exposes the core's typed host-action error as the SDK error type. */
function toZvonokHostError(error: unknown): ZvonokHostError {
  if (error instanceof SfuHostActionError) {
    return new ZvonokHostError(error.code, error.message);
  }
  return new ZvonokHostError(
    "HOST_ACTION_FAILED",
    error instanceof Error ? error.message : "Host action failed",
  );
}

/**
 * Builds host control actions bound to a manager. Passing null yields
 * actions that reject with DISCONNECTED, so callers can bind before a
 * session exists.
 */
export function createHostControls(manager: SfuManager | null): HostControls {
  const requireManager = (): SfuManager => {
    if (!manager) {
      throw new ZvonokHostError("DISCONNECTED", "Join the room before using host controls");
    }
    return manager;
  };

  const run = (action: (manager: SfuManager) => Promise<void>): Promise<void> =>
    action(requireManager()).catch((error: unknown) => {
      throw toZvonokHostError(error);
    });

  return {
    mutePeer: (userId) => run((manager) => manager.mutePeer(userId)),
    muteAll: () => run((manager) => manager.muteAll()),
    lockRoom: (locked) => run((manager) => manager.lockRoom(locked)),
    kickPeer: (userId) => run((manager) => manager.kickPeer(userId)),
  };
}
