import type { CaptureState } from "./capture-state.js";
import type { StateCallback } from "./types.js";

export interface IMediaCapture {
  getStream(): MediaStream | null;
  getState(): CaptureState;
  getTrack(): MediaStreamTrack | null;
  onStateChange(cb: StateCallback): () => void;
  start(deviceId?: string): Promise<boolean>;
  stop(): void;
  switchDevice(deviceId: string): Promise<boolean>;
  toggle(enabled: boolean): Promise<boolean>;
}

export interface IMediaDeviceService {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  queryPermission(kind: "video" | "audio"): Promise<PermissionStatus>;
}

export interface IErrorClassifier {
  classify(
    error: unknown,
    kind: "video" | "audio",
  ): {
    state: CaptureState;
    recoverable: boolean;
    reason: string;
  };
}

export interface IMediaManager {
  readonly videoCapture: IMediaCapture;
  readonly audioCapture: IMediaCapture;
  getDeviceService(): IMediaDeviceService;
  start(options?: {
    video?: boolean;
    audio?: boolean;
    videoDeviceId?: string;
    audioDeviceId?: string;
  }): Promise<void>;
  stop(): void;
  onVideoStateChange(cb: StateCallback): () => void;
  onAudioStateChange(cb: StateCallback): () => void;
}
