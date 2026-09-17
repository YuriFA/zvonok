/**
 * The call session: one hook owning the room media lifecycle over an
 * established connection - publish-on-join, camera and microphone toggles
 * with optimistic state and rollback, host-mute enforcement, kick
 * surfacing, and the participants projection (local included). Consumers
 * render their own notifications from named outcomes and event callbacks;
 * none of that policy lives consumer-side.
 */

import { CaptureState, isActive } from "@zvonok/client/media/capture-state";
import type { SfuConnectionState } from "@zvonok/client/sfu/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import { useSfuTrackSync } from "../core/use-sfu-track-sync.js";
import type { ZvonokParticipant } from "../types.js";
import { createMediaCapturePort, type CapturePort } from "./capture-port.js";
import { createHostControls, type HostControls } from "./host-controls.js";
import { EMPTY_ROOM_STATE, RoomTracker, type RoomTrackerState } from "./room-tracker.js";
import {
  usePublishControls,
  type PublishKind,
  type PublishToggleResult,
  type UsePublishControlsResult,
} from "./use-publish-controls.js";
import { useStoreSelector } from "./use-store-selector.js";
import type { UseZvonokConnectionResult } from "./use-zvonok-connection.js";

export interface UseZvonokCallOptions {
  connection: UseZvonokConnectionResult;
  /** Local identity for the tracker; a stable guest id is generated when omitted. */
  localUserId?: string;
  /** Display name of the local participant projection. */
  localDisplayName?: string;
  /** Publish captured local tracks right after join. Default true. */
  autoPublish?: boolean;
  /** Slower publish errored-retry pacing on phones; forwarded to produce. */
  isMobile?: boolean;
  /** Capture adapter. Default: the provider's shared media manager. */
  capture?: CapturePort;
  /** Fires once per host-mute occurrence, after the mic control is forced off. */
  onHostMuted?(): void;
  /** Fires when the server removes this peer from the room. */
  onKicked?(): void;
}

export interface ToggleControl {
  /** Capture truth with optimistic flips; failures roll back to disabled. */
  readonly isEnabled: boolean;
  /** Raw capture lifecycle state; null when the port reports no changes. */
  readonly captureState: CaptureState | null;
  toggle(): Promise<PublishToggleResult>;
}

export interface UseZvonokCallResult {
  connectionState: SfuConnectionState;
  capabilities: string[];
  isRoomLocked: boolean;
  mutedByHost: boolean;
  wasKicked: boolean;
  /** Remote participants plus the local projection, reference-stable per user. */
  participants: ZvonokParticipant[];
  localUserId: string;
  camera: ToggleControl;
  microphone: ToggleControl;
  hostControls: HostControls;
  kickPeer(userId: string): Promise<void>;
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
}

/**
 * Internal control surface: the public view plus the enforcement access the
 * session needs for host mutes.
 */
interface CallToggleControl extends ToggleControl {
  setEnabled(enabled: boolean): void;
}

function useToggleControl(
  kind: PublishKind,
  publish: UsePublishControlsResult,
  port: CapturePort,
): CallToggleControl {
  const [isEnabled, setIsEnabled] = useState(() => {
    const track = port.getTrack(kind);
    return !!track && track.readyState === "live";
  });
  const [captureState, setCaptureState] = useState<CaptureState | null>(() =>
    port.getTrack(kind) ? CaptureState.ACTIVE : CaptureState.STOPPED,
  );

  // Capture lifecycle truth: hardware start and stop update the control even
  // when the flip came from outside this toggle (device loss, another
  // surface starting or stopping capture).
  useEffect(() => {
    const unsubscribe = port.onStateChange?.(kind, (state: CaptureState) => {
      setCaptureState(state);
      setIsEnabled(isActive(state));
    });
    return () => unsubscribe?.();
  }, [port, kind]);

  const enabledRef = useRef(isEnabled);
  enabledRef.current = isEnabled;

  const toggle = useCallback(async (): Promise<PublishToggleResult> => {
    const next = !enabledRef.current;
    setIsEnabled(next);
    const result = await publish.toggle(kind, next, port);
    if (result !== "published" && result !== "paused") {
      setIsEnabled(false);
    }
    return result;
  }, [kind, port, publish]);

  const control = useMemo(
    () => ({
      isEnabled,
      captureState,
      toggle,
      setEnabled: (enabled: boolean) => setIsEnabled(enabled),
    }),
    [isEnabled, captureState, toggle],
  );
  return control;
}

export function useZvonokCall(options: UseZvonokCallOptions): UseZvonokCallResult {
  const {
    connection,
    capture,
    autoPublish = true,
    isMobile,
    localUserId: localUserIdOption,
    localDisplayName,
    onHostMuted,
    onKicked,
  } = options;
  const session = useZvonokSession();
  const manager = connection.manager;

  const port = useMemo(
    () => capture ?? createMediaCapturePort(session.mediaManager),
    [capture, session.mediaManager],
  );

  // Local UI identity for the tracker. The SFU derives the authoritative
  // identity from the verified session; the guest id is only a stable key
  // for the local projection until (or without) an authenticated id.
  const guestUserIdRef = useRef(`guest-${Math.random().toString(36).slice(2, 10)}`);
  const localUserId = localUserIdOption ?? guestUserIdRef.current;

  // Replace-track sync: capture restarts (device switches) swap the
  // published track in place while a producer exists.
  useSfuTrackSync();

  const publish = usePublishControls(connection, { isMobile });
  const camera = useToggleControl("video", publish, port);
  const microphone = useToggleControl("audio", publish, port);

  const tracker = useMemo(
    () => (manager ? new RoomTracker(manager, { localUserId }) : null),
    [manager, localUserId],
  );
  useEffect(() => () => tracker?.stop(), [tracker]);
  const roomState = useStoreSelector(tracker, selectRoomState) ?? EMPTY_ROOM_STATE;

  // Manager connection state, mirrored for consumers (participants list,
  // auto-quality gate). Same vocabulary as the connection hook's manager.
  const [connectionState, setConnectionState] = useState<SfuConnectionState>(() =>
    manager ? manager.getState().connectionState : "disconnected",
  );
  useEffect(() => {
    if (!manager) {
      setConnectionState("disconnected");
      return;
    }
    setConnectionState(manager.getState().connectionState);
    return manager.onStateChange((state) => setConnectionState(state.connectionState));
  }, [manager]);

  // Publish the captured local tracks once joined. The manager buffers
  // produces until the send transport exists, so publishing immediately
  // after the join is safe.
  const publishedRef = useRef(false);
  useEffect(() => {
    if (connection.status !== "joined") {
      publishedRef.current = false;
      return;
    }
    if (!autoPublish || publishedRef.current) {
      return;
    }
    publishedRef.current = true;
    for (const kind of ["video", "audio"] as const) {
      const track = port.getTrack(kind);
      if (track && track.readyState === "live" && !connection.hasProducer(kind)) {
        void connection
          .produceTrack(track, isMobile === undefined ? undefined : { isMobile })
          .then((produced) => {
            if (produced) {
              connection.resumeProducer(kind);
            }
          })
          .catch((error: unknown) => {
            console.error("[zvonok] Failed to produce track:", kind, error);
          });
      }
    }
  }, [connection, connection.status, autoPublish, port, isMobile]);

  // A server-enforced host mute pauses our producer: force the mic control
  // off and tell the consumer once per occurrence.
  const mutedByHost = roomState.mutedByHost;
  const announcedHostMuteRef = useRef(false);
  useEffect(() => {
    if (!mutedByHost) {
      announcedHostMuteRef.current = false;
      return;
    }
    if (announcedHostMuteRef.current) {
      return;
    }
    announcedHostMuteRef.current = true;
    microphone.setEnabled(false);
    onHostMuted?.();
  }, [mutedByHost, microphone, onHostMuted]);

  // A kicked peer lost the room: release capture through the port and let
  // the consumer navigate.
  useEffect(() => {
    if (!connection.wasKicked) {
      return;
    }
    port.release?.("video");
    port.release?.("audio");
    onKicked?.();
  }, [connection.wasKicked, port, onKicked]);

  const localVideoStream = port.getStream?.("video") ?? null;
  const localAudioStream = port.getStream?.("audio") ?? null;

  const participants = useMemo(
    () => [
      {
        userId: localUserId,
        displayName: localDisplayName ?? "",
        cameraStream: localVideoStream,
        screenStream: null,
        audioStream: localAudioStream,
        isCameraEnabled: camera.isEnabled,
        isScreenSharing: false,
        isAudioEnabled: microphone.isEnabled,
        isConnected: connectionState === "connected",
        mutedByHost,
      },
      ...roomState.participants,
    ],
    [
      localUserId,
      localDisplayName,
      localVideoStream,
      localAudioStream,
      camera.isEnabled,
      microphone.isEnabled,
      connectionState,
      mutedByHost,
      roomState.participants,
    ],
  );

  const kickPeer = useCallback(
    async (userId: string): Promise<void> => {
      // Denials surface here (capability or target races); the participant
      // list updates from peer-left events either way.
      if (!manager) {
        return;
      }
      await manager.kickPeer(userId);
    },
    [manager],
  );

  const hostControls = useMemo(() => createHostControls(manager), [manager]);

  return {
    connectionState,
    capabilities: manager?.getState().capabilities ?? [],
    isRoomLocked: connection.isRoomLocked,
    mutedByHost,
    wasKicked: connection.wasKicked,
    participants,
    localUserId,
    camera,
    microphone,
    hostControls,
    kickPeer,
    localVideoStream,
    localAudioStream,
  };
}

const selectRoomState = (state: RoomTrackerState) => state;
