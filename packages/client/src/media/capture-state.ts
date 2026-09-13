import { ensureExhausted } from "../helpers/exhausted.js";

export const CaptureState = {
  STOPPED: 0,
  STARTING: 1,
  ACTIVE: 2,
  MUTED: 3,
  DEVICE_ERROR: 4,
  NO_DEVICE: 5,
  DEVICE_IN_USE: 6,
  DEVICE_NOT_FOUND: 7,
  SYSTEM_DENIED: 8,
  CAPTURE_CANCELED: 9,
} as const;

export type CaptureState = (typeof CaptureState)[keyof typeof CaptureState];

export function isActive(state: CaptureState): boolean {
  return state === CaptureState.ACTIVE || state === CaptureState.MUTED;
}

export function isError(state: CaptureState): boolean {
  return (
    state === CaptureState.DEVICE_ERROR ||
    state === CaptureState.NO_DEVICE ||
    state === CaptureState.DEVICE_IN_USE ||
    state === CaptureState.DEVICE_NOT_FOUND ||
    state === CaptureState.SYSTEM_DENIED
  );
}

export function canToggle(state: CaptureState): boolean {
  return (
    state === CaptureState.STOPPED ||
    state === CaptureState.ACTIVE ||
    state === CaptureState.MUTED ||
    state === CaptureState.DEVICE_ERROR ||
    state === CaptureState.DEVICE_NOT_FOUND ||
    state === CaptureState.CAPTURE_CANCELED
  );
}

export function canRetry(state: CaptureState): boolean {
  return (
    state === CaptureState.DEVICE_NOT_FOUND ||
    state === CaptureState.DEVICE_ERROR ||
    state === CaptureState.CAPTURE_CANCELED
  );
}

export type CaptureStateDisplay = {
  tooltip: string;
  status: "loading" | "error" | "on" | "off";
  statusText: string | null;
};

export function getCaptureStateDisplay(
  state: CaptureState,
  kind: "video" | "audio",
): CaptureStateDisplay {
  const label = kind === "video" ? "Camera" : "Microphone";

  switch (state) {
    case CaptureState.ACTIVE:
      return {
        status: "on",
        statusText: null,
        tooltip: `Turn off ${label.toLowerCase()}`,
      };
    case CaptureState.STOPPED:
    case CaptureState.MUTED:
    case CaptureState.CAPTURE_CANCELED:
      return {
        status: "off",
        statusText: null,
        tooltip: `Turn on ${label.toLowerCase()}`,
      };
    case CaptureState.STARTING:
      return {
        status: "loading",
        statusText: "Starting...",
        tooltip: `${label} starting...`,
      };
    case CaptureState.DEVICE_NOT_FOUND:
      return {
        status: "error",
        statusText: "Blocked",
        tooltip: `${label} blocked. You can turn on in browser settings`,
      };
    case CaptureState.SYSTEM_DENIED:
      return {
        status: "error",
        statusText: "Blocked in system settings",
        tooltip: `${label} blocked in system settings`,
      };
    case CaptureState.DEVICE_IN_USE:
      return {
        status: "error",
        statusText: "In use by another app",
        tooltip: `${label} in use by another app`,
      };
    case CaptureState.NO_DEVICE:
      return {
        status: "error",
        statusText: "No device found",
        tooltip: `No ${label.toLowerCase()} found`,
      };
    case CaptureState.DEVICE_ERROR:
      return {
        status: "error",
        statusText: "Device unavailable",
        tooltip: `${label} unavailable`,
      };
    default:
      return ensureExhausted(state);
  }
}
