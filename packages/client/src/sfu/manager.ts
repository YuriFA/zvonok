/**
 * SFU manager facade.
 * Composes connection, event router, stats collector into a unified interface.
 */

import { Device } from "mediasoup-client";
import type {
  Consumer,
  DtlsParameters,
  MediaKind,
  Producer,
  RtpCapabilities,
  RtpEncodingParameters,
  RtpParameters,
  Transport,
} from "mediasoup-client/types";

import type { Socket } from "socket.io-client";

import { SfuConnection } from "./connection.js";
import { SfuEventRouter, type SfuEventHandlers } from "./event-router.js";
import type { ISfuManager } from "./interfaces.js";
import { SfuStatsCollector } from "./stats-collector.js";
import type {
  SfuState,
  SfuJoinedPayload,
  SfuTransportCreatedPayload,
  SfuNewProducerPayload,
  SfuConsumerCreatedPayload,
  SfuProducerCreatedPayload,
  SfuJoinPayload,
  SfuKickedPayload,
  SfuRoomEndedPayload,
  SfuParticipantInfo,
  SfuParticipantJoinedPayload,
  SfuExistingParticipantsPayload,
  SfuProducerStateChangedPayload,
  QualityStatsCallback,
  PeerQualityStats,
  SfuStateCallback,
  SfuTrackCallback,
  SfuParticipantCallback,
  SfuProducerStateCallback,
  SimulcastSpatialLayer,
  SfuProduceErrorCode,
  SfuMediaSource,
  SfuConsumerClosedPayload,
  SfuScreenShareStoppedPayload,
  SfuScreenShareStoppedCallback,
  SfuGuestJoinRequestPayload,
  SfuJoinErrorPayload,
  SfuEgressStatusPayload,
  SfuEgressOutputRequest,
  SfuBroadcastMessage,
} from "./types.js";
import {
  SfuProduceError,
  SfuJoinError,
  SfuHostActionError,
  SfuEgressActionError,
  SfuBroadcastError,
} from "./types.js";

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
 * Facade for SFU management.
 * Implements ISfuManager by composing focused modules.
 */
export class SfuManager implements ISfuManager {
  private connection: SfuConnection;
  private statsCollector: SfuStatsCollector;

  // Internal mediasoup state
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers = new Map<string, Producer>();
  private consumers = new Map<string, Consumer>();
  private peers = new Map<string, SfuParticipantInfo>();
  private pendingNewProducers: SfuNewProducerPayload[] = [];
  private producingInProgress = new Map<string, Promise<Producer | null>>();
  private replaceChains: Record<"audio" | "video", Promise<boolean>> = {
    audio: Promise.resolve(true),
    video: Promise.resolve(true),
  };
  private pendingProduceRequests = new Map<
    string,
    {
      resolve: (id: string) => void;
      reject: (error: Error) => void;
      source: SfuMediaSource;
    }
  >();
  private localUserId: string | null = null;
  // Local produce calls that arrived before the send transport existed
  // (device still loading after join). Flushed when the transport is ready.
  private pendingLocalProduces: Array<{
    track: MediaStreamTrack;
    source?: SfuMediaSource;
    options: { isMobile?: boolean };
    resolve: (producer: Producer | null) => void;
    reject: (error: Error) => void;
  }> = [];

  // State and callbacks
  private state: SfuState = {
    connectionState: "disconnected",
    isDeviceLoaded: false,
    isSendTransportCreated: false,
    sendTransportConnected: false,
    recvTransportConnected: false,
    audioProducerId: null,
    videoProducerId: null,
    screenProducerId: null,
    isScreenShareBlocked: false,
    capabilities: [],
    egress: null,
    lastBroadcast: null,
  };
  private stateCallbacks = new Set<SfuStateCallback>();
  private trackCallbacks = new Set<SfuTrackCallback>();
  private peerJoinedCallbacks = new Set<SfuParticipantCallback>();
  private peerLeftCallbacks = new Set<(userId: string) => void>();
  private kickedCallbacks = new Set<(payload: SfuKickedPayload) => void>();
  private roomEndedCallbacks = new Set<
    (payload: SfuRoomEndedPayload) => void
  >();
  private producerStateCallbacks = new Set<SfuProducerStateCallback>();
  private produceErrorCallbacks = new Set<
    (code: SfuProduceErrorCode) => void
  >();
  private joinErrorCallbacks = new Set<(error: SfuJoinError) => void>();
  private screenShareStoppedCallbacks =
    new Set<SfuScreenShareStoppedCallback>();
  private guestJoinRequestCallbacks = new Set<
    (payload: SfuGuestJoinRequestPayload) => void
  >();
  private broadcastCallbacks = new Set<
    (message: SfuBroadcastMessage) => void
  >();

  // Event router
  private eventRouter = new SfuEventRouter(
    () => this.connection.getSocket(),
    this.createEventHandlers(),
  );

  constructor(connection: SfuConnection = new SfuConnection()) {
    this.connection = connection;
    this.statsCollector = new SfuStatsCollector(
      () => this.recvTransport,
      () => this.consumers.entries(),
      (producerId) => this.findPeerForProducer(producerId),
    );
  }

  private createEventHandlers(): SfuEventHandlers {
    return {
      onConnected: () => this.handleConnected(),
      onDisconnected: () => this.handleDisconnected(),
      onReconnectFailed: () => this.handleReconnectFailed(),
      onJoined: (p) => this.handleJoined(p),
      onTransportCreated: (p) => this.handleTransportCreated(p),
      onTransportConnected: (p) => this.handleTransportConnected(p),
      onProducerCreated: (p) => this.handleProducerCreated(p),
      onProduceError: (p) => this.handleProduceError(p),
      onJoinError: (p) => this.handleJoinError(p),
      onParticipantJoined: (p) => this.handlePeerJoined(p),
      onExistingParticipants: (p) => this.handleExistingPeers(p),
      onNewProducer: (p) => this.handleNewProducer(p),
      onConsumerCreated: (p) => this.handleConsumerCreated(p),
      onConsumerClosed: (p) => this.handleConsumerClosed(p),
      onProducerStateChanged: (p) => this.handleProducerStateChanged(p),
      onParticipantLeft: (p) => this.handlePeerLeft(p),
      onKicked: (p) => this.handleKicked(p),
      onRoomEnded: (p) => this.handleRoomEnded(p),
      onScreenShareStarted: (p) => this.handleScreenShareStarted(p),
      onScreenShareStopped: (p) => this.handleScreenShareStopped(p),
      onGuestJoinRequest: (p) => this.handleGuestJoinRequest(p),
      onEgressStatus: (p) => this.handleEgressStatus(p),
      onBroadcast: (p) => this.handleBroadcast(p),
    };
  }

  // ISfuConnection
  connect(): void {
    // Guard against duplicate calls while already connecting or connected.
    // socket.io's on() appends listeners, so calling teardown+setup twice
    // would double-register every handler.
    if (
      this.connection.isConnected() ||
      this.state.connectionState === "connecting"
    )
      return;
    // Tear down before re-registering to clear any stale listeners left from a
    // previous cycle (e.g. after disconnect → reconnect).
    this.eventRouter.teardown();
    this.updateState({ connectionState: "connecting" });
    this.connection.connect();
    this.eventRouter.setup();
  }

  disconnect(): void {
    this.statsCollector.stop();
    this.eventRouter.teardown();
    this.closeAll();
    this.connection.disconnect();
    this.resetState();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  getSocket(): Socket | null {
    return this.connection.getSocket();
  }

  // ISfuRoomMembership
  async joinRoom(payload: SfuJoinPayload): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) {
      throw new Error("Socket not connected");
    }
    // The room token is authoritative: its `sub` claim is the room id the
    // server minted it for. Callers frequently only know the room slug, and
    // sending a slug as roomId fails verification with
    // ROOM_TOKEN_ROOM_MISMATCH whenever slug !== id.
    const tokenRoomId = payload.token
      ? readRoomIdFromToken(payload.token)
      : null;
    socket.emit("sfu:join", {
      ...payload,
      roomId: tokenRoomId ?? payload.roomId,
    });
  }

  leaveRoom(): void {
    const socket = this.connection.getSocket();
    if (socket) {
      socket.emit("sfu:leave");
    }
    this.closeAll();
  }

  getLocalUserId(): string | null {
    return this.localUserId;
  }
  // ISfuHostControls
  async mutePeer(
    userId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.emitHostAction("sfu:mute-peer", { userId }, options?.timeoutMs);
  }

  async muteAll(options?: { timeoutMs?: number }): Promise<void> {
    await this.emitHostAction("sfu:mute-all", {}, options?.timeoutMs);
  }

  async lockRoom(
    locked: boolean,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.emitHostAction("sfu:lock-room", { locked }, options?.timeoutMs);
  }

  async kickPeer(
    userId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.emitHostAction("sfu:kick-peer", { userId }, options?.timeoutMs);
  }

  /** How long to wait for a host-action acknowledgement before failing. */
  private static readonly HOST_ACTION_TIMEOUT_MS = 10_000;

  /**
   * Emits a host-control event and settles on the server's acknowledgement:
   * `{ok: true}` resolves; `{ok: false, code, message}` rejects with a typed
   * SfuHostActionError carrying the server's code. A missing acknowledgement
   * rejects with HOST_ACTION_TIMEOUT.
   */
  private emitHostAction(
    event: "sfu:mute-peer" | "sfu:mute-all" | "sfu:lock-room" | "sfu:kick-peer",
    payload: Record<string, string | boolean>,
    timeoutMs?: number,
  ): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) {
      return Promise.reject(
        new SfuHostActionError(
          "DISCONNECTED",
          "Join the room before using host controls",
        ),
      );
    }

    const wait = timeoutMs ?? SfuManager.HOST_ACTION_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SfuHostActionError(
            "HOST_ACTION_TIMEOUT",
            `Server did not acknowledge ${event} within ${wait}ms`,
          ),
        );
      }, wait);
      socket.emit(event, payload, (ack: unknown) => {
        clearTimeout(timer);
        const { ok, code, message } = (ack ?? {}) as {
          ok?: boolean;
          code?: string;
          message?: string;
        };
        if (ok === true) {
          resolve();
          return;
        }
        reject(
          new SfuHostActionError(
            (code as SfuHostActionError["code"]) ?? "MISSING_CAPABILITY",
            message ?? `Server denied ${event}`,
          ),
        );
      });
    });
  }

  // Egress control (client-initiated sessions; RTMP stays server-side)
  async startEgress(
    outputs: SfuEgressOutputRequest,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.emitEgressAction(
      "egress:start",
      { record: outputs.record === true, hls: outputs.hls === true },
      options?.timeoutMs,
    );
  }

  async stopEgress(options?: { timeoutMs?: number }): Promise<void> {
    await this.emitEgressAction("egress:stop", {}, options?.timeoutMs);
  }

  /** How long to wait for an egress acknowledgement before failing. */
  private static readonly EGRESS_ACTION_TIMEOUT_MS = 10_000;

  /**
   * Emits an egress control event and settles on the server's
   * acknowledgement, mirroring the host-action ack contract.
   */
  private emitEgressAction(
    event: "egress:start" | "egress:stop",
    payload: Record<string, boolean>,
    timeoutMs?: number,
  ): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) {
      return Promise.reject(
        new SfuEgressActionError(
          "DISCONNECTED",
          "Join the room before controlling egress",
        ),
      );
    }

    const wait = timeoutMs ?? SfuManager.EGRESS_ACTION_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SfuEgressActionError(
            "EGRESS_ACTION_TIMEOUT",
            `Server did not acknowledge ${event} within ${wait}ms`,
          ),
        );
      }, wait);
      socket.emit(event, payload, (ack: unknown) => {
        clearTimeout(timer);
        const { ok, code, message } = (ack ?? {}) as {
          ok?: boolean;
          code?: string;
          message?: string;
        };
        if (ok === true) {
          resolve();
          return;
        }
        reject(
          new SfuEgressActionError(
            (code as SfuEgressActionError["code"]) ?? "EGRESS_UNAVAILABLE",
            message ?? `Server denied ${event}`,
          ),
        );
      });
    });
  }

  // Data channel (ephemeral topic-scoped broadcasts)
  async sendBroadcast(
    topic: string,
    payload: unknown,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) {
      return Promise.reject(
        new SfuBroadcastError(
          "DISCONNECTED",
          "Join the room before broadcasting",
        ),
      );
    }

    const wait = options?.timeoutMs ?? SfuManager.BROADCAST_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SfuBroadcastError(
            "BROADCAST_TIMEOUT",
            `Server did not acknowledge sfu:broadcast within ${wait}ms`,
          ),
        );
      }, wait);
      socket.emit("sfu:broadcast", { topic, payload }, (ack: unknown) => {
        clearTimeout(timer);
        const { ok, code, message } = (ack ?? {}) as {
          ok?: boolean;
          code?: string;
          message?: string;
        };
        if (ok === true) {
          resolve();
          return;
        }
        reject(
          new SfuBroadcastError(
            (code as SfuBroadcastError["code"]) ?? "MISSING_CAPABILITY",
            message ?? "Server denied sfu:broadcast",
          ),
        );
      });
    });
  }

  /** How long to wait for a broadcast acknowledgement before failing. */
  private static readonly BROADCAST_TIMEOUT_MS = 10_000;

  onBroadcast(callback: (message: SfuBroadcastMessage) => void): () => void {
    this.broadcastCallbacks.add(callback);
    return () => this.broadcastCallbacks.delete(callback);
  }

  private handleBroadcast(message: SfuBroadcastMessage): void {
    // The server never echoes a sender's own message, so every relay that
    // lands here came from another participant.
    this.updateState({ lastBroadcast: message });
    for (const callback of this.broadcastCallbacks) {
      callback(message);
    }
  }

  private handleEgressStatus(payload: SfuEgressStatusPayload): void {
    this.updateState({ egress: payload });
  }

  onKicked(callback: (payload: SfuKickedPayload) => void): () => void {
    this.kickedCallbacks.add(callback);
    return () => this.kickedCallbacks.delete(callback);
  }

  onRoomEnded(callback: (payload: SfuRoomEndedPayload) => void): () => void {
    this.roomEndedCallbacks.add(callback);
    return () => this.roomEndedCallbacks.delete(callback);
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
    if (!this.sendTransport) {
      // The join flow loads the device and creates transports asynchronously;
      // early produce calls (camera/mic right after join) are buffered and
      // flushed once the send transport exists instead of being dropped.
      if (!this.connection.isConnected()) {
        console.error("[SFU] Send transport not ready and not connected");
        return null;
      }
      if (this.pendingLocalProduces.length >= 8) {
        console.warn("[SFU] Local produce queue full, dropping request");
        return null;
      }
      if (track.readyState === "ended") {
        console.warn("[SFU] Not queueing produce for an ended track");
        return null;
      }
      console.log(
        "[SFU] Send transport not ready yet, buffering produce for:",
        track.kind,
      );
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
        console.warn("[SFU] Producer already exists for kind:", kind);
        return existing;
      }
    } else {
      const existing = this.getScreenProducer();
      if (existing) {
        console.warn("[SFU] Screen producer already exists");
        return existing;
      }
    }

    const pending = this.producingInProgress.get(dedupeKey);
    if (pending) {
      console.warn("[SFU] Produce already in-flight for:", dedupeKey);
      return pending;
    }

    const producePromise = this.doProduceTrack(track, source, { isMobile });
    this.producingInProgress.set(dedupeKey, producePromise);

    try {
      return await producePromise;
    } finally {
      this.producingInProgress.delete(dedupeKey);
    }
  }

  private async doProduceTrack(
    track: MediaStreamTrack,
    source?: SfuMediaSource,
    { isMobile }: { isMobile?: boolean } = {},
  ): Promise<Producer | null> {
    if (!this.sendTransport) return null;

    try {
      const isVideo = track.kind === "video";
      const isScreen = source === "screen";
      const producer = await this.sendTransport.produce({
        track,
        encodings: isVideo && !isScreen ? SIMULCAST_ENCODINGS : undefined,
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
      console.log(
        "[SFU] Produced track:",
        track.kind,
        producer.id,
        source ?? "",
      );

      producer.on("transportclose", () => {
        this.producers.delete(producer.id);
      });

      return producer;
    } catch (error) {
      console.error("[SFU] Failed to produce track:", error);
      // Re-throw structured produce errors so callers can inspect the code.
      // For all other errors, return null to preserve existing behaviour.
      if (error instanceof SfuProduceError) {
        throw error;
      }
      return null;
    }
  }

  closeScreenProducer(): void {
    const producer = this.getScreenProducer();
    if (!producer) return;

    producer.close();
    this.producers.delete(producer.id);
    this.connection
      .getSocket()
      ?.emit("sfu:close-producer", { producerId: producer.id });
    this.updateState({ screenProducerId: null });
  }

  isScreenShareBlocked(): boolean {
    return this.state.isScreenShareBlocked;
  }

  onProduceError(callback: (code: SfuProduceErrorCode) => void): () => void {
    this.produceErrorCallbacks.add(callback);
    return () => this.produceErrorCallbacks.delete(callback);
  }

  /** Subscribe to server-refused joins (invalid token, unauthenticated
   * session, forbidden room). Returns an unsubscribe function. */
  onJoinError(callback: (error: SfuJoinError) => void): () => void {
    this.joinErrorCallbacks.add(callback);
    return () => this.joinErrorCallbacks.delete(callback);
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
      this.connection.getSocket()?.emit("sfu:pause-producer", { producerId });
    }
  }

  resumeProducer(producerId: string): void {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.resume();
      this.connection.getSocket()?.emit("sfu:resume-producer", { producerId });
    }
  }

  closeProducer(kind: "audio" | "video"): void {
    const producer = this.getProducerByKind(kind);
    if (!producer) return;

    producer.close();
    this.producers.delete(producer.id);
    this.connection
      .getSocket()
      ?.emit("sfu:close-producer", { producerId: producer.id });

    if (kind === "audio") {
      this.updateState({ audioProducerId: null });
    } else {
      this.updateState({ videoProducerId: null });
    }
  }

  async replaceTrack(
    kind: "audio" | "video",
    newTrack: MediaStreamTrack | null,
  ): Promise<boolean> {
    const producer = this.getProducerByKind(kind);
    if (!producer) return true;
    // Two callers can request the same swap (the track-sync hook reacts to the
    // capture state change while the toggle handler awaits its own swap).
    // Serialize and skip redundant work: concurrent replaceTrack calls reject.
    const swap = this.replaceChains[kind].then(async () => {
      if (producer.track === newTrack) return true;
      try {
        await producer.replaceTrack({ track: newTrack });
        return true;
      } catch (error) {
        console.error(`[SFU] Failed to replace ${kind} track:`, error);
        return false;
      }
    });
    this.replaceChains[kind] = swap.catch(() => false);
    return swap;
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

  /**
   * Emit sfu:set-preferred-layers to the server to request a simulcast layer switch.
   * Should only be called for video consumers.
   */
  setPreferredLayers(
    consumerId: string,
    spatialLayer: SimulcastSpatialLayer,
  ): void {
    this.connection
      .getSocket()
      ?.emit("sfu:set-preferred-layers", { consumerId, spatialLayer });
  }

  /**
   * Look up the consumer ID for the camera video stream of a given remote peer.
   * Returns undefined if no camera video consumer exists for that peer.
   * Skips screen-share consumers even if they are video kind.
   */
  getVideoConsumerIdForUserId(userId: string): string | undefined {
    const peer = this.peers.get(userId);
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

  // ISfuParticipantRegistry
  getParticipants(): Map<string, SfuParticipantInfo> {
    return new Map(this.peers);
  }

  getParticipant(userId: string): SfuParticipantInfo | undefined {
    return this.peers.get(userId);
  }

  onParticipantJoined(callback: SfuParticipantCallback): () => void {
    this.peerJoinedCallbacks.add(callback);
    return () => this.peerJoinedCallbacks.delete(callback);
  }

  onParticipantLeft(callback: (userId: string) => void): () => void {
    this.peerLeftCallbacks.add(callback);
    return () => this.peerLeftCallbacks.delete(callback);
  }

  // ISfuStateNotifier
  getState(): SfuState {
    return { ...this.state };
  }

  onStateChange(callback: SfuStateCallback): () => void {
    this.stateCallbacks.add(callback);
    callback(this.getState());
    return () => this.stateCallbacks.delete(callback);
  }

  onTrack(callback: SfuTrackCallback): () => void {
    this.trackCallbacks.add(callback);
    return () => this.trackCallbacks.delete(callback);
  }

  onScreenShareStopped(callback: SfuScreenShareStoppedCallback): () => void {
    this.screenShareStoppedCallbacks.add(callback);
    return () => this.screenShareStoppedCallbacks.delete(callback);
  }

  onGuestJoinRequest(
    callback: (payload: SfuGuestJoinRequestPayload) => void,
  ): () => void {
    this.guestJoinRequestCallbacks.add(callback);
    return () => this.guestJoinRequestCallbacks.delete(callback);
  }

  onProducerStateChange(callback: SfuProducerStateCallback): () => void {
    this.producerStateCallbacks.add(callback);
    return () => this.producerStateCallbacks.delete(callback);
  }

  // Stats methods
  startStatsCollection(intervalMs?: number): void {
    this.statsCollector.start(intervalMs);
  }

  stopStatsCollection(): void {
    this.statsCollector.stop();
  }

  onQualityStats(callback: QualityStatsCallback): () => void {
    return this.statsCollector.onStats(callback);
  }

  getStats(): Map<string, PeerQualityStats> {
    return new Map();
  }

  // Event handlers
  private handleConnected(): void {
    console.log("[SFU] Connected");
    this.updateState({ connectionState: "connected" });
  }

  private handleDisconnected(): void {
    console.log("[SFU] Disconnected");
    // Reset device-level flags before closeAll() so the intermediate state
    // notification from closeAll() never has isSendTransportCreated=true while
    // the send transport is already null (which would trigger spurious produce
    // attempts in consumers of onStateChange).
    this.updateState({
      connectionState: "connecting",
      isDeviceLoaded: false,
      isSendTransportCreated: false,
    });
    this.closeAll();
    this.device = null;
    this.pendingNewProducers = [];
  }

  private handleReconnectFailed(): void {
    console.log("[SFU] Reconnect failed");
    this.updateState({ connectionState: "failed" });
  }

  private async handleJoined(payload: SfuJoinedPayload): Promise<void> {
    console.log("[SFU] Joined room, loading device...");
    // The server echoes back the verified identity and the effective
    // capabilities; payload identity is never trusted and rights are never
    // decoded from the token client-side.
    this.localUserId = payload.participant?.id ?? null;
    this.updateState({ capabilities: payload.capabilities ?? [] });
    await this.loadDevice(payload.routerRtpCapabilities);
  }

  private async handleTransportCreated(
    payload: SfuTransportCreatedPayload,
  ): Promise<void> {
    if (!this.device) return;

    const transportOptions = {
      id: payload.transportId,
      iceParameters: payload.iceParameters,
      iceCandidates: payload.iceCandidates,
      dtlsParameters: payload.dtlsParameters,
      iceServers: payload.iceServers,
    };

    if (payload.direction === "send") {
      this.sendTransport = this.device.createSendTransport(transportOptions);
      this.updateState({ isSendTransportCreated: true });

      this.sendTransport.on(
        "connect",
        async (
          { dtlsParameters }: { dtlsParameters: DtlsParameters },
          callback: () => void,
          errback: (error: Error) => void,
        ) => {
          try {
            const sendTransport = this.sendTransport;
            if (!sendTransport) {
              throw new Error("Send transport not ready");
            }

            this.connection.getSocket()?.emit("sfu:connect-transport", {
              transportId: sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error as Error);
          }
        },
      );

      this.sendTransport.on(
        "produce",
        async (
          {
            kind,
            rtpParameters,
            appData,
          }: {
            kind: MediaKind;
            rtpParameters: RtpParameters;
            appData?: Record<string, unknown>;
          },
          callback: ({ id }: { id: string }) => void,
          errback: (error: Error) => void,
        ) => {
          try {
            const sendTransport = this.sendTransport;
            if (!sendTransport) {
              throw new Error("Send transport not ready");
            }

            const requestId = crypto.randomUUID();
            const source = appData?.source as SfuMediaSource | undefined;

            const promise = new Promise<string>((resolve, reject) => {
              this.pendingProduceRequests.set(requestId, {
                resolve,
                reject,
                source: source ?? "camera",
              });
            });

            this.connection.getSocket()?.emit("sfu:produce", {
              requestId,
              transportId: sendTransport.id,
              kind,
              rtpParameters,
              appData: appData
                ? { source: appData.source as SfuMediaSource | undefined }
                : undefined,
            });

            const producerId = await promise;
            callback({ id: producerId });
          } catch (error) {
            errback(error as Error);
          }
        },
      );
      // Flush produce calls that arrived before the transport existed.
      // mediasoup-client waits for the transport "connect" handshake, so
      // producing now is safe even before DTLS completes.
      if (this.pendingLocalProduces.length > 0) {
        const pending = this.pendingLocalProduces.splice(0);
        console.log(
          "[SFU] Flushing",
          pending.length,
          "buffered local produce(s)",
        );
        for (const entry of pending) {
          this.produceWithSource(entry.track, entry.source, entry.options).then(
            entry.resolve,
            entry.reject,
          );
        }
      }
    } else {
      this.recvTransport = this.device.createRecvTransport(transportOptions);

      // Replay any producers that arrived before the recv transport was ready
      if (this.pendingNewProducers.length > 0) {
        const pending = this.pendingNewProducers.splice(0);
        console.log(
          "[SFU] Processing",
          pending.length,
          "buffered new-producer(s)",
        );
        for (const pendingPayload of pending) {
          void this.consumeProducer(pendingPayload);
        }
      }

      this.recvTransport.on(
        "connect",
        async (
          { dtlsParameters }: { dtlsParameters: DtlsParameters },
          callback: () => void,
          errback: (error: Error) => void,
        ) => {
          try {
            const recvTransport = this.recvTransport;
            if (!recvTransport) {
              throw new Error("Receive transport not ready");
            }

            this.connection.getSocket()?.emit("sfu:connect-transport", {
              transportId: recvTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error as Error);
          }
        },
      );
    }
  }

  private handleTransportConnected(payload: { transportId: string }): void {
    console.log("[SFU] Transport connected:", payload.transportId);
    if (this.sendTransport?.id === payload.transportId) {
      this.updateState({ sendTransportConnected: true });
    } else if (this.recvTransport?.id === payload.transportId) {
      this.updateState({ recvTransportConnected: true });
    }
  }

  private handleProducerCreated(payload: SfuProducerCreatedPayload): void {
    const { requestId, producerId, kind, appData } = payload;
    const source = appData?.source;

    console.log("[SFU] Producer created:", kind, producerId, source ?? "");

    const pending = this.pendingProduceRequests.get(requestId);
    if (pending) {
      pending.resolve(producerId);
      this.pendingProduceRequests.delete(requestId);
    }

    if (kind === "audio") {
      this.updateState({ audioProducerId: producerId });
    } else if (source === "screen") {
      this.updateState({ screenProducerId: producerId });
    } else {
      this.updateState({ videoProducerId: producerId });
    }
  }

  private handleProduceError(payload: {
    requestId: string;
    code: SfuProduceErrorCode;
    message: string;
  }): void {
    console.error("[SFU] Produce error:", payload.code, payload.message);

    const pending = this.pendingProduceRequests.get(payload.requestId);
    if (pending) {
      this.pendingProduceRequests.delete(payload.requestId);
      pending.reject(new SfuProduceError(payload.code, payload.message));
    }

    for (const cb of this.produceErrorCallbacks) {
      cb(payload.code);
    }
  }

  private handleJoinError(payload: SfuJoinErrorPayload): void {
    console.error("[SFU] Join error:", payload.code, payload.message);
    const error = new SfuJoinError(payload.code, payload.message);
    for (const cb of this.joinErrorCallbacks) {
      cb(error);
    }
  }

  private handlePeerJoined(payload: SfuParticipantJoinedPayload): void {
    console.log("[SFU] Peer joined:", payload.userId, payload.username);
    let peer = this.peers.get(payload.userId);
    if (!peer) {
      peer = {
        userId: payload.userId,
        username: payload.username,
        externalId: payload.externalId,
        metadata: payload.metadata,
        producers: new Map(),
      };
      this.peers.set(payload.userId, peer);
    } else {
      if (payload.username) {
        peer.username = payload.username;
      }
    }
    this.peerJoinedCallbacks.forEach((callback) => {
      callback(peer!);
    });
  }

  private handleExistingPeers(peers: SfuExistingParticipantsPayload[]): void {
    console.log("[SFU] Existing peers:", peers.length);
    for (const peerData of peers) {
      let peer = this.peers.get(peerData.userId);
      if (!peer) {
        peer = {
          userId: peerData.userId,
          username: peerData.username,
          externalId: peerData.externalId,
          metadata: peerData.metadata,
          producers: new Map(),
        };
        this.peers.set(peerData.userId, peer);
      } else {
        if (peerData.username) {
          peer.username = peerData.username;
        }
      }
      this.peerJoinedCallbacks.forEach((callback) => {
        callback(peer!);
      });
    }
  }

  private handleNewProducer(payload: SfuNewProducerPayload): void {
    console.log("[SFU] New producer:", payload.userId, payload.kind);
    // A screen-share producer from another peer means the room is blocked for us.
    if (
      payload.appData?.source === "screen" &&
      payload.userId !== this.localUserId
    ) {
      this.updateState({ isScreenShareBlocked: true });
    }
    void this.consumeProducer(payload);
  }

  private async handleConsumerCreated(
    payload: SfuConsumerCreatedPayload,
  ): Promise<void> {
    if (!this.recvTransport || !this.device) return;

    try {
      const consumer = await this.recvTransport.consume({
        id: payload.consumerId,
        producerId: payload.producerId,
        kind: payload.kind,
        rtpParameters: payload.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);
      console.log("[SFU] Consumer ready:", payload.kind, consumer.id);

      // Resume the consumer  -  delay for audio to let jitter buffer initialise
      if (payload.kind === "audio") {
        setTimeout(() => {
          this.connection
            .getSocket()
            ?.emit("sfu:resume-consumer", { consumerId: consumer.id });
        }, 150);
      } else {
        this.connection
          .getSocket()
          ?.emit("sfu:resume-consumer", { consumerId: consumer.id });
      }

      // Find the peer userId for this consumer
      let userId = "";
      let source: SfuMediaSource | undefined;
      for (const [uid, peer] of this.peers) {
        const producerInfo = peer.producers.get(payload.producerId);
        if (producerInfo) {
          userId = uid;
          source = producerInfo.source;
          break;
        }
      }

      // Notify track callback
      for (const callback of this.trackCallbacks) {
        callback(consumer.track, payload.kind, userId, source);
      }

      const producerInfo = this.peers
        .get(userId)
        ?.producers.get(payload.producerId);
      if (producerInfo?.paused) {
        this.producerStateCallbacks.forEach((callback) => {
          callback({
            producerId: payload.producerId,
            kind: payload.kind,
            userId,
            paused: true,
          });
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
      console.error("[SFU] Failed to create consumer:", error);
    }
  }

  private handleProducerStateChanged(
    payload: SfuProducerStateChangedPayload,
  ): void {
    console.log(
      "[SFU] Producer state changed:",
      payload.userId,
      payload.kind,
      payload.paused ? "paused" : "resumed",
    );
    this.producerStateCallbacks.forEach((callback) => {
      callback(payload);
    });
  }

  private handlePeerLeft(payload: { userId: string }): void {
    console.log("[SFU] Peer left:", payload.userId);
    const peer = this.peers.get(payload.userId);
    if (peer) {
      // Close consumers for this peer
      for (const [consumerId, consumer] of this.consumers) {
        if (peer.producers.has(consumer.producerId)) {
          consumer.close();
          this.consumers.delete(consumerId);
        }
      }
      this.peers.delete(payload.userId);
    }
    this.peerLeftCallbacks.forEach((callback) => {
      callback(payload.userId);
    });
  }

  private handleKicked(payload: SfuKickedPayload): void {
    console.log("[SFU] Kicked from room:", payload.roomId);
    this.kickedCallbacks.forEach((callback) => {
      callback(payload);
    });
    this.closeAll();
    this.updateState({ connectionState: "disconnected" });
  }

  private handleRoomEnded(payload: SfuRoomEndedPayload): void {
    console.log("[SFU] Room ended:", payload.roomId);
    for (const callback of this.roomEndedCallbacks) {
      callback(payload);
    }
    this.closeAll();
    this.updateState({ connectionState: "disconnected" });
  }

  private handleScreenShareStarted(payload: { userId: string }): void {
    console.log("[SFU] Screen share started:", payload.userId);
    if (payload.userId !== this.localUserId) {
      this.updateState({ isScreenShareBlocked: true });
    }
  }

  private handleScreenShareStopped(
    payload: SfuScreenShareStoppedPayload,
  ): void {
    console.log("[SFU] Screen share stopped:", payload.userId);
    if (payload.userId !== this.localUserId) {
      this.updateState({ isScreenShareBlocked: false });
      // Notify subscribers so they can clear the remote peer's screen state
      // immediately, without waiting for track.onended.
      for (const cb of this.screenShareStoppedCallbacks) {
        cb(payload);
      }
    }
  }

  private handleGuestJoinRequest(payload: SfuGuestJoinRequestPayload): void {
    for (const cb of this.guestJoinRequestCallbacks) {
      cb(payload);
    }
  }

  private handleConsumerClosed(payload: SfuConsumerClosedPayload): void {
    console.log("[SFU] Consumer closed by server:", payload.consumerId);
    const consumer = this.consumers.get(payload.consumerId);
    if (!consumer) return;
    consumer.close();
    this.consumers.delete(payload.consumerId);
  }

  // Private helpers
  private async loadDevice(
    routerRtpCapabilities: RtpCapabilities,
  ): Promise<void> {
    try {
      this.device = new Device();
      await this.device.load({ routerRtpCapabilities });
      this.updateState({ isDeviceLoaded: true });
      console.log("[SFU] Device loaded");

      // Create transports after device is loaded
      await this.createTransports();
    } catch (error) {
      console.error("[SFU] Failed to load device:", error);
      this.updateState({ connectionState: "failed" });
    }
  }

  private async createTransports(): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) return;

    socket.emit("sfu:create-send-transport");
    socket.emit("sfu:create-recv-transport");
  }

  private async consumeProducer(payload: SfuNewProducerPayload): Promise<void> {
    if (!this.connection.getSocket() || !this.device || !this.recvTransport) {
      console.warn(
        "[SFU] Recv transport not ready, buffering new-producer:",
        payload.producerId,
      );
      this.pendingNewProducers.push(payload);
      return;
    }

    // Track peer info
    let peer = this.peers.get(payload.userId);
    if (!peer) {
      peer = {
        userId: payload.userId,
        username: payload.username || "",
        producers: new Map(),
      };
      this.peers.set(payload.userId, peer);
      this.peerJoinedCallbacks.forEach((callback) => {
        callback(peer!);
      });
    }
    peer.producers.set(payload.producerId, {
      kind: payload.kind,
      paused: payload.paused,
      source: payload.appData?.source,
    });

    // Request to consume
    this.connection.getSocket()!.emit("sfu:consume", {
      producerId: payload.producerId,
      rtpCapabilities: this.device.recvRtpCapabilities,
    });
  }

  private findPeerForProducer(producerId: string): string | undefined {
    for (const [userId, peer] of this.peers) {
      if (peer.producers.has(producerId)) {
        return userId;
      }
    }
    return undefined;
  }

  private closeAll(): void {
    this.producers.forEach((producer) => {
      producer.close();
    });
    this.consumers.forEach((consumer) => {
      consumer.close();
    });
    this.producers.clear();
    this.consumers.clear();
    this.producingInProgress.clear();
    for (const pending of this.pendingProduceRequests.values()) {
      pending.reject(new Error("Transport closed"));
    }
    this.pendingProduceRequests.clear();
    for (const pending of this.pendingLocalProduces.splice(0)) {
      pending.reject(new Error("Transport closed"));
    }
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.peers.clear();
    this.updateState({
      sendTransportConnected: false,
      recvTransportConnected: false,
      audioProducerId: null,
      videoProducerId: null,
      screenProducerId: null,
      isScreenShareBlocked: false,
    });
  }

  private resetState(): void {
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.producers.clear();
    this.consumers.clear();
    this.producingInProgress.clear();
    for (const pending of this.pendingProduceRequests.values()) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingProduceRequests.clear();
    this.peers.clear();
    this.pendingNewProducers = [];
    this.state = {
      connectionState: "disconnected",
      isDeviceLoaded: false,
      isSendTransportCreated: false,
      sendTransportConnected: false,
      recvTransportConnected: false,
      audioProducerId: null,
      videoProducerId: null,
      screenProducerId: null,
      isScreenShareBlocked: false,
      capabilities: [],
      egress: null,
      lastBroadcast: null,
    };
    this.notifyStateChange();
  }

  private updateState(partial: Partial<SfuState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    this.stateCallbacks.forEach((callback) => {
      callback(this.getState());
    });
  }
}

/**
 * Reads the room id (`sub` claim) from an unverified room token. The server
 * verifies the signature; this only routes the join to the right room.
 */
export function readRoomIdFromToken(token: string): string | null {
  try {
    const [, payloadPart] = token.split(".");
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

/** Singleton instance for backward compatibility */
export const sfuManager = new SfuManager();
