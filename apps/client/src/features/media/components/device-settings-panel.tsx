import { Settings, X, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useDeviceSwitching } from "../hooks/use-device-switching";
import { useMediaDevices } from "../hooks/use-media-devices";
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
    videoDevices,
    audioDevices,
    speakerDevices,
    selectedDevices,
    setSelectedVideoDevice,
    setSelectedAudioDevice,
    setSelectedSpeakerDevice,
    isLoading,
  } = useMediaDevices();

  const { switchVideoDevice, switchAudioDevice } = useDeviceSwitching();

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
        const success = await switchVideoDevice(deviceId);
        if (success) {
          setSelectedVideoDevice(deviceId);
        }
      } finally {
        setIsSwitching(null);
      }
    },
    [switchVideoDevice, setSelectedVideoDevice],
  );

  const handleAudioChange = useCallback(
    async (deviceId: string) => {
      setIsSwitching("audio");
      try {
        const success = await switchAudioDevice(deviceId);
        if (success) {
          setSelectedAudioDevice(deviceId);
        }
      } finally {
        setIsSwitching(null);
      }
    },
    [switchAudioDevice, setSelectedAudioDevice],
  );

  const handleSpeakerChange = useCallback(
    async (deviceId: string) => {
      setIsSwitching("speaker");
      try {
        setSelectedSpeakerDevice(deviceId);
        if (setSink) {
          await setSink(deviceId);
        }
      } finally {
        setIsSwitching(null);
      }
    },
    [setSink, setSelectedSpeakerDevice],
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
