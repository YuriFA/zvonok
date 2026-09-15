import { Video, Mic, Volume2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
export interface SingleDeviceSelectorProps {
  type: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onDeviceChange: (deviceId: string) => void;
  disabled?: boolean;
  className?: string;
}

const deviceConfig: Record<MediaDeviceKind, { label: string; icon: typeof Video }> = {
  videoinput: { label: "Camera", icon: Video },
  audioinput: { label: "Microphone", icon: Mic },
  audiooutput: { label: "Speaker", icon: Volume2 },
};

export function SingleDeviceSelector({
  type,
  devices,
  selectedDeviceId,
  onDeviceChange,
  disabled = false,
  className,
}: SingleDeviceSelectorProps) {
  const config = deviceConfig[type];
  const Icon = config.icon;
  const hasMultipleDevices = devices.length > 1;
  const hasNoDevices = devices.length === 0;

  // Single device: just show label, no dropdown needed
  if (!hasMultipleDevices) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label className="flex items-center gap-2">
          <Icon className="size-4" />
          {config.label}
        </Label>
        <div className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {hasNoDevices ? "No device available" : devices[0]?.label || "Unknown device"}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={`device-${type}`} className="flex items-center gap-2">
        <Icon className="size-4" />
        {config.label}
      </Label>
      <select
        id={`device-${type}`}
        value={selectedDeviceId || ""}
        onChange={(e) => onDeviceChange(e.target.value)}
        disabled={disabled || hasNoDevices}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
    </div>
  );
}
