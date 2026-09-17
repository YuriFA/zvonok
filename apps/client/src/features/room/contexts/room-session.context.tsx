/**
 * The app's single wiring point of the SDK call session: identity from auth,
 * notifications from toasts. State and actions live on the call session
 * itself; consumers read `call` and render their own presentation.
 */

import type { UseZvonokCallResult } from "@zvonok/react";
import { useZvonokCall } from "@zvonok/react";
import type { UseZvonokConnectionResult } from "@zvonok/react";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { toast } from "sonner";

import { useRoomIdentity } from "./room-identity.context";

export type RoomSession = UseZvonokCallResult;

const RoomSessionContext = createContext<RoomSession | null>(null);

interface RoomSessionProviderProps {
  connection: UseZvonokConnectionResult;
  children: ReactNode;
}

export function RoomSessionProvider({ connection, children }: RoomSessionProviderProps) {
  const { userId, displayName } = useRoomIdentity();
  const call = useZvonokCall({
    connection,
    localUserId: userId,
    localDisplayName: displayName,
    pauseVideoWhenHidden: true,
    onHostMuted: () => toast.info("Muted by the room host"),
  });

  return <RoomSessionContext value={call}>{children}</RoomSessionContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomSession(): RoomSession {
  const ctx = useContext(RoomSessionContext);
  if (!ctx) {
    throw new Error("useRoomSession must be used within a RoomSessionProvider");
  }
  return ctx;
}

/**
 * Mic/camera toggles with the app's failure copy: a replace failure rolls
 * the control back and surfaces a toast.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRoomToggles() {
  const { camera, microphone } = useRoomSession();

  const toggleVideo = useCallback(async () => {
    const outcome = await camera.toggle();
    if (outcome === "replace-failed") {
      toast.error("Failed to restart the camera");
    }
  }, [camera]);

  const toggleAudio = useCallback(async () => {
    const outcome = await microphone.toggle();
    if (outcome === "replace-failed") {
      toast.error("Failed to restart the microphone");
    }
  }, [microphone]);

  return { toggleVideo, toggleAudio };
}
