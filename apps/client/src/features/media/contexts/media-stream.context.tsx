import { CaptureState } from "@zvonok/client/media/capture-state";
import { loadDeviceSelection, useZvonokSession } from "@zvonok/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { STORAGE_KEYS } from "@/lib/constants/storage-keys";

export interface MediaStreamContextValue {
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
  videoState: CaptureState;
  audioState: CaptureState;
  start: () => Promise<void>;
  stop: () => void;
  /** (Re)acquires the microphone and returns the fresh stream; null on failure. */
  ensureAudio: () => Promise<MediaStream | null>;
  /** (Re)acquires the camera and returns the fresh stream; null on failure. */
  ensureVideo: () => Promise<MediaStream | null>;
  /** Releases the camera capture track (hardware off); idempotent. */
  stopVideoCapture: () => Promise<boolean>;
  /** Releases the microphone capture track (hardware off); idempotent. */
  stopAudioCapture: () => Promise<boolean>;
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

  useEffect(() => {
    const unsubVideo = manager.onVideoStateChange((state) => {
      setVideoState(state);
      setVideoStream(manager.videoCapture.getStream());
    });
    const unsubAudio = manager.onAudioStateChange((state) => {
      setAudioState(state);
      setAudioStream(manager.audioCapture.getStream());
    });

    return () => {
      unsubVideo();
      unsubAudio();
    };
  }, [manager]);

  const start = useCallback(async () => {
    const saved = loadDeviceSelection(STORAGE_KEYS.SELECTED_DEVICES);
    await manager.start({
      video: true,
      audio: true,
      videoDeviceId: saved.videoDeviceId || undefined,
      audioDeviceId: saved.audioDeviceId || undefined,
    });
  }, [manager]);

  const ensureAudio = useCallback(async (): Promise<MediaStream | null> => {
    const saved = loadDeviceSelection(STORAGE_KEYS.SELECTED_DEVICES);
    const deviceId = saved.audioDeviceId || undefined;
    // A saved selection can go stale (device unplugged, driver update);
    // fall back to the default device instead of leaving the mic dead.
    const ok =
      (await manager.audioCapture.start(deviceId)) ||
      (deviceId !== undefined ? await manager.audioCapture.start() : false);
    const stream = ok ? manager.audioCapture.getStream() : null;
    setAudioStream(stream);
    return stream;
  }, [manager]);

  const ensureVideo = useCallback(async (): Promise<MediaStream | null> => {
    const saved = loadDeviceSelection(STORAGE_KEYS.SELECTED_DEVICES);
    const deviceId = saved.videoDeviceId || undefined;
    const ok =
      (await manager.videoCapture.start(deviceId)) ||
      (deviceId !== undefined ? await manager.videoCapture.start() : false);
    const stream = ok ? manager.videoCapture.getStream() : null;
    setVideoStream(stream);
    return stream;
  }, [manager]);

  const stop = useCallback(() => {
    manager.stop();
  }, [manager]);

  const stopVideoCapture = useCallback(() => manager.videoCapture.toggle(false), [manager]);
  const stopAudioCapture = useCallback(() => manager.audioCapture.toggle(false), [manager]);

  useEffect(() => {
    void start();
    return () => {
      manager.stop();
    };
  }, [start, manager]);

  return (
    <MediaStreamContext.Provider
      value={{
        videoStream,
        audioStream,
        videoState,
        audioState,
        start,
        stop,
        ensureAudio,
        ensureVideo,
        stopVideoCapture,
        stopAudioCapture,
      }}
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
