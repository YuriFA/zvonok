import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactHarness = vi.hoisted(() => ({
  permissions: { video: "unknown", audio: "unknown" } as Record<string, string>,
  mediaManager: {},
}));

vi.mock("@zvonok/react", () => ({
  useZvonokSession: () => ({ mediaManager: reactHarness.mediaManager }),
  useDevicePermissions: (kind: "video" | "audio") => reactHarness.permissions[kind],
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
vi.mock("@/features/media/hooks/use-device-switching", () => ({
  useDeviceSwitching: () => ({
    switchVideoDevice: vi.fn(async () => true),
    switchAudioDevice: vi.fn(async () => true),
  }),
}));
vi.mock("@/features/media/hooks/use-media-devices", () => ({
  useMediaDevices: () => ({
    videoDevices: [{ deviceId: "cam-1", label: "Cam" }],
    audioDevices: [{ deviceId: "mic-1", label: "Mic" }],
    speakerDevices: [],
    selectedDevices: { videoDeviceId: "cam-1", audioDeviceId: "mic-1", speakerDeviceId: "" },
    setSelectedVideoDevice: vi.fn(),
    setSelectedAudioDevice: vi.fn(),
    setSelectedSpeakerDevice: vi.fn(),
  }),
}));

import { DeviceSelector } from "../device-selector";

describe("DeviceSelector permission surfacing", () => {
  beforeEach(() => {
    reactHarness.permissions = { video: "unknown", audio: "unknown" };
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
