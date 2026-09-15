import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactHarness = vi.hoisted(() => ({
  permissions: { video: "unknown", audio: "unknown" } as Record<string, string>,
  deviceControls: null as Record<string, unknown> | null,
}));

vi.mock("@zvonok/react", () => ({
  useDevicePermissions: (kind: "video" | "audio") => reactHarness.permissions[kind],
  useDeviceControls: () => reactHarness.deviceControls,
  useVideoStream: vi.fn(),
}));

vi.mock("@/features/media/contexts/media-stream.context", () => ({
  useMediaStreamContext: () => ({ videoStream: null, videoState: "active", audioState: "active" }),
}));
vi.mock("@/features/media/hooks/use-media-controls", () => ({
  useMediaControls: () => ({
    isVideoEnabled: true,
    isAudioEnabled: true,
    setVideoEnabled: vi.fn(),
    setAudioEnabled: vi.fn(),
    getVideoCaptureState: vi.fn(() => "active"),
    getAudioCaptureState: vi.fn(() => "active"),
  }),
}));

function deviceInfo(deviceId: string, label: string, kind: string) {
  return { deviceId, kind, label, groupId: "", toJSON: () => ({}) };
}

import { DeviceSelector } from "../device-selector";

describe("DeviceSelector permission surfacing", () => {
  beforeEach(() => {
    reactHarness.permissions = { video: "unknown", audio: "unknown" };
    reactHarness.deviceControls = {
      devices: [deviceInfo("cam-1", "Cam", "videoinput"), deviceInfo("mic-1", "Mic", "audioinput")],
      camera: { toggle: vi.fn(async () => true), switchDevice: vi.fn(async () => true) },
      mic: { toggle: vi.fn(async () => true), switchDevice: vi.fn(async () => true) },
      selectedDevices: { videoDeviceId: "cam-1", audioDeviceId: "mic-1", speakerDeviceId: "" },
      selectVideoDevice: vi.fn(),
      selectAudioDevice: vi.fn(),
      selectSpeakerDevice: vi.fn(),
    };
  });

  it("explains blocked devices before any join attempt", () => {
    reactHarness.permissions = { video: "denied", audio: "denied" };
    render(<DeviceSelector username="Ann" />);

    expect(screen.getByText("Camera access is blocked")).toBeInTheDocument();
    expect(screen.getByText(/Allow camera access for this site/)).toBeInTheDocument();
    expect(screen.getByText("Microphone access is blocked")).toBeInTheDocument();
    expect(screen.getByText(/Allow microphone access for this site/)).toBeInTheDocument();
  });

  it("renders no permission alerts while permissions are fine", () => {
    reactHarness.permissions = { video: "granted", audio: "granted" };
    render(<DeviceSelector username="Ann" />);

    expect(screen.queryByText("Camera access is blocked")).toBeNull();
    expect(screen.queryByText("Microphone access is blocked")).toBeNull();
  });
});
