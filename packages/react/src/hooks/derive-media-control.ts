/**
 * Control-state derivation shared by every mic/camera button: combines the
 * enabled flag, the capture state machine, and host mutes into the states a
 * control renders from (on/off variant, error and loading badges, forced
 * off). Presentation - icons, labels, classes - stays consumer-side.
 */

import type { CaptureState, CaptureStateDisplay } from "@zvonok/client/media/capture-state";
import { getCaptureStateDisplay } from "@zvonok/client/media/capture-state";

export interface MediaControlState {
  /** The control renders as on: enabled and not host-muted. */
  isOn: boolean;
  /** The capture reported an error worth an error badge. */
  hasError: boolean;
  /** The capture is starting; render a pending badge. */
  isLoading: boolean;
  /** A host mute overrides the local control. */
  isForcedOff: boolean;
  /** The client capture-state display (tooltip/status vocabulary). */
  display: CaptureStateDisplay;
}

export interface DeriveMediaControlStateOptions {
  isEnabled: boolean;
  captureState: CaptureState;
  kind: "video" | "audio";
  isMutedByHost?: boolean;
}

export function deriveMediaControlState(
  options: DeriveMediaControlStateOptions,
): MediaControlState {
  const { isEnabled, captureState, kind, isMutedByHost = false } = options;
  const display = getCaptureStateDisplay(captureState, kind);
  return {
    isOn: isEnabled && !isMutedByHost,
    hasError: display.status === "error",
    isLoading: display.status === "loading",
    isForcedOff: isMutedByHost,
    display,
  };
}
