/**
 * Media controls block: the mic/camera control states and toggle handlers
 * every control bar renders from, plus the preset-styled bar segment.
 * The core is markup-free (the vendor app renders its own buttons from it);
 * the preset is the zero-wiring variant used by the prebuilt room.
 */

import { CaptureState } from "@zvonok/client/media/capture-state";
import { useCallback, useMemo } from "react";

import {
  deriveMediaControlState,
  type MediaControlState,
} from "../../hooks/derive-media-control.js";
import type { PublishToggleResult } from "../../hooks/use-publish-controls.js";
import type { ToggleControl } from "../../hooks/use-zvonok-call.js";

export interface UseMediaControlsOptions {
  camera: ToggleControl;
  microphone: ToggleControl;
  /** A server host mute overrides the audio control. */
  mutedByHost?: boolean;
  /**
   * Surfaced when a toggle fails at track replacement and the control
   * rolls back. One mapping serves both preset variants.
   */
  onNotice?: (notice: { key: string; message: string }) => void;
}

export interface MediaControls {
  /** Camera control state, including capture error/loading display. */
  video: MediaControlState;
  /** Microphone control state; a host mute overrides the display. */
  audio: MediaControlState;
  toggleVideo(): Promise<PublishToggleResult>;
  toggleAudio(): Promise<PublishToggleResult>;
}

/** Replace-failure notices; identical wording across control variants. */
const FAILURE_COPY = {
  micRestartFailed: "Failed to restart the microphone",
  cameraRestartFailed: "Failed to restart the camera",
} as const;

export function useMediaControls(options: UseMediaControlsOptions): MediaControls {
  const { camera, microphone, mutedByHost = false, onNotice } = options;

  const video = useMemo(
    () =>
      deriveMediaControlState({
        isEnabled: camera.isEnabled,
        captureState: camera.captureState ?? CaptureState.STOPPED,
        kind: "video",
      }),
    [camera.isEnabled, camera.captureState],
  );

  const audio = useMemo<MediaControlState>(() => {
    const derived = deriveMediaControlState({
      isEnabled: microphone.isEnabled,
      captureState: microphone.captureState ?? CaptureState.STOPPED,
      kind: "audio",
      isMutedByHost: mutedByHost,
    });
    // A host mute replaces the capture-state vocabulary entirely.
    if (!mutedByHost) {
      return derived;
    }
    return {
      ...derived,
      display: { status: "off", tooltip: "Muted by host", statusText: null },
    };
  }, [microphone.isEnabled, microphone.captureState, mutedByHost]);

  const toggleVideo = useCallback(() => {
    return camera.toggle().then((outcome) => {
      if (outcome === "replace-failed") {
        onNotice?.({
          key: "video-restart-failed",
          message: FAILURE_COPY.cameraRestartFailed,
        });
      }
      return outcome;
    });
  }, [camera, onNotice]);
  const toggleAudio = useCallback(() => {
    return microphone.toggle().then((outcome) => {
      if (outcome === "replace-failed") {
        onNotice?.({ key: "audio-restart-failed", message: FAILURE_COPY.micRestartFailed });
      }
      return outcome;
    });
  }, [microphone, onNotice]);

  return { video, audio, toggleVideo, toggleAudio };
}

export interface MediaControlButtonProps {
  state: MediaControlState;
  labelOn: string;
  labelOff: string;
  onClick: () => void;
}

/** Preset control button over one derived media state. */
export function MediaControlButton({ state, labelOn, labelOff, onClick }: MediaControlButtonProps) {
  const label = state.isOn ? labelOn : labelOff;
  return (
    <button
      type="button"
      className={state.isOn ? "zk-button" : "zk-button zk-button-off"}
      aria-pressed={state.isOn}
      title={state.isForcedOff ? "Muted by host" : state.display.tooltip}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export interface MediaControlsPresetProps {
  controls: MediaControls;
  /**
   * Replace-failure notices surface through the controls' own wiring:
   * pass onNotice to useMediaControls, not here.
   */
  className?: string;
}

const COPY = {
  micOn: "Mic",
  micOff: "Mic off",
  cameraOn: "Camera",
  cameraOff: "Camera off",
} as const;

/**
 * Preset mic/camera buttons. Toggles run through the core, which surfaces
 * the replace-failure notice.
 */
export function MediaControlsPreset({ controls, className }: MediaControlsPresetProps) {
  return (
    <div className={["zk-media-controls", className].filter(Boolean).join(" ")}>
      <MediaControlButton
        state={controls.audio}
        labelOn={COPY.micOn}
        labelOff={COPY.micOff}
        onClick={() => void controls.toggleAudio()}
      />
      <MediaControlButton
        state={controls.video}
        labelOn={COPY.cameraOn}
        labelOff={COPY.cameraOff}
        onClick={() => void controls.toggleVideo()}
      />
    </div>
  );
}
