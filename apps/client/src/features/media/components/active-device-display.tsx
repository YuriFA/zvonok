import { Video, Mic, Volume2, VideoOff, MicOff, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ActiveDeviceDisplayProps {
  /** Camera device info */
  camera?: MediaDeviceInfo;
  /** Microphone device info */
  microphone?: MediaDeviceInfo;
  /** Speaker device info */
  speaker?: MediaDeviceInfo;
  isVideoEnabled?: boolean;
  /** Whether audio is enabled */
  isAudioEnabled?: boolean;
  /** Compact mode shows only icons */
  compact?: boolean;
  /** Additional class names */
  className?: string;
}

interface DeviceIndicatorProps {
  icon: typeof Video;
  label: string;
  deviceName?: string;
  isEnabled?: boolean;
  showLabel: boolean;
}

function DeviceIndicator({
  icon: Icon,
  label,
  deviceName,
  isEnabled = true,
  showLabel,
}: DeviceIndicatorProps) {
  const valueText = deviceName || `No ${label.toLowerCase()}`;
  const displayText = `${label}: ${valueText}`;

  return (
    <div
      className={cn("flex items-center gap-1.5", !isEnabled && "text-muted-foreground opacity-60")}
      title={displayText}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{displayText}</span>
      {showLabel && <span className="text-sm">{displayText}</span>}
    </div>
  );
}

export function ActiveDeviceDisplay({
  camera,
  microphone,
  speaker,
  isVideoEnabled = true,
  isAudioEnabled = true,
  compact = false,
  className,
}: ActiveDeviceDisplayProps) {
  if (compact) {
    return (
      <fieldset className={cn("flex items-center gap-2", className)}>
        <legend className="sr-only">Active devices</legend>
        {isVideoEnabled ? (
          <DeviceIndicator
            icon={Video}
            label="Camera"
            deviceName={camera?.label}
            isEnabled={true}
            showLabel={false}
          />
        ) : (
          <span className="text-muted-foreground opacity-60" title="Camera off">
            <VideoOff className="size-4" aria-hidden="true" />
            <span className="sr-only">Camera off</span>
          </span>
        )}

        {isAudioEnabled ? (
          <DeviceIndicator
            icon={Mic}
            label="Microphone"
            deviceName={microphone?.label}
            isEnabled={true}
            showLabel={false}
          />
        ) : (
          <span className="text-muted-foreground opacity-60" title="Microphone off">
            <MicOff className="size-4" aria-hidden="true" />
            <span className="sr-only">Microphone off</span>
          </span>
        )}

        {speaker ? (
          <DeviceIndicator
            icon={Volume2}
            label="Speaker"
            deviceName={speaker.label}
            isEnabled={true}
            showLabel={false}
          />
        ) : (
          <span className="text-muted-foreground opacity-60" title="No speaker">
            <VolumeX className="size-4" aria-hidden="true" />
            <span className="sr-only">No speaker</span>
          </span>
        )}
      </fieldset>
    );
  }

  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="sr-only">Active devices</legend>
      <DeviceIndicator
        icon={isVideoEnabled ? Video : VideoOff}
        label="Camera"
        deviceName={camera?.label}
        isEnabled={isVideoEnabled}
        showLabel={true}
      />
      <DeviceIndicator
        icon={isAudioEnabled ? Mic : MicOff}
        label="Microphone"
        deviceName={microphone?.label}
        isEnabled={isAudioEnabled}
        showLabel={true}
      />
      <DeviceIndicator
        icon={speaker ? Volume2 : VolumeX}
        label="Speaker"
        deviceName={speaker?.label}
        isEnabled={!!speaker}
        showLabel={true}
      />
    </fieldset>
  );
}
