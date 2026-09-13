/**
 * Pauses the room's heavy media work while the page is hidden (phone app
 * switch, screen off): the local camera producer is paused, every tile is
 * clamped to the lowest simulcast layer through the quality engine's
 * suspend flag, and stats polling stops. Everything restores when the page
 * becomes visible again. Audio is deliberately untouched: the user may
 * still be listening.
 */

import type { UseZvonokConnectionResult } from "@zvonok/react";
import { useEffect, useRef } from "react";

import { useIsMobile } from "@/hooks/use-is-mobile";

import { STATS_INTERVAL_MS, usePeerQualityContext } from "../contexts/peer-quality.context";
import { useRoomSessionState } from "../contexts/room-session.context";

export function useRoomVisibilityPause(connection: UseZvonokConnectionResult): void {
  const { store } = usePeerQualityContext();
  const { mediaControls } = useRoomSessionState();
  const isMobile = useIsMobile();
  const managerRef = useRef(connection.manager);
  managerRef.current = connection.manager;
  const isVideoEnabledRef = useRef(mediaControls.isVideoEnabled);
  isVideoEnabledRef.current = mediaControls.isVideoEnabled;

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const { pauseProducer, resumeProducer } = connection;

    const handleVisibilityChange = () => {
      const manager = managerRef.current;
      const hidden = document.visibilityState === "hidden";
      store.setSuspended(hidden);
      if (manager === null) {
        return;
      }
      if (hidden) {
        pauseProducer("video");
        manager.stopStatsCollection();
      } else {
        // Only resume what the user's own control state wants: a camera
        // toggled off before hiding stays off.
        if (isVideoEnabledRef.current) {
          resumeProducer("video");
        }
        manager.startStatsCollection(STATS_INTERVAL_MS[isMobile ? "mobile" : "desktop"]);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [connection, isMobile, store]);
}
