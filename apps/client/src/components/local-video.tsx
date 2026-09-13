import { useVideoStream } from "@zvonok/react";
import { useRef } from "react";

import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/display-name";

interface Props {
  stream: MediaStream | null;
  username?: string;
  isVideoEnabled: boolean;
  className?: string;
}

export function LocalVideo({ stream, username, isVideoEnabled, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoStream(videoRef, stream);

  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-muted", className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ backgroundColor: "transparent" }}
        className="h-full w-full mirror object-cover"
      />

      {!isVideoEnabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted select-none">
          <div className="flex size-16 items-center justify-center rounded-full bg-gray-500 text-xl text-white">
            {getInitials(username ?? "")}
          </div>
        </div>
      )}
    </div>
  );
}
