import { render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDeviceSwitcher } from "../components/device-switcher/device-switcher.js";
import { StatusCardsPreset } from "../components/status-cards/status-cards.js";
import type { UseDeviceControlsResult } from "../hooks/use-device-controls.js";
import type { UseZvonokCallResult } from "../hooks/use-zvonok-call.js";
import type { UseZvonokConnectionResult } from "../hooks/use-zvonok-connection.js";

function device(kind: MediaDeviceInfo["kind"], deviceId: string, label: string): MediaDeviceInfo {
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

describe("StatusCardsPreset", () => {
  it("renders nothing for a quiet joined room", () => {
    const { container } = render(
      <StatusCardsPreset call={baseCall} connection={connection("joined")} />,
    );
    expect(container.childElementCount).toBe(0);
  });

  it("renders lock, kick, and typed join-failure cards", () => {
    const locked = render(
      <StatusCardsPreset
        call={{ ...baseCall, isRoomLocked: true }}
        connection={connection("joined")}
      />,
    );
    expect(locked.container.querySelector(".zk-banner")?.textContent).toContain("Room is locked");

    const kicked = render(
      <StatusCardsPreset
        call={{ ...baseCall, wasKicked: true }}
        connection={connection("joined")}
      />,
    );
    expect(kicked.container.querySelector(".zk-card")?.textContent).toContain(
      "removed from the room",
    );

    const failed = render(<StatusCardsPreset call={baseCall} connection={connection("error")} />);
    expect(failed.container.querySelector(".zk-card")?.textContent).toContain(
      "Invalid or expired token",
    );

    const reconnecting = render(
      <StatusCardsPreset call={baseCall} connection={connection("reconnecting")} />,
    );
    expect(reconnecting.container.querySelector(".zk-status")?.textContent).toContain(
      "reconnecting",
    );
  });
});
