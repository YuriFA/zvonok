/**
 * Persisted device preferences: the last camera/microphone the user used
 * (plus their audio mute intent), remembered under a namespaced localStorage
 * key. Storage failures (private mode, quota) are swallowed: persistence is
 * a convenience, never a functional requirement.
 */

export type DeviceKind = "video" | "audio";

export interface DevicePreferences {
  video?: { deviceId: string };
  audio?: { deviceId?: string; muted?: boolean };
}

const STORAGE_KEY = "zvonok:device-preferences";

function readStore(): DevicePreferences {
  try {
    if (typeof localStorage === "undefined") {
      return {};
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as DevicePreferences;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(prefs: DevicePreferences): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or quota exceeded: dropping the update is fine.
  }
}

export function loadDevicePreferences(): DevicePreferences {
  return readStore();
}

/** Remembers the device id last successfully used for a kind. */
export function rememberDevice(kind: DeviceKind, deviceId: string): void {
  if (!deviceId) {
    return;
  }
  const prefs = readStore();
  if (kind === "video") {
    writeStore({ ...prefs, video: { deviceId } });
  } else {
    writeStore({ ...prefs, audio: { ...prefs.audio, deviceId } });
  }
}

/** Remembers the user's explicit audio mute intent (a toggle, not track state). */
export function rememberAudioMuted(muted: boolean): void {
  const prefs = readStore();
  writeStore({ ...prefs, audio: { ...prefs.audio, muted: muted || undefined } });
}

export function clearDevicePreferences(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore: nothing persisted is nothing to clear.
  }
}
