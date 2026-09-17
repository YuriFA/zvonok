/**
 * Room session state and actions in two sibling contexts: action-only
 * consumers (buttons, shortcuts) re-render only when an action identity
 * changes, and state consumers never re-render because a callback was
 * rebuilt. The provider composes the SDK call-session hook and adapts its
 * output to the room's presentation types; media policy (toggles, host
 * mute, kick, publishing) lives in @zvonok/react.
 */

import type {
  HostControls,
  ToggleControl,
  UseZvonokConnectionResult,
  ZvonokParticipant,
} from "@zvonok/react";
import { useZvonokCall } from "@zvonok/react";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { toast } from "sonner";

import type { Participant } from "@/components/room/participants-list";

import { useRoomIdentity } from "./room-identity.context";

export interface RoomSessionState {
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  camera: ToggleControl;
  microphone: ToggleControl;
  connectionState: string;
  capabilities: string[];
  remotePeers: ZvonokParticipant[];
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

/** The SDK participant projection shaped for the participants panel. */
function toParticipant(participant: ZvonokParticipant, fallbackName: string): Participant {
  return {
    id: participant.userId,
    userId: participant.userId,
    username: participant.displayName || fallbackName,
    isMuted: !participant.isAudioEnabled,
    isVideoOff: !participant.isCameraEnabled,
    isConnected: participant.isConnected,
    isMutedByHost: participant.mutedByHost,
  };
}

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
    onHostMuted: () => toast.info("Muted by the room host"),
  });

  const { camera, microphone } = call;

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

  const state = useMemo<RoomSessionState>(
    () => ({
      localVideoStream: call.localVideoStream,
      localAudioStream: call.localAudioStream,
      camera,
      microphone,
      connectionState: call.connectionState,
      capabilities: call.capabilities,
      remotePeers: call.participants.slice(1),
      wasKicked: call.wasKicked,
      participants: call.participants.map((participant) =>
        toParticipant(participant, participant.userId === call.localUserId ? "You" : ""),
      ),
      localUserId: call.localUserId,
      isRoomLocked: call.isRoomLocked,
      mutedByHost: call.mutedByHost,
    }),
    [call, camera, microphone],
  );

  const actions = useMemo<RoomSessionActions>(
    () => ({
      toggleVideo,
      toggleAudio,
      kickPeer: call.kickPeer,
      hostControls: call.hostControls,
    }),
    [toggleVideo, toggleAudio, call.kickPeer, call.hostControls],
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
