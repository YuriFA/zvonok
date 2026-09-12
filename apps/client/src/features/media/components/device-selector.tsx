import { CaptureState } from "@zvonok/client/media/capture-state";
import { AlertTriangleIcon, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useCallback, useState } from "react";

import { LocalVideo } from "@/components/local-video";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

import { useZvonokSession } from "@zvonok/react";
import { useMediaStreamContext } from "../contexts/media-stream.context";
import { useDeviceSwitching } from "../hooks/use-device-switching";
import { useMediaControls } from "../hooks/use-media-controls";
import { useMediaDevices } from "../hooks/use-media-devices";
import { DeviceControlGroup } from "./device-control-group";
import { PermissionRequestModal } from "./permission-request-modal";
import { SpeakerDeviceControlGroup } from "./speaker-device-control-group";

interface DeviceSelectorProps {
  className?: string;
  username?: string;
}

const isPermissionDenied = (state: CaptureState) =>
  state === CaptureState.SYSTEM_DENIED ||
  state === CaptureState.DEVICE_NOT_FOUND ||
  state === CaptureState.CAPTURE_CANCELED;

export function DeviceSelector({ className, username }: DeviceSelectorProps) {
  const { videoStream, videoState, audioState } = useMediaStreamContext();
  const mediaControls = useMediaControls();

  const mediaManager = useZvonokSession().mediaManager;
  const videoControl = mediaManager.videoCapture;
  const audioControl = mediaManager.audioCapture;

  const {
    videoDevices,
    audioDevices,
    speakerDevices,
    selectedDevices,
    setSelectedVideoDevice,
    setSelectedAudioDevice,
    setSelectedSpeakerDevice,
  } = useMediaDevices();

  const { switchVideoDevice, switchAudioDevice } = useDeviceSwitching();

  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [deniedDevices, setDeniedDevices] = useState({ camera: false, microphone: false });

  const handleToggleVideo = useCallback(async () => {
    const nextEnabled = !mediaControls.isVideoEnabled;
    mediaControls.setVideoEnabled(nextEnabled);
    const success = await videoControl.toggle(nextEnabled);
    if (!success) {
      mediaControls.setVideoEnabled(false);
      if (isPermissionDenied(mediaControls.getVideoCaptureState())) {
        setDeniedDevices((prev) => ({ ...prev, camera: true }));
        setPermissionModalOpen(true);
      }
    }
  }, [videoControl, mediaControls]);

  const handleToggleAudio = useCallback(async () => {
    const nextEnabled = !mediaControls.isAudioEnabled;
    mediaControls.setAudioEnabled(nextEnabled);
    const success = await audioControl.toggle(nextEnabled);
    if (!success) {
      mediaControls.setAudioEnabled(false);
      if (isPermissionDenied(mediaControls.getAudioCaptureState())) {
        setDeniedDevices((prev) => ({ ...prev, microphone: true }));
        setPermissionModalOpen(true);
      }
    }
  }, [audioControl, mediaControls]);

  const handleModalOpenChange = useCallback((open: boolean) => {
    setPermissionModalOpen(open);
    if (!open) {
      setDeniedDevices({ camera: false, microphone: false });
    }
  }, []);

  const handleVideoDeviceChange = useCallback(
    async (deviceId: string) => {
      const success = await switchVideoDevice(deviceId);
      if (success) {
        setSelectedVideoDevice(deviceId);
      }
    },
    [switchVideoDevice, setSelectedVideoDevice],
  );

  const handleAudioDeviceChange = useCallback(
    async (deviceId: string) => {
      const success = await switchAudioDevice(deviceId);
      if (success) {
        setSelectedAudioDevice(deviceId);
      }
    },
    [switchAudioDevice, setSelectedAudioDevice],
  );

  const handleSpeakerDeviceChange = useCallback(
    (deviceId: string) => {
      setSelectedSpeakerDevice(deviceId);
    },
    [setSelectedSpeakerDevice],
  );

  const isVideoLoading = videoState === CaptureState.STARTING;
  const isAudioLoading = audioState === CaptureState.STARTING;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {isVideoLoading && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading camera...</p>
          </div>
        )}
        {!isVideoLoading && (
          <LocalVideo
            stream={videoStream}
            username={username}
            isVideoEnabled={mediaControls.isVideoEnabled}
            className="h-full"
          />
        )}
      </div>

      {videoDevices.length === 0 && !isVideoLoading && (
        <Alert className="order-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangleIcon />
          <AlertTitle>No camera found</AlertTitle>
        </Alert>
      )}

      {audioDevices.length === 0 && !isAudioLoading && (
        <Alert className="order-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangleIcon />
          <AlertTitle>No microphone found</AlertTitle>
        </Alert>
      )}

      <div className="flex items-center justify-center gap-2">
        {"setSinkId" in HTMLMediaElement.prototype && (
          <SpeakerDeviceControlGroup
            devices={speakerDevices}
            selectedDeviceId={selectedDevices.speakerDeviceId}
            onDeviceChange={handleSpeakerDeviceChange}
          />
        )}

        <DeviceControlGroup
          label="Microphone"
          captureState={audioState}
          onIcon={<Mic className="size-5" />}
          offIcon={<MicOff className="size-5" />}
          onToggle={handleToggleAudio}
          devices={audioDevices}
          selectedDeviceId={selectedDevices.audioDeviceId}
          onDeviceChange={handleAudioDeviceChange}
        />

        <DeviceControlGroup
          label="Camera"
          onIcon={<Video className="size-5" />}
          offIcon={<VideoOff className="size-5" />}
          captureState={videoState}
          onToggle={handleToggleVideo}
          devices={videoDevices}
          selectedDeviceId={selectedDevices.videoDeviceId}
          onDeviceChange={handleVideoDeviceChange}
        />
      </div>

      <PermissionRequestModal
        open={permissionModalOpen}
        onOpenChange={handleModalOpenChange}
        deniedDevices={deniedDevices}
      />
    </div>
  );
}
