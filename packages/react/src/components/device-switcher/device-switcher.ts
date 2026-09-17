/**
 * Device switcher block: groups the device controls' reactive device list
 * by kind and exposes selection actions, plus the preset-styled selects.
 * Persistence and permissions live in useDeviceControls; this block only
 * shapes them for a UI.
 */

import { useMemo } from "react";

import type { DeviceSelection, UseDeviceControlsResult } from "../../hooks/use-device-controls.js";
import type { DevicePermissionState } from "../../hooks/use-device-permissions.js";

export interface UseDeviceSwitcherOptions {
  controls: UseDeviceControlsResult;
}

export interface DeviceSwitcher {
  videoDevices: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  selected: DeviceSelection;
  isLoading: boolean;
  permissions: { video: DevicePermissionState; audio: DevicePermissionState };
  selectVideo(deviceId: string | null): void;
  selectAudio(deviceId: string | null): void;
  selectSpeaker(deviceId: string | null): void;
}

export function useDeviceSwitcher(options: UseDeviceSwitcherOptions): DeviceSwitcher {
  const { controls } = options;

  const grouped = useMemo(() => {
    const videoDevices: MediaDeviceInfo[] = [];
    const audioInputs: MediaDeviceInfo[] = [];
    const audioOutputs: MediaDeviceInfo[] = [];
    for (const device of controls.devices) {
      if (device.kind === "videoinput") {
        videoDevices.push(device);
      } else if (device.kind === "audioinput") {
        audioInputs.push(device);
      } else if (device.kind === "audiooutput") {
        audioOutputs.push(device);
      }
    }
    return { videoDevices, audioInputs, audioOutputs };
  }, [controls.devices]);

  return {
    videoDevices: grouped.videoDevices,
    audioInputs: grouped.audioInputs,
    audioOutputs: grouped.audioOutputs,
    selected: controls.selectedDevices,
    isLoading: controls.isLoading,
    permissions: controls.permissions,
    selectVideo: controls.selectVideoDevice,
    selectAudio: controls.selectAudioDevice,
    selectSpeaker: controls.selectSpeakerDevice,
  };
}
