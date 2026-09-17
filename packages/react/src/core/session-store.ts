/**
 * Framework-free session state store: the single owner of the join session
 * fields (manager, status, error, lock, room end, kick). The connection
 * hook drives it through named transitions; hooks and blocks subscribe and
 * read. No hook patches arbitrary fields - the transition set below is the
 * whole mutation surface.
 */

import type { SfuManager } from "@zvonok/client/sfu/manager";

import type { ZvonokStatus } from "../types.js";

export interface SessionState {
  manager: SfuManager | null;
  status: ZvonokStatus;
  error: Error | null;
  /** Latest sfu:room-locked value; false until the server reports a lock. */
  locked: boolean;
  /** True after the server ended the room; terminal for the session. */
  roomEnded: boolean;
  /** True after the server removed this peer from the room; cleared by leaving. */
  kicked: boolean;
}

const INITIAL_STATE: SessionState = {
  manager: null,
  status: "disconnected",
  error: null,
  locked: false,
  roomEnded: false,
  kicked: false,
};

export class SessionStore {
  private readonly listeners = new Set<() => void>();

  private state: SessionState = INITIAL_STATE;
  /** Stable reference between transitions; safe for useSyncExternalStore. */
  getSnapshot = (): SessionState => {
    return this.state;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The connection hook installed or released the underlying manager. */
  setManager(manager: SfuManager | null): void {
    this.patch({ manager });
  }

  /** A join attempt started. */
  connecting(): void {
    this.patch({ status: "connecting", error: null, roomEnded: false });
  }

  /** The server accepted the join (initial or after a reconnect blip). */
  joined(): void {
    this.patch({ status: "joined" });
  }

  /** The manager entered its automatic recovery cycle. */
  reconnecting(): void {
    this.patch({ status: "reconnecting" });
  }

  /** An operation failed; the typed error is part of the session. */
  failed(error: Error): void {
    this.patch({ status: "error", error });
  }

  /** The peer left (or was torn down): connection released, locks cleared. */
  disconnected(): void {
    this.patch({
      status: "disconnected",
      error: null,
      locked: false,
      manager: null,
      kicked: false,
    });
  }

  /** The server reported the room lock state. */
  setLocked(locked: boolean): void {
    this.patch({ locked });
  }

  /** The server ended the room; terminal until the next join. */
  roomEnded(): void {
    this.patch({ roomEnded: true });
  }

  /** The server removed this peer from the room; the manager stays alive. */
  kicked(): void {
    this.patch({ status: "disconnected", locked: false, kicked: true });
  }

  private patch(patch: Partial<SessionState>): void {
    const next = { ...this.state, ...patch };
    if (next === this.state) {
      return;
    }
    let changed = false;
    for (const key of Object.keys(patch) as (keyof SessionState)[]) {
      if (this.state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
