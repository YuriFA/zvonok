import { useMediaControls } from "@zvonok/react/prebuilt";
import { AlertTriangle, Loader2, Mic, MicOff, Video, VideoOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useRoomSession, useRoomToggles } from "../contexts/room-session.context";

interface Props {
  className?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonInactiveVariant?: ButtonProps["variant"];
}

/**
 * App markup over the package media-control core: the core owns the derived
 * control states (including the host-mute override) and toggle outcomes,
 * this component owns icons, tooltips, and the design system.
 */
export const RoomLeftControls = ({
  className,
  buttonVariant = "outline",
  buttonInactiveVariant = "secondary",
}: Props) => {
  const call = useRoomSession();
  const { mutedByHost: isMutedByHost } = call;
  const { toggleVideo: onToggleVideo, toggleAudio: onToggleAudio } = useRoomToggles();
  const { video, audio } = useMediaControls({
    camera: call.camera,
    microphone: call.microphone,
    mutedByHost: isMutedByHost,
  });

  const audioDisplay = audio.display;

  return (
    <div className={cn("flex gap-2", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={video.isOn ? buttonVariant : buttonInactiveVariant}
              className="relative"
              size="icon"
              onClick={onToggleVideo}
              aria-label={video.display.tooltip}
            />
          }
        >
          {video.hasError && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="destructive">
              <AlertTriangle className="size-3" />
            </Badge>
          )}
          {video.isLoading && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="secondary">
              <Loader2 className="size-3 animate-spin" />
            </Badge>
          )}
          {video.isOn ? <Video className="size-4" /> : <VideoOff className="size-4" />}
        </TooltipTrigger>
        <TooltipContent>{video.display.tooltip}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={audio.isOn ? buttonVariant : buttonInactiveVariant}
              className="relative"
              size="icon"
              onClick={onToggleAudio}
              aria-label={audioDisplay.tooltip}
            />
          }
        >
          {audio.hasError && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="destructive">
              <AlertTriangle className="size-3" />
            </Badge>
          )}
          {audio.isLoading && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="secondary">
              <Loader2 className="size-3 animate-spin" />
            </Badge>
          )}
          {audio.isForcedOff ? (
            <MicOff className="size-4 text-red-500" />
          ) : audio.isOn ? (
            <Mic className="size-4" />
          ) : (
            <MicOff className="size-4" />
          )}
        </TooltipTrigger>
        <TooltipContent>{audioDisplay.tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
};
