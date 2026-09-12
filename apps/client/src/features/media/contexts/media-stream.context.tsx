import { CaptureState } from "@zvonok/client/media/capture-state";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { loadSelectedDevices } from "@/features/media/hooks/use-media-devices";

import { useZvonokSession } from "@zvonok/react";

export interface MediaStreamContextValue {
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
  videoState: CaptureState;
  audioState: CaptureState;
  start: () => Promise<void>;
  stop: () => void;
}

const MediaStreamContext = createContext<MediaStreamContextValue | null>(null);

export interface MediaStreamProviderProps {
  children: ReactNode;
}

export function MediaStreamProvider({ children }: MediaStreamProviderProps) {
  const manager = useZvonokSession().mediaManager;
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [videoState, setVideoState] = useState<CaptureState>(CaptureState.STOPPED);
  const [audioState, setAudioState] = useState<CaptureState>(CaptureState.STOPPED);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unsubVideo = manager.onVideoStateChange((state) => {
      if (mountedRef.current) {
        setVideoState(state);
        setVideoStream(manager.videoCapture.getStream());
      }
    });
    const unsubAudio = manager.onAudioStateChange((state) => {
      if (mountedRef.current) {
        setAudioState(state);
        setAudioStream(manager.audioCapture.getStream());
      }
    });

    return () => {
      unsubVideo();
      unsubAudio();
    };
  }, [manager]);

  const start = useCallback(async () => {
    const saved = loadSelectedDevices();
    await manager.start({
      video: true,
      audio: true,
      videoDeviceId: saved.videoDeviceId || undefined,
      audioDeviceId: saved.audioDeviceId || undefined,
    });
  }, [manager]);

  const stop = useCallback(() => {
    manager.stop();
  }, [manager]);

  useEffect(() => {
    if (!mountedRef.current) return;
    start();
    return () => {
      manager.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MediaStreamContext.Provider
      value={{ videoStream, audioStream, videoState, audioState, start, stop }}
    >
      {children}
    </MediaStreamContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMediaStreamContext(): MediaStreamContextValue {
  const ctx = useContext(MediaStreamContext);
  if (!ctx) {
    throw new Error("useMediaStreamContext must be used within a MediaStreamProvider");
  }
  return ctx;
}
