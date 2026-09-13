import type { SfuManager } from "@zvonok/client/sfu/manager";
import { qualityToSpatialLayer } from "@zvonok/client/sfu/quality-score";
import type { SimulcastSpatialLayer } from "@zvonok/client/sfu/types";
import { useZvonokSession } from "@zvonok/react";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

import { useIsMobile } from "@/hooks/use-is-mobile";

import { PeerQualityStore } from "./peer-quality.store";

export interface PeerQualityContextValue {
  store: PeerQualityStore;
}

const PeerQualityContext = createContext<PeerQualityContextValue | null>(null);

/** Debounce delay (ms) before emitting a simulcast layer switch */
const LAYER_SWITCH_DEBOUNCE_MS = 3000;

/** Stats polling cadence: phones poll slower to save radio wakeups. */
// eslint-disable-next-line react-refresh/only-export-components
export const STATS_INTERVAL_MS = { mobile: 5000, desktop: 2000 } as const;

/** A tile counts as visible once this fraction of it enters the viewport. */
const VIEWPORT_THRESHOLD = 0.25;

interface Props {
  enabled?: boolean;
  children: ReactNode;
}

export function PeerQualityProvider({ enabled = true, children }: Props) {
  const storeRef = useRef<PeerQualityStore>(new PeerQualityStore());
  const sfuManager = useZvonokSession().manager as SfuManager | null;
  const isMobile = useIsMobile();

  /**
   * Per-peer debounce timers and last-emitted layer for simulcast adaptation.
   * Stored in a ref so they survive re-renders without triggering effects.
   */
  const layerTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastEmittedLayer = useRef<Map<string, SimulcastSpatialLayer>>(new Map());

  useEffect(() => {
    if (!enabled || !sfuManager) {
      storeRef.current.reset();
      return;
    }

    const store = storeRef.current;
    const layerTimersCurrent = layerTimers.current;
    const lastEmittedLayerCurrent = lastEmittedLayer.current;
    const clearUserLayerState = (userId: string) => {
      const timer = layerTimersCurrent.get(userId);
      if (timer !== undefined) {
        clearTimeout(timer);
        layerTimersCurrent.delete(userId);
      }

      lastEmittedLayerCurrent.delete(userId);
    };
    const clearMissingUserState = (stats: Map<string, unknown>) => {
      for (const userId of Array.from(layerTimersCurrent.keys())) {
        if (!stats.has(userId)) {
          clearUserLayerState(userId);
        }
      }

      for (const userId of Array.from(lastEmittedLayerCurrent.keys())) {
        if (!stats.has(userId)) {
          clearUserLayerState(userId);
        }
      }
    };

    // One scheduler owns this user's preferred layer: quality adapts the
    // target for visible tiles, viewport visibility clamps hidden tiles to
    // the lowest layer. Triggered by stats updates and visibility flips.
    const scheduleLayerSwitch = (userId: string) => {
      const peerStats = store.getPeerStats(userId);
      if (!peerStats) {
        return;
      }

      const effectiveLayer =
        store.isViewportVisible(userId) && !store.isSuspended()
          ? qualityToSpatialLayer(peerStats.score.level)
          : 0;

      // Only schedule if the effective layer differs from the last emitted one
      if (lastEmittedLayerCurrent.get(userId) === effectiveLayer) {
        return;
      }

      // Cancel any pending timer for this peer
      const existing = layerTimersCurrent.get(userId);
      if (existing !== undefined) {
        clearTimeout(existing);
      }

      // Debounce: emit after LAYER_SWITCH_DEBOUNCE_MS of stability
      const timer = setTimeout(() => {
        layerTimersCurrent.delete(userId);
        // Re-check: inputs may have changed while the timer was running
        const currentPeerStats = store.getPeerStats(userId);
        const currentLayer = currentPeerStats
          ? qualityToSpatialLayer(currentPeerStats.score.level)
          : qualityToSpatialLayer(peerStats.score.level);
        const effectiveNow =
          store.isViewportVisible(userId) && !store.isSuspended() ? currentLayer : 0;
        const currentConsumerId = sfuManager.getVideoConsumerIdForUserId(userId);

        if (!currentConsumerId) {
          lastEmittedLayerCurrent.delete(userId);
          return;
        }

        if (lastEmittedLayerCurrent.get(userId) !== effectiveNow) {
          sfuManager.setPreferredLayers(currentConsumerId, effectiveNow);
          lastEmittedLayerCurrent.set(userId, effectiveNow);
        }
      }, LAYER_SWITCH_DEBOUNCE_MS);

      layerTimersCurrent.set(userId, timer);
    };

    const knownPeers = new Set<string>();
    const unsubscribe = sfuManager.onQualityStats((stats) => {
      store.setStats(stats);
      clearMissingUserState(stats);

      for (const userId of stats.keys()) {
        knownPeers.add(userId);
        scheduleLayerSwitch(userId);
      }
    });
    const unsubscribeVisibility = store.subscribeVisibility(scheduleLayerSwitch);
    const unsubscribeSuspend = store.subscribeSuspended(() => {
      for (const userId of knownPeers) {
        scheduleLayerSwitch(userId);
      }
    });
    const unsubscribePeerLeft = sfuManager.onParticipantLeft((userId) => {
      clearUserLayerState(userId);
    });

    sfuManager.startStatsCollection(STATS_INTERVAL_MS[isMobile ? "mobile" : "desktop"]);

    return () => {
      unsubscribe();
      unsubscribeVisibility();
      unsubscribeSuspend();
      unsubscribePeerLeft();
      sfuManager.stopStatsCollection();
      store.reset();

      // Clear all pending debounce timers
      for (const timer of layerTimersCurrent.values()) {
        clearTimeout(timer);
      }
      layerTimersCurrent.clear();
      lastEmittedLayerCurrent.clear();
    };
  }, [enabled, sfuManager, isMobile]);

  return (
    <PeerQualityContext.Provider value={{ store: storeRef.current }}>
      {children}
    </PeerQualityContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePeerQualityContext(): PeerQualityContextValue {
  const ctx = useContext(PeerQualityContext);
  if (!ctx) {
    throw new Error("usePeerQualityContext must be used within a PeerQualityProvider");
  }
  return ctx;
}

/**
 * Observes a participant tile and feeds its viewport visibility into the
 * quality engine: hidden tiles clamp to the lowest simulcast layer, visible
 * tiles follow quality-based adaptation. Unmounting the tile restores the
 * visible default, so untracked tiles keep full quality.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePeerViewport(ref: React.RefObject<HTMLElement | null>, userId: string): void {
  const { store } = usePeerQualityContext();

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting);
        store.setVisibility(userId, isVisible);
      },
      { threshold: [VIEWPORT_THRESHOLD] },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      store.setVisibility(userId, true);
    };
  }, [ref, store, userId]);
}
