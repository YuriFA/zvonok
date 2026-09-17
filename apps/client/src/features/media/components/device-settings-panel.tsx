import { useDeviceControls } from "@zvonok/react";
import { Settings, X, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ActiveDeviceDisplay } from "./active-device-display";
import { SingleDeviceSelector } from "./single-device-selector";

export interface DeviceSettingsPanelProps {
  /** Routes remote-audio playout to a speaker device; absent before joining. */
  setSink?: (deviceId: string) => Promise<boolean>;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  className?: string;
}

export function DeviceSettingsPanel({
  setSink,
  isVideoEnabled,
  isAudioEnabled,
  className,
}: DeviceSettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState<"video" | "audio" | "speaker" | null>(null);

  const {
    devices: allDevices,
    camera,
    mic,
    selectedDevices,
    selectVideoDevice,
    selectAudioDevice,
    selectSpeakerDevice,
    isLoading,
  } = useDeviceControls();

  const videoDevices = allDevices.filter((d) => d.kind === "videoinput");
  const audioDevices = allDevices.filter((d) => d.kind === "audioinput");
  const speakerDevices = allDevices.filter((d) => d.kind === "audiooutput");

  const activeCamera =
    videoDevices.find((d) => d.deviceId === selectedDevices.videoDeviceId) ?? videoDevices[0];
  const activeMicrophone =
    audioDevices.find((d) => d.deviceId === selectedDevices.audioDeviceId) ?? audioDevices[0];
  const activeSpeaker =
    speakerDevices.find((d) => d.deviceId === selectedDevices.speakerDeviceId) ?? speakerDevices[0];

  // Apply the saved speaker selection when the sink router becomes available.
  useEffect(() => {
    const speakerDeviceId = selectedDevices.speakerDeviceId;
    if (!setSink || !speakerDeviceId) return;

    setSink(speakerDeviceId).catch(() => {});
  }, [selectedDevices.speakerDeviceId, setSink]);

  const handleVideoChange = useCallback(
    async (deviceId: string) => {
      setIsSwitching("video");
      try {
        const success = await camera.switchDevice(deviceId);
        if (success) {
          selectVideoDevice(deviceId);
        }
      } finally {
        setIsSwitching(null);
      }
    },
    [camera, selectVideoDevice],
  );

  const handleAudioChange = useCallback(
    async (deviceId: string) => {
      setIsSwitching("audio");
      try {
        const success = await mic.switchDevice(deviceId);
        if (success) {
          selectAudioDevice(deviceId);
        }
      } finally {
        setIsSwitching(null);
      }
    },
    [mic, selectAudioDevice],
  );

  const handleSpeakerChange = useCallback(
    async (deviceId: string) => {
      setIsSwitching("speaker");
      try {
        selectSpeakerDevice(deviceId);
        if (setSink) {
          await setSink(deviceId);
        }
      } finally {
        setIsSwitching(null);
      }
    },
    [setSink, selectSpeakerDevice],
  );

  const renderSelectors = () => (
    <div className="space-y-4">
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading devices...
        </div>
      )}

      <ActiveDeviceDisplay
        camera={activeCamera}
        microphone={activeMicrophone}
        speaker={activeSpeaker}
        isVideoEnabled={isVideoEnabled}
        isAudioEnabled={isAudioEnabled}
      />

      <SingleDeviceSelector
        type="videoinput"
        devices={videoDevices}
        selectedDeviceId={selectedDevices.videoDeviceId}
        onDeviceChange={handleVideoChange}
        disabled={isSwitching !== null}
      />

      <SingleDeviceSelector
        type="audioinput"
        devices={audioDevices}
        selectedDeviceId={selectedDevices.audioDeviceId}
        onDeviceChange={handleAudioChange}
        disabled={isSwitching !== null}
      />

      {"setSinkId" in HTMLMediaElement.prototype && (
        <SingleDeviceSelector
          type="audiooutput"
          devices={speakerDevices}
          selectedDeviceId={selectedDevices.speakerDeviceId}
          onDeviceChange={handleSpeakerChange}
          disabled={isSwitching !== null}
        />
      )}

      {isSwitching && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Switching {isSwitching}...
        </div>
      )}
    </div>
  );

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        title="Device settings"
      >
        {isOpen ? <X className="size-5" /> : <Settings className="size-5" />}
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="Close device settings"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border bg-background p-4 shadow-lg">
            <h3 className="mb-4 font-medium">Device Settings</h3>
            {renderSelectors()}
          </div>
        </>
      )}
    </div>
  );
}
