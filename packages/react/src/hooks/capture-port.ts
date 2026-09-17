/**
 * The capture seam of the call session: where local camera and microphone
 * tracks come from. The default adapter drives the provider's shared media
 * manager, honoring the persisted device selection; embedders substitute
 * their own acquisition by passing a port to useZvonokCall.
 */

import type { CaptureState } from "@zvonok/client/media/capture-state";
import type { IMediaManager } from "@zvonok/client/media/interfaces";

import { loadDeviceSelection } from "./use-device-controls.js";
import type { PublishKind } from "./use-publish-controls.js";

export interface CapturePort {
  /** The kind's current track from the captured stream, if any. */
  getTrack(kind: PublishKind): MediaStreamTrack | null | undefined;
  /**
   * Re-acquires capture when no live track exists (camera or mic was off in
   * the lobby, or the device was lost). Returns the fresh stream.
   */
  ensureTrack?(
    kind: PublishKind,
  ): MediaStream | null | undefined | Promise<MediaStream | null | undefined>;
  /** Runs after a successful pause; releases the kind's capture hardware. */
  release?(kind: PublishKind): unknown;
  /** The kind's captured stream, for consumers rendering local previews. */
  getStream?(kind: PublishKind): MediaStream | null | undefined;
  /**
   * Capture lifecycle notifications, so controls stay truthful when capture
   * changes outside a toggle (device loss, another surface starting capture).
   * Without it, capture-driven state changes are not observed.
   */
  onStateChange?(kind: PublishKind, listener: (state: CaptureState) => void): () => void;
}

export interface MediaCapturePortOptions {
  /**
   * localStorage key for the explicit device selection. Hosts with
   * pre-existing stored selections pass their legacy key to keep user data
   * continuous.
   */
  storageKey?: string;
}

/** Default adapter over the provider's shared media manager. */
export function createMediaCapturePort(
  manager: IMediaManager,
  options: MediaCapturePortOptions = {},
): CapturePort {
  const storageKey = options.storageKey;

  const captureFor = (kind: PublishKind) =>
    kind === "video" ? manager.videoCapture : manager.audioCapture;

  return {
    getTrack: (kind) => captureFor(kind).getTrack(),
    getStream: (kind) => captureFor(kind).getStream(),
    onStateChange: (kind, listener) => captureFor(kind).onStateChange((state) => listener(state)),
    async ensureTrack(kind) {
      const capture = captureFor(kind);
      // A live track means capture is already up; restarting would flap the
      // hardware and drop the device mid-call.
      const live = capture.getTrack();
      if (live && live.readyState === "live") {
        return capture.getStream();
      }
      const saved = loadDeviceSelection(storageKey);
      const deviceId = (kind === "video" ? saved.videoDeviceId : saved.audioDeviceId) || undefined;
      const ok = await capture.start(deviceId);
      return ok ? capture.getStream() : null;
    },
    release: (kind) => captureFor(kind).toggle(false),
  };
}
