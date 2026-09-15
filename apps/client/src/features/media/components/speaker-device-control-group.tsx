import { Check, ChevronDown, Volume2 } from "lucide-react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onDeviceChange: (deviceId: string) => void;
}

export const SpeakerDeviceControlGroup = ({ devices, selectedDeviceId, onDeviceChange }: Props) => {
  const hasDevices = devices.length > 0;

  const handleDeviceSelect = useCallback(
    (deviceId: string) => {
      if (deviceId !== selectedDeviceId) {
        onDeviceChange(deviceId);
      }
    },
    [onDeviceChange, selectedDeviceId],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasDevices}
            className="gap-2"
          />
        }
      >
        <Volume2 className="size-5" />
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="center" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Speaker</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {devices.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No devices available</div>
          ) : (
            devices.map((device) => (
              <DropdownMenuItem
                key={device.deviceId}
                onClick={() => handleDeviceSelect(device.deviceId)}
              >
                <span className="flex-1 truncate">{device.label}</span>
                {device.deviceId === selectedDeviceId && <Check className="size-4" />}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
