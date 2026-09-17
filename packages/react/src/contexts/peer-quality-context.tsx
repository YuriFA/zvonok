/**
 * React wiring for the quality adaptation engine: one engine per room,
 * bound to the session's SFU manager while connected. Tiles report
 * viewport visibility through {@link useViewportQuality}; badges read
 * per-peer stats through {@link usePeerQualityStats}.
 */

import type { PeerQualityStats } from "@zvonok/client/sfu/types";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { PeerQualityEngine, STATS_INTERVAL_MS } from "../core/peer-quality-engine.js";
import { useZvonokSession } from "./zvonok-context.js";

export interface PeerQualityProviderProps {
  /**
   * Gates adaptation on the connection lifecycle: while false the engine
   * is detached and holds no state.
   */
  enabled?: boolean;
  /**
   * Slower stats polling on phones. Defaults to a matchMedia check;
   * pass explicitly when the consumer already knows (e.g. its own
   * breakpoint hook).
   */
  isMobile?: boolean;
  children: ReactNode;
}

const PeerQualityContext = createContext<PeerQualityEngine | null>(null);

/** Matches the app's mobile breakpoint (max-width: 767px). */
function useDefaultIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handleChange = () => setIsMobile(mql.matches);
    handleChange();
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);
  return isMobile;
}

export function PeerQualityProvider({
  enabled = true,
  isMobile,
  children,
}: PeerQualityProviderProps) {
  const engineRef = useRef<PeerQualityEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new PeerQualityEngine();
  }
  const engine = engineRef.current;
  const manager = useZvonokSession().manager;
  const defaultIsMobile = useDefaultIsMobile();
  const effectiveIsMobile = isMobile ?? defaultIsMobile;

  useEffect(() => {
    if (!enabled || !manager) {
      engine.unbind();
      return;
    }
    engine.bind(manager, {
      statsIntervalMs: STATS_INTERVAL_MS[effectiveIsMobile ? "mobile" : "desktop"],
    });
    return () => {
      engine.unbind();
    };
  }, [engine, enabled, manager, effectiveIsMobile]);

  return <PeerQualityContext.Provider value={engine}>{children}</PeerQualityContext.Provider>;
}

/**
 * The room's quality engine. Throws outside of a PeerQualityProvider -
 * same contract as the other provider-scoped hooks.
 */
export function usePeerQualityContext(): PeerQualityEngine {
  const engine = useContext(PeerQualityContext);
  if (!engine) {
    throw new Error("usePeerQualityContext must be used within a PeerQualityProvider");
  }
  return engine;
}

/** Per-peer quality stats for badges; undefined until the first report. */
export function usePeerQualityStats(userId: string): PeerQualityStats | undefined {
  const engine = usePeerQualityContext();
  return useSyncExternalStore(
    (onStoreChange) => engine.subscribePeer(userId, onStoreChange),
    () => engine.getPeerStats(userId),
  );
}
