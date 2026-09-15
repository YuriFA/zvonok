import { CaptureState, canToggle, isActive } from "@zvonok/client/media/capture-state";
import { ChevronDown, Check } from "lucide-react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";

export interface DeviceControlGroupProps {
  captureState?: CaptureState;
  onToggle?: () => void;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onDeviceChange: (deviceId: string) => void;
  isSwitching?: boolean;
  label?: string;
  offIcon?: React.ReactNode;
  onIcon?: React.ReactNode;
}

export function DeviceControlGroup({
  captureState = CaptureState.STOPPED,
  onToggle,
  devices,
  selectedDeviceId,
  onDeviceChange,
  isSwitching = false,
  offIcon,
  onIcon,
  label,
}: DeviceControlGroupProps) {
  const hasDevices = devices.length > 0;
  const toggleEnabled = canToggle(captureState) && hasDevices;
  const dropdownEnabled = captureState === CaptureState.ACTIVE && hasDevices && !isSwitching;

  const handleDeviceSelect = useCallback(
    (deviceId: string) => {
      if (deviceId !== selectedDeviceId) {
        onDeviceChange(deviceId);
      }
    },
    [onDeviceChange, selectedDeviceId],
  );

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onToggle}
        disabled={!toggleEnabled && captureState !== CaptureState.CAPTURE_CANCELED}
      >
        {isActive(captureState) ? onIcon : offIcon}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!dropdownEnabled}
              title={`Select ${label}`}
            />
          }
        >
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="center" className="min-w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
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
    </ButtonGroup>
  );
}
