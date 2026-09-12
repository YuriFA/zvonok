import { useRemoteAudio, type UseRemoteAudioResult } from "@zvonok/react";
import { createContext, useContext, type ReactNode } from "react";

import type { UseRoomSessionResult } from "../hooks/use-room-session";

/**
 * Slim view over the SDK's remote-audio hook: remote playout, per-user
 * levels, and the active speaker, all fed from one playout graph.
 */
const RoomAudioContext = createContext<UseRemoteAudioResult | null>(null);

interface Props {
  session: UseRoomSessionResult;
  children: ReactNode;
}

export function RoomAudioContextProvider({ children, session }: Props) {
  const value = useRemoteAudio({
    localAudio: { userId: session.localUserId, stream: session.localAudioStream },
  });

  return <RoomAudioContext.Provider value={value}>{children}</RoomAudioContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomAudioContext(): UseRemoteAudioResult {
  const ctx = useContext(RoomAudioContext);
  if (!ctx) {
    throw new Error("useRoomAudioContext must be used within a RoomAudioContextProvider");
  }

  return ctx;
}

/** Smoothed 0..1 speaking level for one participant; 0 in silence. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAudioLevel(userId: string): number {
  return useRoomAudioContext().levels[userId] ?? 0;
}

/** Currently speaking participant's id, or null in silence. */
// eslint-disable-next-line react-refresh/only-export-components
export function useActiveSpeakerId(): string | null {
  return useRoomAudioContext().activeSpeakerId;
}
