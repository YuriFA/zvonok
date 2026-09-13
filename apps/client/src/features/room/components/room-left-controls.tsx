import { getCaptureStateDisplay } from "@zvonok/client/media/capture-state";
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
  const { mediaControls, mutedByHost: isMutedByHost } = useRoomSessionState();
  const { toggleVideo: onToggleVideo, toggleAudio: onToggleAudio } = useRoomSessionActions();
  const { isVideoEnabled, isAudioEnabled, videoCaptureState, audioCaptureState } = mediaControls;

  const videoDisplay = getCaptureStateDisplay(videoCaptureState, "video");
  const audioDisplay = isMutedByHost
    ? {
        tooltip: "Muted by host",
        status: "off" as const,
        statusText: null,
      }
    : getCaptureStateDisplay(audioCaptureState, "audio");

  return (
    <div className={cn("flex gap-2", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={isVideoEnabled ? buttonVariant : buttonInactiveVariant}
              className="relative"
              size="icon"
              onClick={onToggleVideo}
              aria-label={videoDisplay.tooltip}
            />
          }
        >
          {videoDisplay.status === "error" && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="destructive">
              <AlertTriangle className="size-3" />
            </Badge>
          )}
          {videoDisplay.status === "loading" && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="secondary">
              <Loader2 className="size-3 animate-spin" />
            </Badge>
          )}
          {isVideoEnabled ? <Video className="size-4" /> : <VideoOff className="size-4" />}
        </TooltipTrigger>
        <TooltipContent>{videoDisplay.tooltip}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={isAudioEnabled && !isMutedByHost ? buttonVariant : buttonInactiveVariant}
              className="relative"
              size="icon"
              onClick={onToggleAudio}
              aria-label={audioDisplay.tooltip}
            />
          }
        >
          {audioDisplay.status === "error" && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="destructive">
              <AlertTriangle className="size-3" />
            </Badge>
          )}
          {audioDisplay.status === "loading" && (
            <Badge className="absolute -top-2 -right-1 size-5" variant="secondary">
              <Loader2 className="size-3 animate-spin" />
            </Badge>
          )}
          {isMutedByHost ? (
            <MicOff className="size-4 text-red-500" />
          ) : isAudioEnabled ? (
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
