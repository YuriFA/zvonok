import { createLogger } from "../helpers/logger.js";
import { MediaCapture } from "./capture.js";
import { loadDevicePreferences } from "./device-preferences.js";
import type { IMediaDeviceService } from "./device-service.js";
import type { IErrorClassifier } from "./error-classifier.js";
import type { IMediaManager, IMediaCapture } from "./interfaces.js";
import type { StateCallback } from "./types.js";

export class MediaStreamManager implements IMediaManager {
  readonly videoCapture: IMediaCapture;
  readonly audioCapture: IMediaCapture;
  private readonly log = createLogger("media");
  private deviceService: IMediaDeviceService;

  constructor(deps: { deviceService: IMediaDeviceService; errorClassifier: IErrorClassifier }) {
    this.deviceService = deps.deviceService;
    this.videoCapture = new MediaCapture(deps.deviceService, "video", deps.errorClassifier);
    this.audioCapture = new MediaCapture(deps.deviceService, "audio", deps.errorClassifier);
  }

  getDeviceService(): IMediaDeviceService {
    return this.deviceService;
  }

  async start(options?: {
    video?: boolean;
    audio?: boolean;
    videoDeviceId?: string;
    audioDeviceId?: string;
  }): Promise<void> {
    const startVideo = options?.video ?? true;
    const startAudio = options?.audio ?? true;
    // Explicit ids win; otherwise fall back to the remembered devices.
    const prefs = loadDevicePreferences();
    const videoDeviceId = options?.videoDeviceId ?? prefs.video?.deviceId;
    const audioDeviceId = options?.audioDeviceId ?? prefs.audio?.deviceId;

    const promises: Promise<void>[] = [];

    if (startVideo) {
      promises.push(
        this.videoCapture
          .start(videoDeviceId)
          .then(() => {})
          .catch((e) => this.log.warn("Video capture start failed:", e)),
      );
    }
    if (startAudio) {
      promises.push(
        this.audioCapture
          .start(audioDeviceId)
          .then(() => {})
          .catch((e) => this.log.warn("Audio capture start failed:", e)),
      );
    }

    await Promise.all(promises);
  }

  stop(): void {
    this.videoCapture.stop();
    this.audioCapture.stop();
  }

  onVideoStateChange(cb: StateCallback): () => void {
    return this.videoCapture.onStateChange(cb);
  }

  onAudioStateChange(cb: StateCallback): () => void {
    return this.audioCapture.onStateChange(cb);
  }
}
