import { CaptureState, isActive } from "@zvonok/client/media/capture-state";
import { useCallback, useEffect, useState } from "react";

import { useZvonokSession } from "@zvonok/react";

export interface UseMediaControlsReturn {
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  videoCaptureState: CaptureState;
  audioCaptureState: CaptureState;
  getVideoCaptureState: () => CaptureState;
  getAudioCaptureState: () => CaptureState;
  setVideoEnabled: (enabled: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
}

export function useMediaControls(): UseMediaControlsReturn {
  const mediaManager = useZvonokSession().mediaManager;
  const videoStateReader = mediaManager.videoCapture;
  const audioStateReader = mediaManager.audioCapture;

  const [isVideoEnabled, setIsVideoEnabled] = useState(() => isActive(videoStateReader.getState()));
  const [isAudioEnabled, setIsAudioEnabled] = useState(() => isActive(audioStateReader.getState()));
  const [videoCaptureState, setVideoCaptureState] = useState(() => videoStateReader.getState());
  const [audioCaptureState, setAudioCaptureState] = useState(() => audioStateReader.getState());

  useEffect(() => {
    const unsubVideo = videoStateReader.onStateChange((state) => {
      setVideoCaptureState(state);
      setIsVideoEnabled(isActive(state));
    });
    const unsubAudio = audioStateReader.onStateChange((state) => {
      setAudioCaptureState(state);
      setIsAudioEnabled(isActive(state));
    });
    return () => {
      unsubVideo();
      unsubAudio();
    };
  }, [videoStateReader, audioStateReader]);

  const getVideoCaptureState = useCallback(() => videoStateReader.getState(), [videoStateReader]);

  const getAudioCaptureState = useCallback(() => audioStateReader.getState(), [audioStateReader]);

  const setVideoEnabled = useCallback((enabled: boolean) => {
    setIsVideoEnabled(enabled);
  }, []);

  const setAudioEnabled = useCallback((enabled: boolean) => {
    setIsAudioEnabled(enabled);
  }, []);

  return {
    isVideoEnabled,
    isAudioEnabled,
    videoCaptureState,
    audioCaptureState,
    getVideoCaptureState,
    getAudioCaptureState,
    setVideoEnabled,
    setAudioEnabled,
  };
}
