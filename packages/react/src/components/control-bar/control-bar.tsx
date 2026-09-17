/**
 * Control bar preset: mic, camera, screen share, optional recording, and
 * leave in one row - the prebuilt room's control strip. Runs the media
 * controls core internally; only the call (and optional extras) are wired.
 */

import {
  mapScreenShareError,
  type UseScreenShareResult,
  type UseZvonokCallResult,
} from "../../index.js";
import { useCallback } from "react";

import { MediaControlButton, useMediaControls } from "../media-controls/media-controls.js";

export interface ControlBarPresetProps {
  call: UseZvonokCallResult;
  screenShare?: UseScreenShareResult;
  record?: { isRecording: boolean; onToggle: () => void };
  onLeave: () => void;
  /** Failure notices from toggles and screen share. */
  onNotice?: (notice: { key: string; message: string }) => void;
  className?: string;
}

const COPY = {
  shareOn: "Share screen",
  shareOff: "Stop sharing",
  shareBlocked: "Another participant is already sharing their screen",
  shareUnsupported: "Screen share is not supported in this browser",
  shareDenied: "Screen share permission was denied",
  shareFailed: "Screen share was cancelled",
  recordStart: "Record",
  recordStop: "Stop recording",
  leave: "Leave",
  micRestartFailed: "Failed to restart the microphone",
  cameraRestartFailed: "Failed to restart the camera",
} as const;

function screenShareSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

export function ControlBarPreset({
  call,
  screenShare,
  record,
  onLeave,
  onNotice,
  className,
}: ControlBarPresetProps) {
  const controls = useMediaControls({
    camera: call.camera,
    microphone: call.microphone,
    mutedByHost: call.mutedByHost,
  });

  const handleToggleAudio = useCallback(() => {
    void controls.toggleAudio().then((outcome) => {
      if (outcome === "replace-failed") {
        onNotice?.({ key: "audio-restart-failed", message: COPY.micRestartFailed });
      }
    });
  }, [controls, onNotice]);

  const handleToggleVideo = useCallback(() => {
    void controls.toggleVideo().then((outcome) => {
      if (outcome === "replace-failed") {
        onNotice?.({ key: "video-restart-failed", message: COPY.cameraRestartFailed });
      }
    });
  }, [controls, onNotice]);

  const isSharing = screenShare?.sharing === true;
  const isBlocked = screenShare?.blocked === true;

  const handleToggleScreenShare = useCallback(() => {
    if (!screenShare) {
      return;
    }
    if (isSharing) {
      screenShare.stop();
      return;
    }
    void screenShare.start().catch((error: unknown) => {
      const message = mapScreenShareError(error, {
        blocked: COPY.shareBlocked,
        unsupported: COPY.shareUnsupported,
        denied: COPY.shareDenied,
        fallback: COPY.shareFailed,
      });
      if (message !== undefined) {
        onNotice?.({ key: "screen-share-failed", message });
      }
    });
  }, [screenShare, isSharing, onNotice]);

  return (
    <div className={["zk-controls", className].filter(Boolean).join(" ")}>
      <MediaControlButton
        state={controls.audio}
        labelOn="Mic"
        labelOff="Mic off"
        onClick={handleToggleAudio}
      />
      <MediaControlButton
        state={controls.video}
        labelOn="Camera"
        labelOff="Camera off"
        onClick={handleToggleVideo}
      />
      {screenShare &&
        (screenShareSupported() ? (
          <button
            type="button"
            className={isSharing ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={isSharing}
            disabled={!isSharing && isBlocked}
            title={isBlocked ? COPY.shareBlocked : undefined}
            onClick={handleToggleScreenShare}
          >
            {isSharing ? COPY.shareOff : COPY.shareOn}
          </button>
        ) : (
          <button
            type="button"
            className="zk-button zk-button-off"
            disabled
            title={COPY.shareUnsupported}
          >
            {COPY.shareOn}
          </button>
        ))}
      {record && (
        <button
          type="button"
          className={record.isRecording ? "zk-button" : "zk-button zk-button-off"}
          aria-pressed={record.isRecording}
          onClick={record.onToggle}
        >
          {record.isRecording ? COPY.recordStop : COPY.recordStart}
        </button>
      )}
      <button type="button" className="zk-button zk-button-leave" onClick={onLeave}>
        {COPY.leave}
      </button>
    </div>
  );
}
