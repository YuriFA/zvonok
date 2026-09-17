/**
 * Simulcast quality adaptation for participant tiles: collects per-peer
 * quality stats from the SFU manager, tracks which tiles are in the
 * viewport, and drives each peer's camera consumer to the preferred
 * spatial layer.
 *
 * Layer selection: a visible, non-suspended tile gets the layer matching
 * its measured quality score; a tile outside the viewport, or the whole
 * page while the tab is hidden, clamps to the lowest layer. Every switch
 * is debounced and coalesced - an unchanged layer is never re-requested,
 * and a peer whose camera consumer does not exist yet (not subscribed, or
 * the local participant) never produces a request.
 *
 * Pure state machine: bind()/unbind() attach it to an SfuManager, so it
 * is unit-testable without React.
 */

import { qualityToSpatialLayer } from "@zvonok/client/sfu/quality-score";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import type { PeerQualityStats, SimulcastSpatialLayer } from "@zvonok/client/sfu/types";

/** Stats polling cadence: phones poll slower to save radio wakeups. */
export const STATS_INTERVAL_MS = { mobile: 5000, desktop: 2000 } as const;

/** Debounce delay (ms) before emitting a simulcast layer switch. */
export const LAYER_SWITCH_DEBOUNCE_MS = 3000;

export interface PeerQualityBindOptions {
  /** Layer-switch debounce in ms. Default {@link LAYER_SWITCH_DEBOUNCE_MS}. */
  debounceMs?: number;
  /** Stats polling cadence in ms. Default {@link STATS_INTERVAL_MS}.desktop. */
  statsIntervalMs?: number;
}

interface BoundState {
  manager: SfuManager;
  debounceMs: number;
  statsIntervalMs: number;
  unsubs: Array<() => void>;
}

export class PeerQualityEngine {
  private stats = new Map<string, PeerQualityStats>();
  /** Users whose tile is outside the viewport; absence means visible. */
  private hiddenUsers = new Set<string>();
  private listeners = new Map<string, Set<() => void>>();
  private visibilityListeners = new Set<(userId: string) => void>();
  /** Page-level suspend (tab hidden): clamps every tile to the lowest layer. */
  private suspended = false;
  private suspendListeners = new Set<() => void>();

  /** Per-peer debounce timers and last-emitted layer for adaptation. */
  private layerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastEmittedLayer = new Map<string, SimulcastSpatialLayer>();
  /** Every peer that ever reported stats; suspend reschedules all of them. */
  private knownPeers = new Set<string>();
  private bound: BoundState | null = null;

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

  isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Flips the page-level suspend clamp. Notifies suspend subscribers (the
   * engine reschedules every known peer); no-op when unchanged.
   */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) {
      return;
    }
    this.suspended = suspended;
    for (const listener of this.suspendListeners) {
      listener();
    }
  }

  subscribeSuspended(listener: () => void): () => void {
    this.suspendListeners.add(listener);
    return () => {
      this.suspendListeners.delete(listener);
    };
  }

  setStats(stats: Map<string, PeerQualityStats>): void {
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

  reset(): void {
    this.stats = new Map();
    this.hiddenUsers.clear();
    this.suspended = false;
    this.knownPeers.clear();
    for (const listeners of this.listeners.values()) {
      for (const fn of listeners) {
        fn();
      }
    }
  }

  subscribePeer(userId: string, listener: () => void): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /**
   * Attaches to an SFU manager: subscribes to quality stats and
   * participant leaves, starts stats collection, and owns the hidden-tab
   * suspend (clamped layers plus paused stats polling while the page is
   * hidden). Re-binding detaches the previous manager first.
   */
  bind(manager: SfuManager, options: PeerQualityBindOptions = {}): void {
    if (this.bound) {
      this.unbind();
    }

    const bound: BoundState = {
      manager,
      debounceMs: options.debounceMs ?? LAYER_SWITCH_DEBOUNCE_MS,
      statsIntervalMs: options.statsIntervalMs ?? STATS_INTERVAL_MS.desktop,
      unsubs: [],
    };

    bound.unsubs.push(
      manager.onQualityStats((stats) => {
        this.setStats(stats);
        this.clearMissingUserState(stats);
        for (const userId of stats.keys()) {
          this.knownPeers.add(userId);
          this.scheduleLayerSwitch(userId);
        }
      }),
    );
    bound.unsubs.push(this.subscribeVisibility((userId) => this.scheduleLayerSwitch(userId)));
    bound.unsubs.push(
      this.subscribeSuspended(() => {
        for (const userId of this.knownPeers) {
          this.scheduleLayerSwitch(userId);
        }
      }),
    );
    bound.unsubs.push(
      manager.onParticipantLeft((userId) => {
        this.clearUserLayerState(userId);
      }),
    );

    // Hidden-tab suspend: clamp every tile and pause stats polling; both
    // restore when the page becomes visible again.
    const handleVisibilityChange = () => {
      const hidden = document.visibilityState === "hidden";
      this.setSuspended(hidden);
      if (hidden) {
        manager.stopStatsCollection();
      } else {
        manager.startStatsCollection(bound.statsIntervalMs);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      bound.unsubs.push(() =>
        document.removeEventListener("visibilitychange", handleVisibilityChange),
      );
    }

    manager.startStatsCollection(bound.statsIntervalMs);
    this.bound = bound;
  }

  /** Detaches from the manager, stops polling, and resets all state. */
  unbind(): void {
    const bound = this.bound;
    if (!bound) {
      return;
    }
    this.bound = null;
    for (const unsub of bound.unsubs) {
      unsub();
    }
    bound.manager.stopStatsCollection();
    this.clearAllLayerState();
    this.reset();
  }

  /**
   * One scheduler owns this user's preferred layer: quality adapts the
   * target for visible tiles, viewport visibility and the page suspend
   * clamp hidden tiles to the lowest layer. Triggered by stats updates,
   * visibility flips, and suspend flips.
   */
  private scheduleLayerSwitch(userId: string): void {
    const bound = this.bound;
    if (!bound) {
      return;
    }
    const peerStats = this.getPeerStats(userId);
    if (!peerStats) {
      return;
    }

    const effectiveLayer =
      this.isViewportVisible(userId) && !this.isSuspended()
        ? qualityToSpatialLayer(peerStats.score.level)
        : 0;

    // Only schedule if the effective layer differs from the last emitted one
    if (this.lastEmittedLayer.get(userId) === effectiveLayer) {
      return;
    }

    // Cancel any pending timer for this peer
    const existing = this.layerTimers.get(userId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    // Debounce: emit after the debounce window of stability
    const timer = setTimeout(
      () => {
        this.layerTimers.delete(userId);
        // Re-check: inputs may have changed while the timer was running
        const currentPeerStats = this.getPeerStats(userId);
        const currentLayer = currentPeerStats
          ? qualityToSpatialLayer(currentPeerStats.score.level)
          : qualityToSpatialLayer(peerStats.score.level);
        const effectiveNow = this.isViewportVisible(userId) && !this.isSuspended()
          ? currentLayer
          : 0;
        const consumerId = bound.manager.getVideoConsumerIdForUserId(userId);

        if (!consumerId) {
          // Nothing to address yet: drop the memory so a later trigger
          // re-attempts once the consumer appears.
          this.lastEmittedLayer.delete(userId);
          return;
        }

        if (this.lastEmittedLayer.get(userId) !== effectiveNow) {
          bound.manager.setPreferredLayers(consumerId, effectiveNow);
          this.lastEmittedLayer.set(userId, effectiveNow);
        }
      },
      bound.debounceMs,
    );

    this.layerTimers.set(userId, timer);
  }

  private clearUserLayerState(userId: string): void {
    const timer = this.layerTimers.get(userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.layerTimers.delete(userId);
    }
    this.lastEmittedLayer.delete(userId);
  }

  private clearMissingUserState(stats: Map<string, unknown>): void {
    for (const userId of Array.from(this.layerTimers.keys())) {
      if (!stats.has(userId)) {
        this.clearUserLayerState(userId);
      }
    }
    for (const userId of Array.from(this.lastEmittedLayer.keys())) {
      if (!stats.has(userId)) {
        this.clearUserLayerState(userId);
      }
    }
  }

  private clearAllLayerState(): void {
    for (const timer of this.layerTimers.values()) {
      clearTimeout(timer);
    }
    this.layerTimers.clear();
    this.lastEmittedLayer.clear();
  }
}
