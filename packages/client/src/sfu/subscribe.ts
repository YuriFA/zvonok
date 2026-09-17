/**
 * Subscribe unit of the SFU manager: remote media consumption. Owns the
 * consumers map, the new-producer buffer for announcements that arrive
 * before the recv transport exists, the track callback registry, and the
 * screen-share-stopped callback registry. Participant state is owned by
 * the ParticipantRegistry this unit consumes; the device and the
 * transports stay with the manager facade and are reached through the
 * narrow host interface below.
 */

import type { Device } from "mediasoup-client";
import type { Consumer, Transport } from "mediasoup-client/types";
import type { Socket } from "socket.io-client";

import { createLogger } from "../helpers/logger.js";
import { ParticipantRegistry } from "./participant-registry.js";
import type {
  SfuConsumerClosedPayload,
  SfuConsumerCreatedPayload,
  SfuNewProducerPayload,
  SfuParticipantInfo,
  SfuProducerStateChangedPayload,
  SfuScreenShareStoppedCallback,
  SfuScreenShareStoppedPayload,
  SfuState,
  SfuTrackCallback,
  SimulcastSpatialLayer,
} from "./types.js";

/** How the unit reaches the recv pipeline and the shared manager state. */
export interface SfuSubscribeHost {
  getSocket(): Socket | null;
  getDevice(): Device | null;
  getRecvTransport(): Transport | null;
  getLocalUserId(): string | null;
  updateState(partial: Partial<SfuState>): void;
  /** Fires the peer-joined registry when consuming implies a new peer. */
  notifyPeerJoined(peer: SfuParticipantInfo): void;
  /** Fires the producer-state registry (paused state on consumer create). */
  notifyProducerState(payload: SfuProducerStateChangedPayload): void;
}

export class SfuSubscribe {
  private readonly log = createLogger("sfu");
  private readonly registry: ParticipantRegistry;
  private readonly host: SfuSubscribeHost;
  private consumers = new Map<string, Consumer>();
  private pendingNewProducers: SfuNewProducerPayload[] = [];
  private trackCallbacks = new Set<SfuTrackCallback>();
  private screenShareStoppedCallbacks = new Set<SfuScreenShareStoppedCallback>();

  constructor(registry: ParticipantRegistry, host: SfuSubscribeHost) {
    this.registry = registry;
    this.host = host;
  }

  /**
   * Emit sfu:set-preferred-layers to the server to request a simulcast layer switch.
   * Should only be called for video consumers.
   */
  setPreferredLayers(consumerId: string, spatialLayer: SimulcastSpatialLayer): void {
    this.host.getSocket()?.emit("sfu:set-preferred-layers", { consumerId, spatialLayer });
  }

  /**
   * Look up the consumer ID for the camera video stream of a given remote peer.
   * Returns undefined if no camera video consumer exists for that peer.
   * Skips screen-share consumers even if they are video kind.
   */
  getVideoConsumerIdForUserId(userId: string): string | undefined {
    const peer = this.registry.get(userId);
    if (!peer) return undefined;

    for (const [consumerId, consumer] of this.consumers) {
      if (consumer.kind !== "video") continue;
      const producerInfo = peer.producers.get(consumer.producerId);
      if (!producerInfo) continue;
      // Only return camera consumers, not screen-share consumers.
      if (producerInfo.source === "screen") continue;
      return consumerId;
    }
    return undefined;
  }

  onTrack(callback: SfuTrackCallback): () => void {
    this.trackCallbacks.add(callback);
    return () => this.trackCallbacks.delete(callback);
  }

  onScreenShareStopped(callback: SfuScreenShareStoppedCallback): () => void {
    this.screenShareStoppedCallbacks.add(callback);
    return () => this.screenShareStoppedCallbacks.delete(callback);
  }

  /** Fires the screen-share-stopped registry; the manager owns the
   * isScreenShareBlocked state side of the notification. */
  notifyScreenShareStopped(payload: SfuScreenShareStoppedPayload): void {
    for (const cb of this.screenShareStoppedCallbacks) {
      cb(payload);
    }
  }

  handleNewProducer(payload: SfuNewProducerPayload): void {
    this.log.debug("[SFU] New producer:", payload.userId, payload.kind);
    // A screen-share producer from another peer means the room is blocked for us.
    if (payload.appData?.source === "screen" && payload.userId !== this.host.getLocalUserId()) {
      this.host.updateState({ isScreenShareBlocked: true });
    }
    void this.consumeProducer(payload);
  }

  async handleConsumerCreated(payload: SfuConsumerCreatedPayload): Promise<void> {
    const recvTransport = this.host.getRecvTransport();
    if (!recvTransport || !this.host.getDevice()) return;

    try {
      const consumer = await recvTransport.consume({
        id: payload.consumerId,
        producerId: payload.producerId,
        kind: payload.kind,
        rtpParameters: payload.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);
      this.log.debug("[SFU] Consumer ready:", payload.kind, consumer.id);

      // Resume the consumer  -  delay for audio to let jitter buffer initialise
      if (payload.kind === "audio") {
        setTimeout(() => {
          this.host.getSocket()?.emit("sfu:resume-consumer", { consumerId: consumer.id });
        }, 150);
      } else {
        this.host.getSocket()?.emit("sfu:resume-consumer", { consumerId: consumer.id });
      }

      // Find the announcing participant for this consumer's producer
      const found = this.registry.findProducer(payload.producerId);
      const userId = found?.userId ?? "";
      const source = found?.info.source;

      // Notify track callback
      for (const callback of this.trackCallbacks) {
        callback(consumer.track, payload.kind, userId, source);
      }

      if (found?.info.paused) {
        this.host.notifyProducerState({
          producerId: payload.producerId,
          kind: payload.kind,
          userId,
          paused: true,
        });
      }

      consumer.on("transportclose", () => {
        this.consumers.delete(consumer.id);
      });

      consumer.on("trackended", () => {
        consumer.close();
        this.consumers.delete(consumer.id);
      });
    } catch (error) {
      this.log.error("[SFU] Failed to create consumer:", error);
    }
  }

  handleConsumerClosed(payload: SfuConsumerClosedPayload): void {
    this.log.debug("[SFU] Consumer closed by server:", payload.consumerId);
    const consumer = this.consumers.get(payload.consumerId);
    if (!consumer) return;
    consumer.close();
    this.consumers.delete(payload.consumerId);
  }

  /** Closes the consumers subscribed to a peer's producers (peer left). */
  closeConsumersForPeer(peer: SfuParticipantInfo): void {
    for (const [consumerId, consumer] of this.consumers) {
      if (peer.producers.has(consumer.producerId)) {
        consumer.close();
        this.consumers.delete(consumerId);
      }
    }
  }

  /** Replays producers that arrived before the recv transport was ready. */
  flushPendingProducers(): void {
    if (this.pendingNewProducers.length > 0) {
      const pending = this.pendingNewProducers.splice(0);
      this.log.debug("[SFU] Processing", pending.length, "buffered new-producer(s)");
      for (const pendingPayload of pending) {
        void this.consumeProducer(pendingPayload);
      }
    }
  }

  /** Drops buffered new-producer payloads; their media plane is gone. */
  clearPendingProducers(): void {
    this.pendingNewProducers = [];
  }

  /** Consumer snapshot for the stats collector. */
  getConsumerEntries(): Iterable<[string, Consumer]> {
    return this.consumers.entries();
  }

  /** Closes every consumer. */
  closeAll(): void {
    this.consumers.forEach((consumer) => {
      consumer.close();
    });
    this.consumers.clear();
  }

  /** Clears consumer bookkeeping without closing the live media objects. */
  resetState(): void {
    this.consumers.clear();
    this.pendingNewProducers = [];
  }

  private async consumeProducer(payload: SfuNewProducerPayload): Promise<void> {
    const socket = this.host.getSocket();
    const device = this.host.getDevice();
    const recvTransport = this.host.getRecvTransport();
    if (!socket || !device || !recvTransport) {
      this.log.warn("[SFU] Recv transport not ready, buffering new-producer:", payload.producerId);
      this.pendingNewProducers.push(payload);
      return;
    }

    // Track peer info: consuming a producer implies the participant exists
    // and their media is flowing.
    const { peer, created } = this.registry.upsert({
      userId: payload.userId,
      username: payload.username,
    });
    if (created) {
      this.host.notifyPeerJoined(peer);
    }
    this.registry.attachProducer(payload.userId, payload.producerId, {
      kind: payload.kind,
      paused: payload.paused,
      source: payload.appData?.source,
    });

    // Request to consume
    socket.emit("sfu:consume", {
      producerId: payload.producerId,
      rtpCapabilities: device.recvRtpCapabilities,
    });
  }
}
