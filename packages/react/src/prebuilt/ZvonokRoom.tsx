/**
 * ZvonokRoom: the prebuilt drop-in meeting room of @zvonok/react.
 *
 * The component is self-contained: it renders its own ZvonokProvider from
 * the `serverUrl` prop and does not attach to an enclosing provider, so a
 * consumer needs exactly one element to get a working room. Identity stays
 * with the token: the optional `displayName` is presentational - it
 * pre-fills the pre-join name input and labels the local tile, while the
 * server derives every peer's authoritative identity from the verified
 * token claims.
 *
 * Styling ships with the package: this module imports `zvonok.css` (all
 * classes prefixed `zvk-`), which is also exported as
 * `@zvonok/react/zvonok.css` for consumers who wire stylesheets manually.
 *
 * Non-goals (widget v2 candidates): chat, host-control UI, recording,
 * keyboard shortcuts, theming API.
 */

import { isActive } from "@zvonok/client/media/capture-state";
import {
  ScreenShareService,
  browserDisplayMediaService,
} from "@zvonok/client/screen-share/service";
import type { ScreenShareState } from "@zvonok/client/screen-share/types";
import { useCallback, useEffect, useRef, useState } from "react";

import "./zvonok.css";

import { ZvonokProvider, useZvonokSession } from "../zvonok-context.js";
import { useParticipants } from "../use-participants.js";
import { useZvonokConnection, type UseZvonokConnectionResult } from "../use-zvonok-connection.js";
import { useDeviceControls, type ZvonokCaptureControl } from "../use-device-controls.js";
import type { ZvonokParticipant } from "../types.js";
import { useEgressControls } from "../use-egress-controls.js";
import { useEgressState } from "../use-egress-state.js";
import { useOwnCapabilities } from "../use-own-capabilities.js";
import { ZvonokError } from "../errors.js";

export interface ZvonokRoomProps {
  /** Base URL of the Zvonok server, e.g. "https://sfu.example.com". */
  serverUrl: string;
  /** Room slug to join. */
  roomSlug: string;
  /** Room token minted by the server; carries the participant identity. */
  token: string;
  /**
   * Presentational name for the local participant: pre-fills the pre-join
   * input and labels the local tile. Authoritative identity comes from the
   * token. Providing it skips the pre-join card.
   */
  displayName?: string;
  /** Called after the participant leaves via the widget's leave control. */
  onLeft?: () => void;
  /** Called with the typed error when the join fails. */
  onError?: (error: unknown) => void;
  /** Skip the pre-join card and join immediately with mic and camera on. */
  skipPrejoin?: boolean;
}

interface RoomTileProps {
  name: string;
  stream: MediaStream | null;
  audioStream: MediaStream | null;
  isVideoOn: boolean;
  isAudioOn: boolean;
  isLocal: boolean;
  isScreen: boolean;
}

/**
 * One grid tile: video attachment effect, avatar fallback while the camera
 * is off, name badge, and muted badge. Remote tiles play their audio
 * stream through a hidden audio element; the local tile stays muted to
 * avoid echo.
 */
function RoomTile({
  name,
  stream,
  audioStream,
  isVideoOn,
  isAudioOn,
  isLocal,
  isScreen,
}: RoomTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element && stream) {
      element.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (element && audioStream && !isLocal) {
      element.srcObject = audioStream;
    }
  }, [audioStream, isLocal]);

  return (
    <figure className={isScreen ? "zvk-tile zvk-tile-screen" : "zvk-tile"}>
      {isVideoOn && stream ? (
        <video ref={videoRef} className="zvk-video" autoPlay playsInline muted={isLocal} />
      ) : (
        <div className="zvk-tile-avatar" aria-hidden="true">
          {name.charAt(0).toUpperCase() || "?"}
        </div>
      )}
      {audioStream && !isLocal && <audio ref={audioRef} className="zvk-audio" autoPlay />}
      {!isAudioOn && <span className="zvk-badge zvk-badge-muted">muted</span>}
      <figcaption className="zvk-badge">
        {name}
        {isLocal ? " (you)" : ""}
      </figcaption>
    </figure>
  );
}

interface PreJoinCardProps {
  showNameInput: boolean;
  name: string;
  micOn: boolean;
  cameraOn: boolean;
  onNameChange: (name: string) => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onJoin: () => void;
}

function PreJoinCard({
  showNameInput,
  name,
  micOn,
  cameraOn,
  onNameChange,
  onToggleMic,
  onToggleCamera,
  onJoin,
}: PreJoinCardProps) {
  return (
    <div className="zvk-room zvk-prejoin">
      <form
        className="zvk-card"
        onSubmit={(event) => {
          event.preventDefault();
          onJoin();
        }}
      >
        <h1 className="zvk-title">Join room</h1>
        {showNameInput && (
          <label className="zvk-field">
            <span>Display name</span>
            <input
              className="zvk-input"
              name="displayName"
              placeholder="Your name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
        )}
        <div className="zvk-toggle-row">
          <button
            type="button"
            className={micOn ? "zvk-button" : "zvk-button zvk-button-off"}
            aria-pressed={micOn}
            onClick={onToggleMic}
          >
            Mic
          </button>
          <button
            type="button"
            className={cameraOn ? "zvk-button" : "zvk-button zvk-button-off"}
            aria-pressed={cameraOn}
            onClick={onToggleCamera}
          >
            Camera
          </button>
        </div>
        <button type="submit" className="zvk-button zvk-button-join">
          Join
        </button>
      </form>
    </div>
  );
}

interface JoinErrorCardProps {
  error: Error;
  onBack: () => void;
}

/**
 * Typed join failures surface here instead of a blank room. The error is
 * always a ZvonokError subclass by the time status is "error", but the
 * card degrades gracefully for anything else.
 */
function JoinErrorCard({ error, onBack }: JoinErrorCardProps) {
  const code = error instanceof ZvonokError ? error.code : null;
  return (
    <div className="zvk-room zvk-error" role="alert">
      <div className="zvk-error-card">
        <h1 className="zvk-title">Could not join the room</h1>
        {code && <span className="zvk-error-code">{code}</span>}
        <p className="zvk-error-message">{error.message}</p>
        <button type="button" className="zvk-button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Friendly copy for the typed screen share failures of ScreenShareService. */
function screenShareNotice(error: unknown): string {
  if (error === "blocked") {
    return "Another participant is already sharing their screen";
  }
  if (error === "unsupported") {
    return "Screen share is not supported in this browser";
  }
  if (error === "denied") {
    return "Screen share permission was denied";
  }
  return "Screen share was cancelled";
}

function ZvonokRoomSurface({
  roomSlug,
  token,
  displayName,
  onLeft,
  onError,
  skipPrejoin,
}: Omit<ZvonokRoomProps, "serverUrl">) {
  const session = useZvonokSession();
  const connection: UseZvonokConnectionResult = useZvonokConnection({ roomSlug, token });
  const { participants } = useParticipants();
  const devices = useDeviceControls();
  const ownCapabilities = useOwnCapabilities();
  const { isRecording } = useEgressState();
  const egressControls = useEgressControls();

  const prejoinSkipped = skipPrejoin === true || displayName !== undefined;
  const [nameDraft, setNameDraft] = useState(displayName ?? "");
  const [prejoinMicOn, setPrejoinMicOn] = useState(true);
  const [prejoinCameraOn, setPrejoinCameraOn] = useState(true);
  const [screenShare, setScreenShare] = useState<ScreenShareState>({
    isSharing: false,
    screenStream: null,
    isScreenShareBlocked: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [autoJoinPending, setAutoJoinPending] = useState(prejoinSkipped);

  const screenShareServiceRef = useRef<ScreenShareService | null>(null);
  const autoJoinStartedRef = useRef(false);

  const inRoom = connection.status === "joined" || connection.status === "connecting";
  // Screen share orchestration over the joined manager. The service keeps
  // its own state (sharing, stream, blocked by another sharer).
  const manager = connection.manager;
  useEffect(() => {
    if (!manager) {
      return;
    }
    const service = new ScreenShareService({
      sfu: manager,
      displayMedia: browserDisplayMediaService,
    });
    screenShareServiceRef.current = service;
    setScreenShare(service.getState());
    const unsubscribe = service.onStateChange(setScreenShare);
    return () => {
      unsubscribe();
      service.destroy();
      screenShareServiceRef.current = null;
    };
  }, [manager]);

  // D5: the local replace-track sync, ported from the reference app. When
  // capture restarts (device switch) while a producer exists, swap the
  // published track instead of producing a second one.
  const { mediaManager } = session;
  const { hasProducer, replaceTrack } = connection;
  useEffect(() => {
    const unsubscribeVideo = mediaManager.onVideoStateChange((state, track) => {
      if (isActive(state) && track && hasProducer("video")) {
        void replaceTrack("video", track);
      }
    });
    const unsubscribeAudio = mediaManager.onAudioStateChange((state, track) => {
      if (isActive(state) && track && hasProducer("audio")) {
        void replaceTrack("audio", track);
      }
    });
    return () => {
      unsubscribeVideo();
      unsubscribeAudio();
    };
  }, [mediaManager, hasProducer, replaceTrack]);

  const publishInitialTracks = useCallback(async () => {
    const captures = [
      ["video", mediaManager.videoCapture],
      ["audio", mediaManager.audioCapture],
    ] as const;
    for (const [kind, capture] of captures) {
      if (!isActive(capture.getState())) {
        continue;
      }
      const track = capture.getTrack();
      if (track && (await connection.produceTrack(track))) {
        connection.resumeProducer(kind);
      }
    }
  }, [mediaManager, connection]);

  const joinRoom = useCallback(
    async (options: { video: boolean; audio: boolean }) => {
      try {
        await devices.start(options);
      } catch {
        // Capture problems never block joining; tiles reflect the states.
      }
      try {
        await connection.join();
      } catch {
        // Typed failure is in session state and rendered by the widget.
        return;
      }
      await publishInitialTracks();
    },
    [devices, connection, publishInitialTracks],
  );

  useEffect(() => {
    if (!autoJoinPending || autoJoinStartedRef.current) {
      return;
    }
    autoJoinStartedRef.current = true;
    void joinRoom({ video: true, audio: true }).finally(() => setAutoJoinPending(false));
  }, [autoJoinPending, joinRoom]);

  useEffect(() => {
    if (connection.error) {
      onError?.(connection.error);
    }
  }, [connection.error, onError]);

  const toggleCapture = useCallback(
    async (kind: "video" | "audio", enabled: boolean) => {
      const control: ZvonokCaptureControl = kind === "video" ? devices.camera : devices.mic;
      const capture = kind === "video" ? mediaManager.videoCapture : mediaManager.audioCapture;
      if (!(await control.toggle(enabled))) {
        return;
      }
      if (!enabled) {
        if (hasProducer(kind)) {
          connection.pauseProducer(kind);
        }
        return;
      }
      const track = capture.getTrack();
      if (!track) {
        return;
      }
      if (!hasProducer(kind)) {
        if (!(await connection.produceTrack(track))) {
          await control.toggle(false);
          return;
        }
      }
      connection.resumeProducer(kind);
    },
    [devices, mediaManager, hasProducer, connection],
  );

  const toggleScreenShare = useCallback(async () => {
    const service = screenShareServiceRef.current;
    if (!service) {
      return;
    }
    setNotice(null);
    if (service.getState().isSharing) {
      service.stop();
      return;
    }
    try {
      await service.start();
    } catch (error) {
      setNotice(screenShareNotice(error));
    }
  }, []);

  // Recording control appears only for participants the server granted
  // start-recording; the capability list is server-delivered, never guessed.
  const toggleRecord = useCallback(() => {
    setNotice(null);
    const action = isRecording
      ? egressControls.stop()
      : egressControls.start({ record: true });
    void action.catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Recording failed");
    });
  }, [isRecording, egressControls]);

  const handleLeave = useCallback(() => {
    devices.stop();
    connection.leave();
    onLeft?.();
  }, [devices, connection, onLeft]);

  // From an error card, reset to the pre-join stage without firing onLeft;
  // the participant never reached the room.
  const handleBack = useCallback(() => {
    connection.leave();
  }, [connection]);

  // While the skipped pre-join has not produced a visible stage yet, render
  // nothing rather than flashing the card the consumer asked to skip.
  if (autoJoinPending && connection.status === "disconnected") {
    return null;
  }

  if (connection.status === "error") {
    return (
      <JoinErrorCard error={connection.error ?? new Error("Join failed")} onBack={handleBack} />
    );
  }

  if (inRoom) {
    const localName = displayName?.trim() || nameDraft.trim() || "You";
    const micLive = isActive(devices.mic.state) && devices.mic.track !== null;
    const cameraLive = isActive(devices.camera.state) && devices.camera.track !== null;
    const participantCount = participants.length + 1;
    const screenShareSupported =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function";
    return (
      <div className="zvk-room">
        <header className="zvk-header">
          <span className="zvk-room-name">{roomSlug}</span>
          <span className="zvk-count">
            {participantCount} {participantCount === 1 ? "participant" : "participants"}
          </span>
        </header>
        {connection.status === "connecting" && (
          <p className="zvk-status" role="status">
            Connecting...
          </p>
        )}
        <div className="zvk-grid">
          <RoomTile
            name={localName}
            stream={devices.camera.track ? new MediaStream([devices.camera.track]) : null}
            audioStream={null}
            isVideoOn={cameraLive}
            isAudioOn={micLive}
            isLocal
            isScreen={false}
          />
          {participants.map((participant: ZvonokParticipant) => (
            <RoomTile
              key={participant.userId}
              name={participant.displayName}
              stream={participant.cameraStream}
              audioStream={participant.audioStream}
              isVideoOn={participant.isCameraEnabled}
              isAudioOn={participant.isAudioEnabled}
              isLocal={false}
              isScreen={false}
            />
          ))}
          {participants
            .filter((participant) => participant.isScreenSharing && participant.screenStream)
            .map((participant) => (
              <RoomTile
                key={`${participant.userId}-screen`}
                name={`${participant.displayName}'s screen`}
                stream={participant.screenStream}
                audioStream={null}
                isVideoOn
                isAudioOn
                isLocal={false}
                isScreen
              />
            ))}
        </div>
        {notice && (
          <p className="zvk-notice" role="alert">
            {notice}
          </p>
        )}
        <div className="zvk-controls">
          <button
            type="button"
            className={micLive ? "zvk-button" : "zvk-button zvk-button-off"}
            aria-pressed={micLive}
            onClick={() => void toggleCapture("audio", !micLive)}
          >
            Mic
          </button>
          <button
            type="button"
            className={cameraLive ? "zvk-button" : "zvk-button zvk-button-off"}
            aria-pressed={cameraLive}
            onClick={() => void toggleCapture("video", !cameraLive)}
          >
            Camera
          </button>
          {screenShareSupported && (
            <button
              type="button"
              className={screenShare.isSharing ? "zvk-button" : "zvk-button zvk-button-off"}
              aria-pressed={screenShare.isSharing}
              disabled={!screenShare.isSharing && screenShare.isScreenShareBlocked}
              onClick={() => void toggleScreenShare()}
            >
              Share screen
            </button>
          )}
          {ownCapabilities.includes("start-recording") && (
            <button
              type="button"
              className={isRecording ? "zvk-button" : "zvk-button zvk-button-off"}
              aria-pressed={isRecording}
              onClick={toggleRecord}
            >
              {isRecording ? "Stop recording" : "Record"}
            </button>
          )}
          <button type="button" className="zvk-button zvk-button-leave" onClick={handleLeave}>
            Leave
          </button>
        </div>
      </div>
    );
  }
  return (
    <PreJoinCard
      showNameInput={displayName === undefined}
      name={nameDraft}
      micOn={prejoinMicOn}
      cameraOn={prejoinCameraOn}
      onNameChange={setNameDraft}
      onToggleMic={() => setPrejoinMicOn((value) => !value)}
      onToggleCamera={() => setPrejoinCameraOn((value) => !value)}
      onJoin={() => void joinRoom({ video: prejoinCameraOn, audio: prejoinMicOn })}
    />
  );
}

export function ZvonokRoom(props: ZvonokRoomProps) {
  return (
    <ZvonokProvider serverUrl={props.serverUrl}>
      <ZvonokRoomSurface {...props} />
    </ZvonokProvider>
  );
}
