/**
 * Host control actions: mute one/all, room lock, kick.
 * Thin React binding over the framework-free createHostControls factory.
 * Every action settles on the server's acknowledgement; denials reject
 * with ZvonokHostError.
 */

import { useMemo } from "react";

import { createHostControls } from "./host-controls.js";
import { useZvonokSession } from "../contexts/zvonok-context.js";

export interface UseHostControlsResult {
  mutePeer(userId: string): Promise<void>;
  muteAll(): Promise<void>;
  lockRoom(locked: boolean): Promise<void>;
  kickPeer(userId: string): Promise<void>;
}

export function useHostControls(): UseHostControlsResult {
  const session = useZvonokSession();
  const controls = useMemo(() => createHostControls(session.manager), [session.manager]);
  return controls;
}
