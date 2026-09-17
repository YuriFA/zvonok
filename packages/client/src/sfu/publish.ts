/**
 * Publish unit of the SFU manager: local track production. Owns the
 * producers map, the buffered local produces that arrive before the send
 * transport exists, the pending server produce handshakes, the per-kind
 * replace locks, and the produce intents retained across a reconnect
 * blip, plus the produce-error and producer-state callback registries.
 * The mediasoup device and the send transport stay with the manager
 * facade (transport creation is driven by the join flow and shared with
 * the subscribe side) and are reached through the narrow host interface
 * below.
 */

import type { Socket } from "socket.io-client";
import type {
  Producer,
  RtpEncodingParameters,
  Transport,
} from "mediasoup-client/types";
import { singleFlight, withoutConcurrency } from "../helpers/concurrency.js";
import { createLogger } from "../helpers/logger.js";
import type {
  SfuMediaSource,
  SfuProducerCreatedPayload,
  SfuProducerStateCallback,
  SfuProducerStateChangedPayload,
  SfuProduceErrorCode,
  SfuState,
} from "./types.js";
import { SfuProduceError } from "./types.js";

/**
 * Simulcast encoding layers sent to the SFU for video producers.
 * Mirrors SIMULCAST_ENCODINGS in apps/server/src/sfu/config/mediasoup.config.ts.
 */
const SIMULCAST_ENCODINGS: RtpEncodingParameters[] = [
  {
    rid: "low",
    maxBitrate: 150_000,
    scaleResolutionDownBy: 4,
    maxFramerate: 15,
  },
  {
    rid: "mid",
    maxBitrate: 500_000,
    scaleResolutionDownBy: 2,
    maxFramerate: 24,
  },
  { rid: "high", maxBitrate: 2_000_000 },
];

/**
 * Mobile senders cap the encoded frame rate and the top-layer bitrate:
 * the camera still captures at its native rate, but the encoder and the
 * radio - the two dominant battery costs of publishing - shed most of
 * the work. Publishing without the mobile hint is unchanged.
 */
const MOBILE_SIMULCAST_ENCODINGS: RtpEncodingParameters[] = [
  {
    rid: "low",
    maxBitrate: 150_000,
    scaleResolutionDownBy: 4,
    maxFramerate: 15,
  },
  {
    rid: "mid",
    maxBitrate: 400_000,
    scaleResolutionDownBy: 2,
    maxFramerate: 15,
  },
  { rid: "high", maxBitrate: 900_000, maxFramerate: 15 },
];

/** How the unit reaches the socket, the send transport, and shared state. */
export interface SfuPublishHost {
  getSocket(): Socket | null;
  isConnected(): boolean;
  getSendTransport(): Transport | null;
  updateState(partial: Partial<SfuState>): void;
}

export class SfuPublish {
  private readonly log = createLogger("sfu");
  private readonly host: SfuPublishHost;
  private producers = new Map<string, Producer>();
  // Serialized replaceTrack chains per media kind (see withoutConcurrency).
  private readonly locks = new Map<string, Promise<unknown>>();
  private producingInProgress = new Map<string, Promise<Producer | null>>();
  private pendingProduceRequests = new Map<
    string,
    {
      resolve: (id: string) => void;
      reject: (error: Error) => void;
      source: SfuMediaSource;
    }
  >();
  // Local produce calls that arrived before the send transport existed
  // (device still loading after join). Flushed when the transport is ready.
  private pendingLocalProduces: Array<{
    track: MediaStreamTrack;
    source?: SfuMediaSource;
    options: { isMobile?: boolean };
    resolve: (producer: Producer | null) => void;
    reject: (error: Error) => void;
  }> = [];
  /** Live local tracks + produce intents held across a reconnect blip. */
  private retainedLocalProduces: Array<{
    track: MediaStreamTrack;
    source?: SfuMediaSource;
    options: { isMobile?: boolean };
  }> = [];
  private produceErrorCallbacks = new Set<
    (code: SfuProduceErrorCode) => void
  >();
  private producerStateCallbacks = new Set<SfuProducerStateCallback>();

  constructor(host: SfuPublishHost) {
    this.host = host;
  }

  // ISfuProducerManager
  async produce(
    track: MediaStreamTrack,
    { isMobile }: { isMobile?: boolean } = {},
  ): Promise<Producer | null> {
    return this.produceWithSource(
      track,
      track.kind === "video" ? "camera" : undefined,
      {
        isMobile,
      },
    );
  }

  async produceScreen(track: MediaStreamTrack): Promise<Producer | null> {
    return this.produceWithSource(track, "screen");
  }

  private async produceWithSource(
    track: MediaStreamTrack,
    source?: SfuMediaSource,
    { isMobile }: { isMobile?: boolean } = {},
  ): Promise<Producer | null> {
    const sendTransport = this.host.getSendTransport();
    if (!sendTransport) {
      // The join flow loads the device and creates transports asynchronously;
      // early produce calls (camera/mic right after join) are buffered and
      // flushed once the send transport exists instead of being dropped.
      if (!this.host.isConnected()) {
        this.log.error("[SFU] Send transport not ready and not connected");
        return null;
      }
      if (this.pendingLocalProduces.length >= 8) {
        this.log.warn("[SFU] Local produce queue full, dropping request");
        return null;
      }
      if (track.readyState === "ended") {
        this.log.warn("[SFU] Not queueing produce for an ended track");
        return null;
      }
      this.log.debug("[SFU] Send transport not ready yet, buffering produce for:",
      track.kind,);
      return new Promise<Producer | null>((resolve, reject) => {
        this.pendingLocalProduces.push({
          track,
          source,
          options: { isMobile },
          resolve,
          reject,
        });
      });
    }

    const kind = track.kind as "audio" | "video";
    const dedupeKey = source === "screen" ? "screen" : kind;

    if (source !== "screen") {
      const existing = this.getProducerByKind(kind);
      if (existing) {
        this.log.warn("[SFU] Producer already exists for kind:", kind);
        return existing;
      }
    } else {
      const existing = this.getScreenProducer();
      if (existing) {
        this.log.warn("[SFU] Screen producer already exists");
        return existing;
      }
    }

    return singleFlight(this.producingInProgress, dedupeKey, () =>
      this.doProduceTrack(track, source, { isMobile }),
    );
  }

  private async doProduceTrack(
    track: MediaStreamTrack,
    source?: SfuMediaSource,
    { isMobile }: { isMobile?: boolean } = {},
  ): Promise<Producer | null> {
    const sendTransport = this.host.getSendTransport();
    if (!sendTransport) return null;

    try {
      const isVideo = track.kind === "video";
      const isScreen = source === "screen";
      const producer = await sendTransport.produce({
        track,
        // Tracks are caller-owned: teardown (including a reconnect blip)
        // must never stop the capture, so retained tracks replay on rejoin.
        stopTracks: false,
        encodings:
          isVideo && !isScreen
            ? isMobile
              ? MOBILE_SIMULCAST_ENCODINGS
              : SIMULCAST_ENCODINGS
            : undefined,
        codecOptions: isVideo
          ? { videoGoogleStartBitrate: 1000 }
          : {
              opusStereo: true,
              opusFec: true,

              ...(isMobile && {
                // Optional mobile-friendly bitrate settings:
                opusDtx: true, // Stops sending packets during silence
                opusStereoDtx: true,
                opusBitrate: 32000, // 32 kbps is a great sweet spot for mobile
              }),
            },
        appData: { source: source ?? (isVideo ? "camera" : undefined) },
      });

      this.producers.set(producer.id, producer);
      this.log.debug("[SFU] Produced track:",
      track.kind,
      producer.id,
      source ?? "",);

      producer.on("transportclose", () => {
        this.producers.delete(producer.id);
      });

      return producer;
    } catch (error) {
      this.log.error("[SFU] Failed to produce track:", error);
      // Re-throw structured produce errors so callers can inspect the code.
      // For all other errors, return null to preserve existing behaviour.
      if (error instanceof SfuProduceError) {
        throw error;
      }
      return null;
    }
  }

  /**
   * Flushes produce calls that arrived before the transport existed.
   * mediasoup-client waits for the transport "connect" handshake, so
   * producing now is safe even before DTLS completes.
   */
  flushPendingProduces(): void {
    if (this.pendingLocalProduces.length > 0) {
      const pending = this.pendingLocalProduces.splice(0);
      this.log.debug("[SFU] Flushing",
      pending.length,
      "buffered local produce(s)",);
      for (const entry of pending) {
        this.produceWithSource(entry.track, entry.source, entry.options).then(
          entry.resolve,
          entry.reject,
        );
      }
    }
  }

  /**
   * Registers a pending server produce handshake for the transport's
   * "produce" request; settled by the producer-created ack or a produce
   * error.
   */
  createProduceRequest(
    requestId: string,
    source: SfuMediaSource,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.pendingProduceRequests.set(requestId, {
        resolve,
        reject,
        source,
      });
    });
  }

  closeScreenProducer(): void {
    const producer = this.getScreenProducer();
    if (!producer) return;

    producer.close();
    this.producers.delete(producer.id);
    this.host
      .getSocket()
      ?.emit("sfu:close-producer", { producerId: producer.id });
    this.host.updateState({ screenProducerId: null });
  }

  onProduceError(callback: (code: SfuProduceErrorCode) => void): () => void {
    this.produceErrorCallbacks.add(callback);
    return () => this.produceErrorCallbacks.delete(callback);
  }

  private getScreenProducer(): Producer | undefined {
    for (const producer of this.producers.values()) {
      if (
        producer.kind === "video" &&
        (producer.appData as Record<string, unknown> | undefined)?.source ===
          "screen"
      ) {
        return producer;
      }
    }
    return undefined;
  }

  pauseProducer(producerId: string): void {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.pause();
      this.host.getSocket()?.emit("sfu:pause-producer", { producerId });
    }
  }

  resumeProducer(producerId: string): void {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.resume();
      this.host.getSocket()?.emit("sfu:resume-producer", { producerId });
    }
  }

  closeProducer(kind: "audio" | "video"): void {
    const producer = this.getProducerByKind(kind);
    if (!producer) return;

    producer.close();
    this.producers.delete(producer.id);
    this.host
      .getSocket()
      ?.emit("sfu:close-producer", { producerId: producer.id });

    if (kind === "audio") {
      this.host.updateState({ audioProducerId: null });
    } else {
      this.host.updateState({ videoProducerId: null });
    }
  }

  async replaceTrack(
    kind: "audio" | "video",
    newTrack: MediaStreamTrack | null,
  ): Promise<boolean> {
    const producer = this.getProducerByKind(kind);
    if (!producer) return true;
    // Two callers can request the same swap (the track-sync hook reacts to
    // the capture state change while the toggle handler awaits its own
    // swap): serialize per media kind, skipping redundant work.
    return withoutConcurrency(this.locks, `replace:${kind}`, async () => {
      if (producer.track === newTrack) return true;
      try {
        await producer.replaceTrack({ track: newTrack });
        return true;
      } catch (error) {
        this.log.error(`[SFU] Failed to replace ${kind} track:`, error);
        return false;
      }
    });
  }

  getProducerByKind(kind: "audio" | "video"): Producer | undefined {
    for (const producer of this.producers.values()) {
      if (producer.kind !== kind) continue;
      if (
        kind === "video" &&
        (producer.appData as Record<string, unknown> | undefined)?.source ===
          "screen"
      ) {
        continue;
      }
      return producer;
    }
    return undefined;
  }

  onProducerStateChange(callback: SfuProducerStateCallback): () => void {
    this.producerStateCallbacks.add(callback);
    return () => this.producerStateCallbacks.delete(callback);
  }

  /** Fires the registry without the server-event debug log: used when a
   * consumer is created for a producer that is already paused. */
  notifyProducerState(payload: SfuProducerStateChangedPayload): void {
    this.producerStateCallbacks.forEach((callback) => {
      callback(payload);
    });
  }

  handleProducerCreated(payload: SfuProducerCreatedPayload): void {
    const { requestId, producerId, kind, appData } = payload;
    const source = appData?.source;

    this.log.debug("[SFU] Producer created:", kind, producerId, source ?? "");

    const pending = this.pendingProduceRequests.get(requestId);
    if (pending) {
      pending.resolve(producerId);
      this.pendingProduceRequests.delete(requestId);
    }

    if (kind === "audio") {
      this.host.updateState({ audioProducerId: producerId });
    } else if (source === "screen") {
      this.host.updateState({ screenProducerId: producerId });
    } else {
      this.host.updateState({ videoProducerId: producerId });
    }
  }

  handleProduceError(payload: {
    requestId: string;
    code: SfuProduceErrorCode;
    message: string;
  }): void {
    this.log.error("[SFU] Produce error:", payload.code, payload.message);

    const pending = this.pendingProduceRequests.get(payload.requestId);
    if (pending) {
      this.pendingProduceRequests.delete(payload.requestId);
      pending.reject(new SfuProduceError(payload.code, payload.message));
    }

    for (const cb of this.produceErrorCallbacks) {
      cb(payload.code);
    }
  }

  handleProducerStateChanged(payload: SfuProducerStateChangedPayload): void {
    this.log.debug("[SFU] Producer state changed:",
    payload.userId,
    payload.kind,
    payload.paused ? "paused" : "resumed",);
    this.producerStateCallbacks.forEach((callback) => {
      callback(payload);
    });
  }

  /**
   * Holds live local tracks and buffered produce intents across the blip:
   * they replay through the rebuilt join pipeline after the rejoin ack.
   * Tracks are never re-acquired (no getUserMedia) and never stopped here.
   */
  retainLocalProduces(): void {
    for (const producer of this.producers.values()) {
      const track = producer.track;
      if (!track || track.readyState !== "live") continue;
      const source = (producer.appData as Record<string, unknown> | undefined)
        ?.source as SfuMediaSource | undefined;
      this.retainedLocalProduces.push({
        track,
        source: source ?? (producer.kind === "video" ? "camera" : undefined),
        options: {},
      });
    }
    for (const pending of this.pendingLocalProduces.splice(0)) {
      this.retainedLocalProduces.push({
        track: pending.track,
        source: pending.source,
        options: pending.options,
      });
      // Settle the original caller: nothing is being produced right now;
      // the replay re-produces the same track after recovery.
      pending.resolve(null);
    }
  }

  replayRetainedProduces(): void {
    if (this.retainedLocalProduces.length === 0) return;
    const retained = this.retainedLocalProduces.splice(0);
    this.log.info("[SFU] Replaying",
    retained.length,
    "retained local produce(s)",);
    for (const entry of retained) {
      void this.produceWithSource(entry.track, entry.source, entry.options);
    }
  }

  /** Drops the retained produce intents (session intentionally over). */
  clearRetainedProduces(): void {
    this.retainedLocalProduces = [];
  }

  /** Closes every producer and rejects all in-flight produce work. */
  closeAll(): void {
    this.producers.forEach((producer) => {
      producer.close();
    });
    this.producers.clear();
    this.producingInProgress.clear();
    for (const pending of this.pendingProduceRequests.values()) {
      pending.reject(new Error("Transport closed"));
    }
    this.pendingProduceRequests.clear();
    for (const pending of this.pendingLocalProduces.splice(0)) {
      pending.reject(new Error("Transport closed"));
    }
  }

  /** Clears produce bookkeeping without closing the live media objects. */
  resetState(): void {
    this.producers.clear();
    this.producingInProgress.clear();
    for (const pending of this.pendingProduceRequests.values()) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingProduceRequests.clear();
  }
}
