import { qualityToSpatialLayer } from "@zvonok/client/sfu/quality-score";
import type { SimulcastSpatialLayer } from "@zvonok/client/sfu/types";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

import { useSfuManager } from "@/features/sfu/contexts/sfu-manager.context";
import { useIsMobile } from "@/hooks/use-is-mobile";

import { PeerQualityStore } from "./peer-quality.store";

export interface PeerQualityContextValue {
  store: PeerQualityStore;
}

const PeerQualityContext = createContext<PeerQualityContextValue | null>(null);

/** Debounce delay (ms) before emitting a simulcast layer switch */
const LAYER_SWITCH_DEBOUNCE_MS = 3000;

interface Props {
  enabled?: boolean;
  children: ReactNode;
}

export function PeerQualityProvider({ enabled = true, children }: Props) {
  const storeRef = useRef<PeerQualityStore>(new PeerQualityStore());
  const sfuManager = useSfuManager();
  const isMobile = useIsMobile();

  /**
   * Per-peer debounce timers and last-emitted layer for simulcast adaptation.
   * Stored in a ref so they survive re-renders without triggering effects.
   */
  const layerTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastEmittedLayer = useRef<Map<string, SimulcastSpatialLayer>>(new Map());

  useEffect(() => {
    if (!enabled) {
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

    const unsubscribe = sfuManager.onQualityStats((stats) => {
      store.setStats(stats);
      clearMissingUserState(stats);

      // Adapt simulcast layer per peer based on their received quality
      for (const [userId, peerStats] of stats) {
        const desiredLayer = qualityToSpatialLayer(peerStats.score.level);

        // Only schedule if the desired layer differs from the last emitted one
        if (lastEmittedLayerCurrent.get(userId) === desiredLayer) continue;

        // Cancel any pending timer for this peer
        const existing = layerTimersCurrent.get(userId);
        if (existing !== undefined) {
          clearTimeout(existing);
        }

        // Debounce: emit after LAYER_SWITCH_DEBOUNCE_MS of stability
        const timer = setTimeout(() => {
          layerTimersCurrent.delete(userId);
          // Re-check: the desired layer may have changed while the timer was running
          const currentPeerStats = store.getPeerStats(userId);
          const currentLayer = currentPeerStats
            ? qualityToSpatialLayer(currentPeerStats.score.level)
            : desiredLayer;
          const currentConsumerId = sfuManager.getVideoConsumerIdForUserId(userId);

          if (!currentConsumerId) {
            lastEmittedLayerCurrent.delete(userId);
            return;
          }

          if (lastEmittedLayerCurrent.get(userId) !== currentLayer) {
            sfuManager.setPreferredLayers(currentConsumerId, currentLayer);
            lastEmittedLayerCurrent.set(userId, currentLayer);
          }
        }, LAYER_SWITCH_DEBOUNCE_MS);

        layerTimersCurrent.set(userId, timer);
      }
    });
    const unsubscribePeerLeft = sfuManager.onParticipantLeft((userId) => {
      clearUserLayerState(userId);
    });

    sfuManager.startStatsCollection(isMobile ? 5000 : 2000);

    return () => {
      unsubscribe();
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
