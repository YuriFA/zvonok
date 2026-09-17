/**
 * Device switcher preset: zk-styled selects over the switcher core.
 * Persistence and permissions come from useDeviceControls.
 */

import type { UseDeviceControlsResult } from "../use-device-controls.js";
import { useDeviceSwitcher } from "./device-switcher.js";

export interface DeviceSwitcherPresetProps {
  controls: UseDeviceControlsResult;
  className?: string;
}

const COPY = {
  camera: "Camera",
  microphone: "Microphone",
  speaker: "Speaker",
  loading: "Loading devices...",
  noDevices: "No devices found",
} as const;

function DeviceSelect({
  label,
  devices,
  selectedId,
  onSelect,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  selectedId: string | null;
  onSelect: (deviceId: string | null) => void;
}) {
  return (
    <label className="zk-field">
      <span>{label}</span>
      <select
        className="zk-select"
        value={selectedId ?? ""}
        onChange={(event) => onSelect(event.target.value === "" ? null : event.target.value)}
      >
        {devices.length === 0 && <option value="">{COPY.noDevices}</option>}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || device.deviceId}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DeviceSwitcherPreset({ controls, className }: DeviceSwitcherPresetProps) {
  const switcher = useDeviceSwitcher({ controls });

  if (switcher.isLoading) {
    return (
      <div className={["zk-panel", className].filter(Boolean).join(" ")} role="status">
        {COPY.loading}
      </div>
    );
  }

  return (
    <div className={["zk-panel zk-device-switcher", className].filter(Boolean).join(" ")}>
      <DeviceSelect
        label={COPY.camera}
        devices={switcher.videoDevices}
        selectedId={switcher.selected.videoDeviceId}
        onSelect={switcher.selectVideo}
      />
      <DeviceSelect
        label={COPY.microphone}
        devices={switcher.audioInputs}
        selectedId={switcher.selected.audioDeviceId}
        onSelect={switcher.selectAudio}
      />
      <DeviceSelect
        label={COPY.speaker}
        devices={switcher.audioOutputs}
        selectedId={switcher.selected.speakerDeviceId}
        onSelect={switcher.selectSpeaker}
      />
    </div>
  );
}
