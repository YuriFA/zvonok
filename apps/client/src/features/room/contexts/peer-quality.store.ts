import type { PeerQualityStats } from "@zvonok/client/sfu/types";
import { useSyncExternalStore } from "react";

type Listener = () => void;
export class PeerQualityStore {
  private stats = new Map<string, PeerQualityStats>();
  /** Users whose tile is outside the viewport; absence means visible. */
  private hiddenUsers = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private visibilityListeners = new Set<(userId: string) => void>();

  setStats(stats: Map<string, PeerQualityStats>) {
    const changedIds: string[] = [];

    for (const [id, s] of stats) {
      const prev = this.stats.get(id);
      if (!prev || prev.score.score !== s.score.score || prev.score.level !== s.score.level) {
        changedIds.push(id);
      }
    }

    for (const id of this.stats.keys()) {
      if (!stats.has(id)) {
        changedIds.push(id);
      }
    }

    this.stats = stats;

    for (const id of changedIds) {
      const listeners = this.listeners.get(id);
      if (listeners) {
        for (const fn of listeners) {
          fn();
        }
      }
    }
  }

  reset() {
    this.stats = new Map();
    this.hiddenUsers.clear();
    for (const listeners of this.listeners.values()) {
      for (const fn of listeners) {
        fn();
      }
    }
  }

  getPeerStats(userId: string): PeerQualityStats | undefined {
    return this.stats.get(userId);
  }

  /** Viewport visibility defaults to true: untracked tiles keep full quality. */
  isViewportVisible(userId: string): boolean {
    return !this.hiddenUsers.has(userId);
  }

  /**
   * Records whether the user's tile is in the viewport. No-op (and no
   * notification) when the value is unchanged; the first "visible" write for
   * an unknown user is also a no-op, since visible is the default.
   */
  setVisibility(userId: string, visible: boolean): void {
    if (this.isViewportVisible(userId) === visible) {
      return;
    }
    if (visible) {
      this.hiddenUsers.delete(userId);
    } else {
      this.hiddenUsers.add(userId);
    }
    for (const listener of this.visibilityListeners) {
      listener(userId);
    }
  }

  /** Subscribes to visibility flips; the engine recomputes layers for the user. */
  subscribeVisibility(listener: (userId: string) => void): () => void {
    this.visibilityListeners.add(listener);
    return () => {
      this.visibilityListeners.delete(listener);
    };
  }

  subscribePeer(userId: string, listener: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(userId);
      }
    };
  }
}

export function usePeerQuality(
  store: PeerQualityStore,
  userId: string,
): PeerQualityStats | undefined {
  return useSyncExternalStore(
    (onStoreChange) => store.subscribePeer(userId, onStoreChange),
    () => store.getPeerStats(userId),
  );
}
