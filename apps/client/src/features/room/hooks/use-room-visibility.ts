/**
 * Pauses the local camera producer while the page is hidden (phone app
 * switch, screen off). The quality engine handles the rest of the hidden
 * clamp: layer suspension and stats polling. Audio is deliberately
 * untouched: the user may still be listening.
 */

import type { UseZvonokConnectionResult } from "@zvonok/react";
import { useEffect, useRef } from "react";

import { useRoomSessionState } from "../contexts/room-session.context";

export function useRoomVisibilityPause(connection: UseZvonokConnectionResult): void {
  const { camera } = useRoomSessionState();
  const managerRef = useRef(connection.manager);
  managerRef.current = connection.manager;
  const isVideoEnabledRef = useRef(camera.isEnabled);
  isVideoEnabledRef.current = camera.isEnabled;

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const { pauseProducer, resumeProducer } = connection;

    const handleVisibilityChange = () => {
      const manager = managerRef.current;
      if (manager === null) {
        return;
      }
      if (document.visibilityState === "hidden") {
        pauseProducer("video");
      } else {
        // Only resume what the user's own control state wants: a camera
        // toggled off before hiding stays off.
        if (isVideoEnabledRef.current) {
          resumeProducer("video");
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [connection]);
}
