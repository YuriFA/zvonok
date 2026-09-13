/**
 * Room session state and actions in two sibling contexts: action-only
 * consumers (buttons, shortcuts) re-render only when an action identity
 * changes, and state consumers never re-render because a callback was
 * rebuilt. The provider owns the useRoomSession call, so the view tree
 * consumes hooks instead of receiving the session object as props.
 */

import type { HostControls, UseZvonokConnectionResult } from "@zvonok/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Participant } from "@/components/room/participants-list";
import type { UseMediaControlsReturn } from "@/features/media/hooks/use-media-controls";

import { useRoomSession } from "../hooks/use-room-session";
import type { RemotePeerMedia } from "../hooks/use-room-sfu";
import { useRoomIdentity } from "./room-identity.context";

export interface RoomSessionState {
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  mediaControls: UseMediaControlsReturn;
  connectionState: string;
  capabilities: string[];
  remotePeers: RemotePeerMedia[];
  wasKicked: boolean;
  participants: Participant[];
  localUserId: string;
  isRoomLocked: boolean;
  mutedByHost: boolean;
}

export interface RoomSessionActions {
  toggleVideo: () => Promise<void>;
  toggleAudio: () => Promise<void>;
  kickPeer: (userId: string) => Promise<void>;
  hostControls: HostControls;
}

const RoomSessionStateContext = createContext<RoomSessionState | null>(null);
const RoomSessionActionsContext = createContext<RoomSessionActions | null>(null);

interface RoomSessionProviderProps {
  connection: UseZvonokConnectionResult;
  children: ReactNode;
}

export function RoomSessionProvider({ connection, children }: RoomSessionProviderProps) {
  const { userId, displayName } = useRoomIdentity();
  const session = useRoomSession({ userId, displayName, connection });

  const {
    localVideoStream,
    localAudioStream,
    mediaControls,
    connectionState,
    capabilities,
    remotePeers,
    wasKicked,
    participants,
    localUserId,
    isRoomLocked,
    mutedByHost,
    toggleVideo,
    toggleAudio,
    kickPeer,
    hostControls,
  } = session;

  const state = useMemo<RoomSessionState>(
    () => ({
      localVideoStream,
      localAudioStream,
      mediaControls,
      connectionState,
      capabilities,
      remotePeers,
      wasKicked,
      participants,
      localUserId,
      isRoomLocked,
      mutedByHost,
    }),
    [
      localVideoStream,
      localAudioStream,
      mediaControls,
      connectionState,
      capabilities,
      remotePeers,
      wasKicked,
      participants,
      localUserId,
      isRoomLocked,
      mutedByHost,
    ],
  );

  const actions = useMemo<RoomSessionActions>(
    () => ({ toggleVideo, toggleAudio, kickPeer, hostControls }),
    [toggleVideo, toggleAudio, kickPeer, hostControls],
  );

  return (
    <RoomSessionStateContext value={state}>
      <RoomSessionActionsContext value={actions}>{children}</RoomSessionActionsContext>
    </RoomSessionStateContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomSessionState(): RoomSessionState {
  const ctx = useContext(RoomSessionStateContext);
  if (!ctx) {
    throw new Error("useRoomSessionState must be used within a RoomSessionProvider");
  }
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomSessionActions(): RoomSessionActions {
  const ctx = useContext(RoomSessionActionsContext);
  if (!ctx) {
    throw new Error("useRoomSessionActions must be used within a RoomSessionProvider");
  }
  return ctx;
}
