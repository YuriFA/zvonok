import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { UseDeviceControlsResult } from "../../use-device-controls.js";
import type { UseZvonokConnectionResult } from "../../use-zvonok-connection.js";
import { useDeviceSwitcher } from "../device-switcher.js";
import { useRoomStatus } from "../status-cards.js";
import type { UseZvonokCallResult } from "../../use-zvonok-call.js";

function device(
  kind: MediaDeviceInfo["kind"],
  deviceId: string,
  label: string,
): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: "g1", toJSON: () => ({}) };
}

function controls(overrides: Partial<UseDeviceControlsResult> = {}): UseDeviceControlsResult {
  return {
    camera: {} as UseDeviceControlsResult["camera"],
    mic: {} as UseDeviceControlsResult["mic"],
    start: vi.fn(),
    stop: vi.fn(),
    enumerateDevices: vi.fn(),
    devices: [
      device("videoinput", "cam1", "FaceTime"),
      device("audioinput", "mic1", "Mic"),
      device("audiooutput", "spk1", "Speakers"),
    ],
    isLoading: false,
    selectedDevices: { videoDeviceId: "cam1", audioDeviceId: "mic1", speakerDeviceId: null },
    selectVideoDevice: vi.fn(),
    selectAudioDevice: vi.fn(),
    selectSpeakerDevice: vi.fn(),
    permissions: { video: "granted", audio: "granted" },
    ...overrides,
  } as UseDeviceControlsResult;
}

describe("useDeviceSwitcher", () => {
  it("groups the device list by kind and forwards selection", () => {
    const selectVideoDevice = vi.fn();
    const selectSpeakerDevice = vi.fn();
    const { result } = renderHook(() =>
      useDeviceSwitcher({ controls: controls({ selectVideoDevice, selectSpeakerDevice }) }),
    );

    expect(result.current.videoDevices.map((d) => d.deviceId)).toEqual(["cam1"]);
    expect(result.current.audioInputs.map((d) => d.deviceId)).toEqual(["mic1"]);
    expect(result.current.audioOutputs.map((d) => d.deviceId)).toEqual(["spk1"]);
    expect(result.current.selected.videoDeviceId).toBe("cam1");
    expect(result.current.permissions.video).toBe("granted");

    result.current.selectVideo("cam2");
    result.current.selectSpeaker("spk2");
    expect(selectVideoDevice).toHaveBeenCalledWith("cam2");
    expect(selectSpeakerDevice).toHaveBeenCalledWith("spk2");
  });
});

function connection(status: UseZvonokConnectionResult["status"]): UseZvonokConnectionResult {
  return {
    status,
    error: status === "error" ? new Error("Invalid or expired token") : null,
  } as UseZvonokConnectionResult;
}

const baseCall = {
  connectionState: "connected",
  isRoomLocked: false,
  wasKicked: false,
} as UseZvonokCallResult;

describe("useRoomStatus", () => {
  it("derives the quiet room state", () => {
    const { result } = renderHook(() =>
      useRoomStatus({ call: baseCall, connection: connection("joined") }),
    );
    expect(result.current).toMatchObject({
      isConnecting: false,
      isReconnecting: false,
      isRoomLocked: false,
      wasKicked: false,
      hasJoinError: false,
    });
  });

  it("derives lock, kick, and typed join-failure states", () => {
    const kicked = renderHook(() =>
      useRoomStatus({
        call: { ...baseCall, isRoomLocked: true, wasKicked: true },
        connection: connection("joined"),
      }),
    ).result;
    expect(kicked.current.isRoomLocked).toBe(true);
    expect(kicked.current.wasKicked).toBe(true);

    const failed = renderHook(() =>
      useRoomStatus({ call: baseCall, connection: connection("error") }),
    ).result;
    expect(failed.current.hasJoinError).toBe(true);
    expect(failed.current.joinError?.message).toBe("Invalid or expired token");

    const reconnecting = renderHook(() =>
      useRoomStatus({ call: baseCall, connection: connection("reconnecting") }),
    ).result;
    expect(reconnecting.current.isReconnecting).toBe(true);
  });
});
