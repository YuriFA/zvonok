import { Loader2, Monitor, MonitorOff, PhoneOff } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  isScreenSharing: boolean;
  isScreenShareSupported: boolean;
  isScreenShareBlocked: boolean;
  screenShareState: "idle" | "starting" | "sharing";
  onToggleScreenShare: () => Promise<void>;
  className?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonInactiveVariant?: ButtonProps["variant"];
}

export function RoomCenterControls({
  buttonVariant = "outline",
  buttonInactiveVariant = "secondary",
  isScreenSharing,
  isScreenShareSupported,
  isScreenShareBlocked,
  screenShareState,
  onToggleScreenShare,
  className,
}: Props) {
  const screenShareTooltip = isScreenSharing
    ? "Stop screen share"
    : isScreenShareBlocked
      ? "Another participant is sharing their screen"
      : "Share screen";
  const isScreenShareLoading = screenShareState === "starting";
  const isScreenShareDisabled = isScreenShareLoading || (isScreenShareBlocked && !isScreenSharing);

  return (
    <div className={cn("flex gap-2", className)}>
      {isScreenShareSupported && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={isScreenSharing ? buttonInactiveVariant : buttonVariant}
                className="relative"
                size="icon"
                onClick={() => void onToggleScreenShare()}
                disabled={isScreenShareDisabled}
                aria-label={screenShareTooltip}
                aria-pressed={isScreenSharing}
              />
            }
          >
            {isScreenShareLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isScreenSharing ? (
              <MonitorOff className="size-4" />
            ) : (
              <Monitor className="size-4" />
            )}
          </TooltipTrigger>
          <TooltipContent>{screenShareTooltip}</TooltipContent>
        </Tooltip>
      )}
      <LinkButton to="/" variant="destructive" size="icon" aria-label="Leave room">
        <PhoneOff className="size-4" />
      </LinkButton>
    </div>
  );
}
