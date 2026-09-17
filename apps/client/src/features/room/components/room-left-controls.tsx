import { CaptureState } from "@zvonok/client/media/capture-state";
import { deriveMediaControlState } from "@zvonok/react";
import { AlertTriangle, Loader2, Mic, MicOff, Video, VideoOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useRoomSessionActions, useRoomSessionState } from "../contexts/room-session.context";

interface Props {
  className?: string;
  buttonVariant?: ButtonProps["variant"];
  buttonInactiveVariant?: ButtonProps["variant"];
}

export const RoomLeftControls = ({
  className,
  buttonVariant = "outline",
  buttonInactiveVariant = "secondary",
}: Props) => {
  const { camera, microphone, mutedByHost: isMutedByHost } = useRoomSessionState();
  const { toggleVideo: onToggleVideo, toggleAudio: onToggleAudio } = useRoomSessionActions();

  const video = deriveMediaControlState({
    isEnabled: camera.isEnabled,
    captureState: camera.captureState ?? CaptureState.STOPPED,
    kind: "video",
  });
  const audio = deriveMediaControlState({
    isEnabled: microphone.isEnabled,
    captureState: microphone.captureState ?? CaptureState.STOPPED,
    kind: "audio",
    isMutedByHost,
  });
  // Host mute overrides the capture-state vocabulary for audio.
  const audioDisplay = isMutedByHost
    ? { tooltip: "Muted by host", status: "off" as const, statusText: null }
    : audio.display;

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
