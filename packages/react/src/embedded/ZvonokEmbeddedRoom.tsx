/**
 * Embedded room: the prebuilt drop-in meeting room of @zvonok/react,
 * composed entirely from the package's public components. Renders its own
 * ZvonokProvider from the `serverUrl` prop, so a consumer needs exactly one
 * element to get a working room. Identity stays with the token: the
 * optional `displayName` is presentational - it pre-fills the prejoin name
 * input and labels the local tile, and its presence skips the prejoin card.
 *
 * Styling ships via the `./css/*` subpath exports: import
 * `@zvonok/react/css/component-kit.css` and `@zvonok/react/css/embedded.css`
 * (or ship both from your bundler); the component puts the `zk` namespace
 * class on its roots itself. Theming works by overriding the documented
 * `--zk-*` tokens; class names and DOM are not a contract.
 *
 * Non-goals (widget v2 candidates): chat, host-control UI, keyboard
 * shortcuts, guest approvals.
 */

import "../css/component-kit.css";
import "../css/embedded.css";

import { isActive } from "@zvonok/client/media/capture-state";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Tile } from "../tile.js";
import {
  hasCapabilities,
  mapScreenShareError,
  usePrejoin,
  usePublishControls,
  useRoomLayout,
  useSfuTrackSync,
} from "../index.js";
import { useDeviceControls } from "../use-device-controls.js";
import { useEgressControls } from "../use-egress-controls.js";
import { useEgressState } from "../use-egress-state.js";
import { useOwnCapabilities } from "../use-own-capabilities.js";
import { useParticipants } from "../use-participants.js";
import { useRemoteAudio } from "../use-remote-audio.js";
import { useScreenShare } from "../use-screen-share.js";
import { PeerQualityProvider } from "../peer-quality-context.js";
import {
  useZvonokConnection,
  type UseZvonokConnectionResult,
} from "../use-zvonok-connection.js";
import { ZvonokError } from "../errors.js";
import { ZvonokProvider, useZvonokSession } from "../zvonok-context.js";
import type { ZvonokParticipant } from "../types.js";

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
  /** Called after the participant leaves via the widget's leave control. */
  onLeft?: () => void;
  /** Called with the typed error when the join fails. */
  onError?: (error: unknown) => void;
  /** Skip the prejoin card and join immediately with mic and camera on. */
  skipPrejoin?: boolean;
  /** Rendered alongside the stage inside the room surface. */
  children?: React.ReactNode;
  /** Extra class for the room root, composed with the `zk` namespace. */
  className?: string;
}

/** Friendly copy for the typed screen share failures of ScreenShareService. */
function screenShareNotice(error: unknown): string {
  return (
    mapScreenShareError(error, {
      blocked: "Another participant is already sharing their screen",
      unsupported: "Screen share is not supported in this browser",
      denied: "Screen share permission was denied",
      fallback: "Screen share was cancelled",
    }) ?? "Screen share was cancelled"
  );
}

function screenShareSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/** Measures the stage for the spotlight layout derivation. */
function useStageSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

interface EmbeddedTileProps {
  name: string;
  /**
   * Participant id for camera tiles: opts the tile into viewport-driven
   * layer selection. Screen-share and local tiles stay unwired.
   */
  userId?: string;
  stream: MediaStream | null;
  isVideoOn: boolean;
  /** Participant audio state; drives the muted badge. */
  isAudioOn: boolean;
  /** Local tile: mutes its own video element and marks the name badge. */
  isLocal: boolean;
  isScreen: boolean;
  style?: React.CSSProperties;
}

/**
 * One tile: media plumbing in the core Tile (video binding, camera-off
 * overlay, visibility tracking), plus the preset badges. Memoized:
 * participants keep stable object references between room snapshots, so
 * unrelated room events must not re-render every tile.
 */
const EmbeddedTile = memo(function EmbeddedTile({
  name,
  userId,
  stream,
  isVideoOn,
  isAudioOn,
  isLocal,
  isScreen,
  style,
}: EmbeddedTileProps) {
  return (
    <Tile
      userId={userId ?? null}
      stream={stream}
      isVideoEnabled={isVideoOn}
      isMuted={isLocal}
      className={isScreen ? "zk-tile zk-tile-screen" : "zk-tile"}
      style={style}
    >
      {!isAudioOn && <span className="zk-badge zk-badge-muted">muted</span>}
      <span className="zk-badge">
        {name}
        {isLocal ? " (you)" : ""}
      </span>
    </Tile>
  );
});

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
    <div className="zk zk-room zk-prejoin">
      <form
        className="zk-card"
        onSubmit={(event) => {
          event.preventDefault();
          onJoin();
        }}
      >
        <h1 className="zk-title">Join room</h1>
        {showNameInput && (
          <label className="zk-field">
            <span>Display name</span>
            <input
              className="zk-input"
              name="displayName"
              placeholder="Your name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
        )}
        <div className="zk-toggle-row">
          <button
            type="button"
            className={micOn ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={micOn}
            onClick={onToggleMic}
          >
            Mic
          </button>
          <button
            type="button"
            className={cameraOn ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={cameraOn}
            onClick={onToggleCamera}
          >
            Camera
          </button>
        </div>
        <button type="submit" className="zk-button zk-button-join">
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
    <div className="zk zk-room zk-error" role="alert">
      <div className="zk-error-card">
        <h1 className="zk-title">Could not join the room</h1>
        {code && <span className="zk-error-code">{code}</span>}
        <p className="zk-error-message">{error.message}</p>
        <button type="button" className="zk-button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function EmbeddedRoomSurface({
  roomSlug,
  token,
  displayName,
  layout = "grid",
  onLeft,
  onError,
  skipPrejoin,
  children,
  className,
}: Omit<ZvonokEmbeddedRoomProps, "serverUrl">) {
  const session = useZvonokSession();
  const connection: UseZvonokConnectionResult = useZvonokConnection({ roomSlug, token });
  const { participants } = useParticipants();
  const devices = useDeviceControls();
  const ownCapabilities = useOwnCapabilities();
  const { isRecording } = useEgressState();
  const egressControls = useEgressControls();
  const publish = usePublishControls(connection);

  // Replace-track sync: capture restarts (device switches) swap the
  // published track in place while a producer exists.
  useSfuTrackSync();

  const skip = skipPrejoin === true || displayName !== undefined;
  const [prejoinMicOn, setPrejoinMicOn] = useState(true);
  const [prejoinCameraOn, setPrejoinCameraOn] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const { mediaManager } = session;

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
      // Initial publish: a fresh join has no producers, so each live
      // capture is produced unconditionally (the toggle surface with its
      // hasProducer branch is for user toggles, not for joining).
      const captures = [
        ["video", mediaManager.videoCapture] as const,
        ["audio", mediaManager.audioCapture] as const,
      ];
      for (const [kind, capture] of captures) {
        if (!isActive(capture.getState())) {
          continue;
        }
        const track = capture.getTrack();
        if (track && (await connection.produceTrack(track))) {
          connection.resumeProducer(kind);
        }
      }
    },
    [devices, connection, mediaManager, publish],
  );

  const prejoin = usePrejoin({
    initialName: displayName ?? "",
    skip,
    onConfirm: async () => {
      await joinRoom({ video: prejoinCameraOn, audio: prejoinMicOn });
    },
  });

  const inRoom =
    connection.status === "joined" ||
    connection.status === "connecting" ||
    connection.status === "reconnecting";

  // Remote-audio playout: one shared graph, no per-tile audio elements.
  useRemoteAudio();
  // Screen share orchestration over the joined manager: sharing state,
  // exclusive-lock blocking, and typed failures live in the hook.
  const screenShare = useScreenShare();

  useEffect(() => {
    if (connection.error) {
      onError?.(connection.error);
    }
  }, [connection.error, onError]);

  const toggleCapture = useCallback(
    async (kind: "video" | "audio", enabled: boolean) => {
      const control = kind === "video" ? devices.camera : devices.mic;
      const capture = kind === "video" ? mediaManager.videoCapture : mediaManager.audioCapture;
      // Enabling flips the capture first; the fresh track is then published
      // through the shared orchestration. Disabling flips on release.
      if (enabled && !(await control.toggle(true))) {
        return;
      }
      const result = await publish.toggle(kind, enabled, {
        getTrack: () => capture.getTrack(),
        release: () => control.toggle(false),
      });
      if (result === "produce-failed" || result === "replace-failed") {
        await control.toggle(false);
      }
    },
    [devices, mediaManager, publish],
  );

  const toggleScreenShare = useCallback(async () => {
    setNotice(null);
    if (screenShare.sharing) {
      screenShare.stop();
      return;
    }
    try {
      await screenShare.start();
    } catch (error) {
      setNotice(screenShareNotice(error));
    }
  }, [screenShare]);

  // Recording control appears only for participants the server granted
  // start-recording; the capability list is server-delivered, never guessed.
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

  const micLive = isActive(devices.mic.state) && devices.mic.track !== null;
  const cameraLive = isActive(devices.camera.state) && devices.camera.track !== null;

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
      <RoomSurface
        roomSlug={roomSlug}
        layout={layout}
        connectionStatus={connection.status}
        participants={participants}
        localName={displayName?.trim() || prejoin.displayName.trim() || "You"}
        localStream={devices.camera.track ? new MediaStream([devices.camera.track]) : null}
        micLive={micLive}
        cameraLive={cameraLive}
        screenShare={screenShare}
        notice={notice}
        canRecord={hasCapabilities(ownCapabilities, "start-recording")}
        isRecording={isRecording}
        onToggleMic={() => void toggleCapture("audio", !micLive)}
        onToggleCamera={() => void toggleCapture("video", !cameraLive)}
        onToggleScreenShare={() => void toggleScreenShare()}
        onToggleRecord={toggleRecord}
        onLeave={handleLeave}
        className={className}
      >
        {children}
      </RoomSurface>
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

interface RoomSurfaceProps {
  roomSlug: string;
  layout: "grid" | "spotlight";
  connectionStatus: UseZvonokConnectionResult["status"];
  participants: ZvonokParticipant[];
  localName: string;
  localStream: MediaStream | null;
  micLive: boolean;
  cameraLive: boolean;
  screenShare: ReturnType<typeof useScreenShare>;
  notice: string | null;
  canRecord: boolean;
  isRecording: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleRecord: () => void;
  onLeave: () => void;
  className?: string;
  children?: React.ReactNode;
}

function RoomSurface({
  roomSlug,
  layout,
  connectionStatus,
  participants,
  localName,
  localStream,
  micLive,
  cameraLive,
  screenShare,
  notice,
  canRecord,
  isRecording,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onToggleRecord,
  onLeave,
  className,
  children,
}: RoomSurfaceProps) {
  const stage = useStageSize();

  const screenSharers = useMemo(
    () =>
      participants.filter(
        (participant) => participant.isScreenSharing && participant.screenStream !== null,
      ),
    [participants],
  );

  // Spotlight layout: the derivation picks the sharer, orders local-first,
  // and computes the tile rects; grid layout keeps the flow grid.
  const arranged = useRoomLayout({
    participants: useMemo(
      () => [
        { userId: "local", isLocal: true, isScreenSharing: false },
        ...participants.map((participant) => ({
          userId: participant.userId,
          isScreenSharing: participant.isScreenSharing && participant.screenStream !== null,
        })),
      ],
      [participants],
    ),
    containerWidth: layout === "spotlight" ? stage.size.width : 0,
    containerHeight: layout === "spotlight" ? stage.size.height : 0,
  });

  const byUserId = useMemo(() => {
    const map = new Map<string, ZvonokParticipant>();
    for (const participant of participants) {
      map.set(participant.userId, participant);
    }
    return map;
  }, [participants]);

  return (
    <div className={["zk", "zk-room", className].filter(Boolean).join(" ")}>
      <header className="zk-header">
        <span className="zk-room-name">{roomSlug}</span>
        <span className="zk-count">
          {participants.length + 1} {participants.length === 0 ? "participant" : "participants"}
        </span>
      </header>
      {connectionStatus === "connecting" && (
        <p className="zk-status" role="status">
          Connecting...
        </p>
      )}
      {connectionStatus === "reconnecting" && (
        <p className="zk-status" role="status">
          Connection lost - reconnecting...
        </p>
      )}
      {layout === "spotlight" ? (
        <PeerQualityProvider enabled={connectionStatus === "joined"}>
        <div ref={stage.ref} className="zk-stage">
          {arranged.tiles.map((tile) => {
            if (tile.userId === "local") {
              return (
                <EmbeddedTile
                  key="local"
                  name={localName}
                  stream={localStream}
                  isVideoOn={cameraLive}
                  isAudioOn={micLive}
                  isLocal
                  isScreen={false}
                  style={rectStyle(tile.rect)}
                />
              );
            }
            const participant = byUserId.get(tile.userId);
            const isSpotlight = arranged.spotlight?.userId === tile.userId;
            return (
              <EmbeddedTile
                key={tile.userId}
                name={
                  isSpotlight
                    ? `${participant?.displayName}'s screen`
                    : (participant?.displayName ?? tile.userId)
                }
                stream={
                  isSpotlight
                    ? (participant?.screenStream ?? null)
                    : (participant?.cameraStream ?? null)
                }
                isVideoOn={isSpotlight || (participant?.isCameraEnabled ?? false)}
                isAudioOn={isSpotlight || (participant?.isAudioEnabled ?? false)}
                isLocal={false}
                isScreen={isSpotlight}
                userId={isSpotlight ? undefined : tile.userId}
                style={rectStyle(tile.rect)}
              />
            );
          })}
        </div>
        </PeerQualityProvider>
      ) : (
        <PeerQualityProvider enabled={connectionStatus === "joined"}>
        <div className="zk-grid">
          <EmbeddedTile
            name={localName}
            stream={localStream}
            isVideoOn={cameraLive}
            isAudioOn={micLive}
            isLocal
            isScreen={false}
          />
          {participants.map((participant: ZvonokParticipant) => (
            <EmbeddedTile
              key={participant.userId}
              name={participant.displayName}
              stream={participant.cameraStream}
              isVideoOn={participant.isCameraEnabled}
              isAudioOn={participant.isAudioEnabled}
              isLocal={false}
              isScreen={false}
              userId={participant.userId}
            />
          ))}
          {screenSharers.map((participant) => (
            <EmbeddedTile
              key={`${participant.userId}-screen`}
              name={`${participant.displayName}'s screen`}
              stream={participant.screenStream}
              isVideoOn
              isAudioOn
              isLocal={false}
              isScreen
            />
          ))}
        </div>
        </PeerQualityProvider>
      )}
      {notice && (
        <p className="zk-notice" role="alert">
          {notice}
        </p>
      )}
      <div className="zk-controls">
        <button
          type="button"
          className={micLive ? "zk-button" : "zk-button zk-button-off"}
          aria-pressed={micLive}
          onClick={onToggleMic}
        >
          Mic
        </button>
        <button
          type="button"
          className={cameraLive ? "zk-button" : "zk-button zk-button-off"}
          aria-pressed={cameraLive}
          onClick={onToggleCamera}
        >
          Camera
        </button>
        {screenShareSupported() && (
          <button
            type="button"
            className={screenShare.sharing ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={screenShare.sharing}
            disabled={!screenShare.sharing && screenShare.blocked}
            onClick={onToggleScreenShare}
          >
            Share screen
          </button>
        )}
        {canRecord && (
          <button
            type="button"
            className={isRecording ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={isRecording}
            onClick={onToggleRecord}
          >
            {isRecording ? "Stop recording" : "Record"}
          </button>
        )}
        <button type="button" className="zk-button zk-button-leave" onClick={onLeave}>
          Leave
        </button>
      </div>
      {children}
    </div>
  );
}

function rectStyle(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): React.CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: rect.width,
    height: rect.height,
    transform: `translateX(${rect.x}px) translateY(${rect.y}px)`,
  };
}

export function ZvonokEmbeddedRoom(props: ZvonokEmbeddedRoomProps) {
  return (
    <ZvonokProvider serverUrl={props.serverUrl}>
      <EmbeddedRoomSurface {...props} />
    </ZvonokProvider>
  );
}
