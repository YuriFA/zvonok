/**
 * Embedded room: the prebuilt drop-in meeting room of @zvonok/react,
 * composed from the public prebuilt blocks over one call session. It owns
 * the join lifecycle (prejoin card, connection, publish-on-join via the
 * call-session hook) and renders room media policy - toggles, host-mute
 * enforcement, kick, lock, device switching - through the blocks, so its
 * behavior can never drift from the headless surface.
 */

import type { IMediaManager } from "@zvonok/client/media/interfaces";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { useCallback, useEffect, useState } from "react";

import "../css/component-kit.css";
import "../css/embedded.css";
import { ControlBarPreset } from "../components/control-bar/control-bar.js";
import { DeviceSwitcherPreset } from "../components/device-switcher/device-switcher-preset.js";
import { ParticipantsPanelPreset } from "../components/participants-panel/participants-panel-preset.js";
import { StagePreset } from "../components/stage/stage.js";
import { StatusCardsPreset } from "../components/status-cards/status-cards.js";
import { ZvonokProvider } from "../contexts/zvonok-context.js";
import { useDeviceControls } from "../hooks/use-device-controls.js";
import { useEgressControls } from "../hooks/use-egress-controls.js";
import { useEgressState } from "../hooks/use-egress-state.js";
import { useOwnCapabilities } from "../hooks/use-own-capabilities.js";
import { useRemoteAudio } from "../hooks/use-remote-audio.js";
import { useScreenShare } from "../hooks/use-screen-share.js";
import { useZvonokCall } from "../hooks/use-zvonok-call.js";
import { useZvonokConnection } from "../hooks/use-zvonok-connection.js";
import { hasCapabilities, usePrejoin } from "../index.js";
import { JoinErrorCard } from "./join-error-card.js";
import { PreJoinCard } from "./prejoin-card.js";

export interface ZvonokEmbeddedRoomProps {
  /** Base URL of the Zvonok server, e.g. "https://sfu.example.com". */
  serverUrl: string;
  /** Room slug to join. */
  roomSlug: string;
  /** Room token minted by the server; carries the participant identity. */
  token: string;
  /**
   * Presentational name for the local participant: pre-fills the prejoin
   * input and labels the local tile. Authoritative identity comes from the
   * token. Providing it skips the prejoin card.
   */
  displayName?: string;
  /** Stage arrangement: flow grid (default) or derivation-driven spotlight. */
  layout?: "grid" | "spotlight";
  /**
   * Participants panel with host actions for capability holders
   * (default true).
   */
  hostControls?: boolean;
  /** Device switcher section (default true). */
  deviceSwitcher?: boolean;
  /** Called after the participant leaves via the widget's leave control. */
  onLeft?: () => void;
  /** Called with the typed error when the join fails. */
  onError?: (error: unknown) => void;
  /** Skip the prejoin card and join immediately with mic and camera on. */
  skipPrejoin?: boolean;
  /**
   * Supplies the SfuManager; defaults to the standard client manager.
   * Test injection point, forwarded to the provider.
   */
  createManager?: (options: { serverUrl: string }) => SfuManager;
  /**
   * Supplies the media manager; defaults to the shared client media manager.
   * Test injection point, forwarded to the provider.
   */
  createMediaManager?: () => IMediaManager;
  /** Rendered alongside the stage inside the room surface. */
  children?: React.ReactNode;
  className?: string;
}

function EmbeddedRoomSurface({
  roomSlug,
  token,
  displayName,
  layout = "grid",
  hostControls = true,
  deviceSwitcher = true,
  onLeft,
  onError,
  skipPrejoin,
  children,
  className,
}: Omit<ZvonokEmbeddedRoomProps, "serverUrl">) {
  const connection = useZvonokConnection({ roomSlug, token });
  const [notice, setNotice] = useState<string | null>(null);
  const notify = useCallback((value: { message: string }) => {
    setNotice(value.message);
  }, []);

  // One call session owns publishing, toggles, host-mute enforcement, and
  // kick handling; the blocks below render its state.
  const call = useZvonokCall({
    connection,
    localDisplayName: displayName,
    onHostMuted: () => setNotice("Muted by the room host"),
  });

  const devices = useDeviceControls();
  const ownCapabilities = useOwnCapabilities();
  const { isRecording } = useEgressState();
  const egressControls = useEgressControls();
  const screenShare = useScreenShare();
  useRemoteAudio();
  const inRoom =
    call.wasKicked ||
    connection.status === "joined" ||
    connection.status === "connecting" ||
    connection.status === "reconnecting";
  const skip = skipPrejoin === true || displayName !== undefined;
  const [prejoinMicOn, setPrejoinMicOn] = useState(true);
  const [prejoinCameraOn, setPrejoinCameraOn] = useState(true);

  const joinRoom = useCallback(
    async (options: { video: boolean; audio: boolean }) => {
      try {
        await devices.start({ video: options.video, audio: options.audio });
      } catch {
        // Capture problems never block joining; tiles reflect the states.
      }
      try {
        await connection.join();
      } catch {
        // Typed failure is in session state and rendered by the widget.
        return;
      }
      // Publish-on-join is the call session's job: captured tracks publish
      // automatically once joined.
    },
    [devices, connection],
  );

  const prejoin = usePrejoin({
    initialName: displayName ?? "",
    skip,
    onConfirm: async () => {
      await joinRoom({ video: prejoinCameraOn, audio: prejoinMicOn });
    },
  });

  useEffect(() => {
    if (connection.error) {
      onError?.(connection.error);
    }
  }, [connection.error, onError]);

  // Recording control appears only for participants the server granted
  // start-recording; the capability list is server-delivered, never guessed.
  const canRecord = hasCapabilities(ownCapabilities, "start-recording");
  const toggleRecord = useCallback(() => {
    setNotice(null);
    const action = isRecording ? egressControls.stop() : egressControls.start({ record: true });
    void action.catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Recording failed");
    });
  }, [isRecording, egressControls]);

  const handleLeave = useCallback(() => {
    devices.stop();
    connection.leave();
    onLeft?.();
  }, [devices, connection, onLeft]);

  // From an error card, reset to the prejoin stage without firing onLeft;
  // the participant never reached the room.
  const handleBack = useCallback(() => {
    connection.leave();
    prejoin.reset();
  }, [connection, prejoin]);

  const localName = displayName?.trim() || prejoin.displayName.trim() || "You";

  // While the skipped prejoin has not produced a visible stage yet, render
  // nothing rather than flashing the card the consumer asked to skip.
  if (skip && prejoin.phase === "joining" && connection.status === "disconnected") {
    return null;
  }

  if (connection.status === "error") {
    return (
      <JoinErrorCard error={connection.error ?? new Error("Join failed")} onBack={handleBack} />
    );
  }

  if (inRoom) {
    return (
      <div className={["zk", "zk-room", className].filter(Boolean).join(" ")}>
        <header className="zk-header">
          <span className="zk-room-name">{roomSlug}</span>
          <span className="zk-count">
            {call.participants.length}{" "}
            {call.participants.length === 1 ? "participant" : "participants"}
          </span>
        </header>
        <StatusCardsPreset call={call} connection={connection} />
        <StagePreset
          call={call}
          screenShare={screenShare}
          spotlightLayout={layout === "spotlight"}
          localName={localName}
        />
        {notice && (
          <p className="zk-notice" role="alert">
            {notice}
          </p>
        )}
        {deviceSwitcher && (
          <details className="zk-section">
            <summary className="zk-section-summary">Devices</summary>
            <DeviceSwitcherPreset controls={devices} />
          </details>
        )}
        {hostControls && (
          <details className="zk-section">
            <summary className="zk-section-summary">Participants</summary>
            <ParticipantsPanelPreset call={call} onNotice={notify} />
          </details>
        )}
        <ControlBarPreset
          call={call}
          screenShare={screenShare}
          record={canRecord ? { isRecording, onToggle: toggleRecord } : undefined}
          onLeave={handleLeave}
          onNotice={notify}
        />
        {children}
      </div>
    );
  }

  return (
    <PreJoinCard
      showNameInput={displayName === undefined}
      name={prejoin.displayName}
      micOn={prejoinMicOn}
      cameraOn={prejoinCameraOn}
      onNameChange={prejoin.setDisplayName}
      onToggleMic={() => setPrejoinMicOn((value) => !value)}
      onToggleCamera={() => setPrejoinCameraOn((value) => !value)}
      onJoin={() => void prejoin.confirm()}
    />
  );
}

export function ZvonokEmbeddedRoom({
  createManager,
  createMediaManager,
  ...rest
}: ZvonokEmbeddedRoomProps) {
  return (
    <ZvonokProvider
      serverUrl={rest.serverUrl}
      createManager={createManager}
      createMediaManager={createMediaManager}
    >
      <EmbeddedRoomSurface {...rest} />
    </ZvonokProvider>
  );
}
