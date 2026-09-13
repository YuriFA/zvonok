import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDevicePreferences,
  loadDevicePreferences,
  rememberAudioMuted,
  rememberDevice,
} from "../device-preferences.js";

describe("device preferences", () => {
  beforeEach(() => {
    clearDevicePreferences();
  });

  it("round-trips a remembered device per kind", () => {
    expect(loadDevicePreferences()).toEqual({});

    rememberDevice("video", "cam-1");
    rememberDevice("audio", "mic-1");

    expect(loadDevicePreferences()).toEqual({
      video: { deviceId: "cam-1" },
      audio: { deviceId: "mic-1" },
    });
  });

  it("keeps the audio mute intent alongside the device id", () => {
    rememberDevice("audio", "mic-1");
    rememberAudioMuted(true);
    expect(loadDevicePreferences().audio).toEqual({ deviceId: "mic-1", muted: true });

    rememberAudioMuted(false);
    expect(loadDevicePreferences().audio?.muted).toBeUndefined();
    expect(loadDevicePreferences().audio?.deviceId).toBe("mic-1");
  });

  it("ignores empty device ids", () => {
    rememberDevice("video", "");
    expect(loadDevicePreferences().video).toBeUndefined();
  });

  it("falls back to defaults on corrupt stored data", () => {
    localStorage.setItem("zvonok:device-preferences", "{not json");
    expect(loadDevicePreferences()).toEqual({});
  });

  it("survives storage write failures", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() => rememberDevice("video", "cam-1")).not.toThrow();
    expect(loadDevicePreferences().video).toBeUndefined();
    setItem.mockRestore();
  });

  it("clears everything", () => {
    rememberDevice("video", "cam-1");
    clearDevicePreferences();
    expect(loadDevicePreferences()).toEqual({});
  });
});
