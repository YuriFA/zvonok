import { DEFAULT_AUDIO_CONSTRAINTS, DEFAULT_VIDEO_CONSTRAINTS } from "../config/media.js";
import { CaptureState } from "./capture-state.js";
import { rememberAudioMuted, rememberDevice } from "./device-preferences.js";
import type { IMediaDeviceService } from "./device-service.js";
import type { IErrorClassifier } from "./error-classifier.js";
import type { IMediaCapture } from "./interfaces.js";
import type { StateCallback } from "./types.js";

/** True when a capture failed because the requested device is not present. */
function isDeviceMissing(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "OverconstrainedError")
  );
}

export class MediaCapture implements IMediaCapture {
  private state: CaptureState = CaptureState.STOPPED;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private deviceId: string | null = null;
  private currentRequestId = 0;
  private pendingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private stateCallbacks = new Set<StateCallback>();
  private deviceService: IMediaDeviceService;
  private errorClassifier: IErrorClassifier;
  private kind: "video" | "audio";

  constructor(
    deviceService: IMediaDeviceService,
    kind: "video" | "audio",
    errorClassifier: IErrorClassifier,
  ) {
    this.deviceService = deviceService;
    this.kind = kind;
    this.errorClassifier = errorClassifier;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getState(): CaptureState {
    return this.state;
  }

  getTrack(): MediaStreamTrack | null {
    return this.track;
  }

  onStateChange(cb: StateCallback): () => void {
    this.stateCallbacks.add(cb);
    cb(this.state, this.track);
    return () => {
      this.stateCallbacks.delete(cb);
    };
  }

  async start(deviceId?: string): Promise<boolean> {
    const requestId = ++this.currentRequestId;
    this.cancelPendingRetry();
    this.setState(CaptureState.STARTING);

    try {
      const constraints = this.buildConstraints(deviceId);
      const stream = await this.deviceService.getUserMedia(constraints);

      if (requestId !== this.currentRequestId) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }

      const track = stream.getTracks().find((t) => t.kind === this.kind) ?? null;

      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        this.setState(CaptureState.NO_DEVICE);
        return false;
      }

      this.stopCurrentStream();
      this.stream = stream;
      this.track = track;
      this.deviceId = track.getSettings().deviceId ?? deviceId ?? null;

      if (this.deviceId) {
        rememberDevice(this.kind, this.deviceId);
      }

      track.addEventListener("ended", () => {
        if (requestId === this.currentRequestId) {
          this.deviceId = null;
          this.setState(CaptureState.DEVICE_NOT_FOUND);
        }
      });

      this.setState(CaptureState.ACTIVE);
      return true;
    } catch (error) {
      // A remembered device may have vanished since the last session: retry
      // once with the browser default before surfacing an error.
      if (deviceId && isDeviceMissing(error)) {
        return this.start();
      }

      if (requestId !== this.currentRequestId) return false;

      const classification = this.errorClassifier.classify(error, this.kind);
      this.setState(classification.state, classification.reason);

      if (classification.state === CaptureState.DEVICE_IN_USE) {
        this.handleNotReadableError();
      }

      return false;
    }
  }

  stop(): void {
    ++this.currentRequestId;
    this.cancelPendingRetry();
    this.stopCurrentStream();
    this.setState(CaptureState.STOPPED);
  }

  async switchDevice(deviceId: string): Promise<boolean> {
    this.cancelPendingRetry();
    this.stopCurrentStream();
    return this.start(deviceId);
  }

  async toggle(enabled: boolean): Promise<boolean> {
    if (this.kind === "audio") {
      rememberAudioMuted(!enabled);
    }
    if (!enabled) {
      this.stop();
      return true;
    }
    return this.start();
  }

  private setState(state: CaptureState, reason?: string): void {
    this.state = state;
    this.stateCallbacks.forEach((cb) => cb(state, this.track, reason));
  }

  private stopCurrentStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.track = null;
  }

  private cancelPendingRetry(): void {
    if (this.pendingRetryTimer) {
      clearTimeout(this.pendingRetryTimer);
      this.pendingRetryTimer = null;
    }
  }

  private handleNotReadableError(): void {
    if (this.pendingRetryTimer) return;

    this.pendingRetryTimer = setTimeout(async () => {
      this.pendingRetryTimer = null;
      try {
        await this.start(this.deviceId ?? undefined);
      } catch {
        // Error already handled by start()
      }
    }, 2000);
  }

  private buildConstraints(deviceId?: string): MediaStreamConstraints {
    if (this.kind === "video") {
      return deviceId
        ? { video: { ...DEFAULT_VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } }, audio: false }
        : { video: DEFAULT_VIDEO_CONSTRAINTS, audio: false };
    }

    return deviceId
      ? { audio: { ...DEFAULT_AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } } }
      : { audio: DEFAULT_AUDIO_CONSTRAINTS };
  }
}
