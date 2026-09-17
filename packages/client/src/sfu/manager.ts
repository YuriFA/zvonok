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

import { SfuActions } from "./actions.js";
import { SfuConnection } from "./connection.js";
import { SfuEventRouter, type SfuEventHandlers } from "./event-router.js";
import { SfuStatsCollector } from "./stats-collector.js";
import { singleFlight, withoutConcurrency } from "../helpers/concurrency.js";
import { createLogger } from "../helpers/logger.js";
import type {
  SfuState,
  SfuJoinedPayload,
  SfuTransportCreatedPayload,
  SfuNewProducerPayload,
  SfuConsumerCreatedPayload,
  SfuProducerCreatedPayload,
  SfuJoinOptions,
  SfuJoinPayload,
  SfuKickedPayload,
  SfuRoomEndedPayload,
  SfuRoomMediaResetPayload,
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
  SfuPeerMediaDetachedPayload,
  SfuScreenShareStoppedPayload,
  SfuScreenShareStoppedCallback,
  SfuGuestJoinRequestPayload,
  SfuJoinErrorPayload,
  SfuEgressOutputRequest,
  SfuBroadcastMessage,
} from "./types.js";
import {
  SfuProduceError,
  SfuJoinError,
  SfuReconnectError,
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

/** Rejoin storm guard: no more than this many rejoins per sliding window. */
const REJOIN_WINDOW_MS = 30_000;
const REJOIN_MAX_PER_WINDOW = 5;

/**
 * The SFU connection facade: one deep module owning connection, room
 * membership, host controls, egress control, the data channel, producer
 * lifecycle, the participant registry, stats, and state notification.
 * Transport management (device, send/recv transports) is internal and
 * deliberately not part of the public surface.
 *
 * Construct via {@link createSfuManager}; composition is not a consumer
 * concern. The room member is named a participant uniformly across the
 * public surface. Identity is always server-derived: platform consumers
 * pass a room token, app-embedded consumers rely on the verified browser
 * session; join refusals surface as coded SfuJoinError values.
 */
export class SfuManager {
  private readonly log = createLogger("sfu");
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
  private peerMediaDetachedCallbacks = new Set<
    (peer: SfuParticipantInfo) => void
  >();
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
  private roomMediaResetCallbacks = new Set<
    (payload: SfuRoomMediaResetPayload) => void
  >();
  private reconnectErrorCallbacks = new Set<
    (error: SfuReconnectError) => void
  >();

  // Automatic recovery: the last accepted join payload is replayed after a
  // signalling drop, so the session survives blips without consumer action.
  private lastJoinPayload: SfuJoinPayload | null = null;
  /** True once a join succeeded; disconnects then enter recovery. */
  private sessionEstablished = false;
  private joinOptions: SfuJoinOptions | null = null;
  /** One token refresh attempt per rejoin. */
  private tokenRefreshAttempted = false;
  /** Timestamps of recent rejoins for the sliding-window rate limit. */
  private rejoinTimes: number[] = [];
  /** Live local tracks + produce intents held across a reconnect blip. */
  private retainedLocalProduces: Array<{
    track: MediaStreamTrack;
    source?: SfuMediaSource;
    options: { isMobile?: boolean };
  }> = [];

  // Request-side actions: host controls, egress control, data channel.
  private readonly actions = new SfuActions({
    getSocket: () => this.connection.getSocket(),
    updateState: (partial) => this.updateState(partial),
  });

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
      onPeerMediaDetached: (p) => this.handlePeerMediaDetached(p),
      onKicked: (p) => this.handleKicked(p),
      onRoomEnded: (p) => this.handleRoomEnded(p),
      onScreenShareStarted: (p) => this.handleScreenShareStarted(p),
      onScreenShareStopped: (p) => this.handleScreenShareStopped(p),
      onRoomMediaReset: (p) => this.handleRoomMediaReset(p),
      onGuestJoinRequest: (p) => this.actions.handleGuestJoinRequest(p),
      onEgressStatus: (p) => this.actions.handleEgressStatus(p),
      onBroadcast: (p) => this.actions.handleBroadcast(p),
    };
  }

  onRoomMediaReset(
    callback: (payload: SfuRoomMediaResetPayload) => void,
  ): () => void {
    this.roomMediaResetCallbacks.add(callback);
    return () => this.roomMediaResetCallbacks.delete(callback);
  }

  /**
   * Server-side media plane was lost (SFU worker crash) and rebuilt:
   * rebuild this side without a new join. Live local tracks are retained
   * and re-published, producers announced on the rebuilt recv transport
   * are re-consumed, and presence/chat/room state is untouched.
   */
  private async handleRoomMediaReset(
    payload: SfuRoomMediaResetPayload,
  ): Promise<void> {
    // Pre-join reset: the join flow builds media from scratch anyway.
    if (!this.sessionEstablished || !this.lastJoinPayload) return;

    this.log.warn("[SFU] Room media reset - rebuilding media session");
    for (const callback of this.roomMediaResetCallbacks) {
      callback(payload);
    }

    this.retainLocalProduces();
    this.closeAll();
    this.device = null;
    this.pendingNewProducers = [];
    // loadDevice emits create-send/recv-transport. The new recv transport
    // triggers the server to re-announce the room's producers as they
    // re-publish; retained local tracks replay through the produce path.
    await this.loadDevice(payload.routerRtpCapabilities);
    this.replayRetainedProduces();
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
  async joinRoom(
    payload: SfuJoinPayload,
    options?: SfuJoinOptions,
  ): Promise<void> {
    const socket = this.connection.getSocket();
    if (!socket) {
      throw new Error("Socket not connected");
    }
    this.joinOptions = options ?? this.joinOptions;
    this.lastJoinPayload = payload;
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
    this.clearSession();
    this.closeAll();
  }

  getLocalUserId(): string | null {
    return this.localUserId;
  }

  /** True once a join succeeded and the session was not terminated; a
   * connected socket with this false still needs an explicit joinRoom. */
  hasJoinedSession(): boolean {
    return this.sessionEstablished;
  }
  // ISfuHostControls
  async mutePeer(
    userId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.actions.mutePeer(userId, options);
  }

  async muteAll(options?: { timeoutMs?: number }): Promise<void> {
    await this.actions.muteAll(options);
  }

  async lockRoom(
    locked: boolean,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.actions.lockRoom(locked, options);
  }

  async kickPeer(
    userId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.actions.kickPeer(userId, options);
  }

  // Egress control (client-initiated sessions; RTMP stays server-side)
  async startEgress(
    outputs: SfuEgressOutputRequest,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.actions.startEgress(outputs, options);
  }

  async stopEgress(options?: { timeoutMs?: number }): Promise<void> {
    await this.actions.stopEgress(options);
  }

  // Data channel (ephemeral topic-scoped broadcasts)
  async sendBroadcast(
    topic: string,
    payload: unknown,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    await this.actions.sendBroadcast(topic, payload, options);
  }

  onBroadcast(callback: (message: SfuBroadcastMessage) => void): () => void {
    return this.actions.onBroadcast(callback);
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
    if (!this.sendTransport) return null;

    try {
      const isVideo = track.kind === "video";
      const isScreen = source === "screen";
      const producer = await this.sendTransport.produce({
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

  /** Subscribe to automatic-recovery failures (exhausted retries,
   * terminal rejoin denials). Returns an unsubscribe function. */
  onReconnectError(callback: (error: SfuReconnectError) => void): () => void {
    this.reconnectErrorCallbacks.add(callback);
    return () => this.reconnectErrorCallbacks.delete(callback);
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

  onPeerMediaDetached(
    callback: (peer: SfuParticipantInfo) => void,
  ): () => void {
    this.peerMediaDetachedCallbacks.add(callback);
    return () => this.peerMediaDetachedCallbacks.delete(callback);
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
    return this.actions.onGuestJoinRequest(callback);
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
    this.log.info("[SFU] Connected");
    if (this.sessionEstablished && this.lastJoinPayload) {
      // socket.io reconnected mid-session: replay the join pipeline and
      // keep the reconnecting status until the join ack lands. A
      // sliding-window rate limit stops endless flapping from looping the
      // rejoin forever; exceeding it fails recovery like a socket
      // exhaustion would.
      if (!this.allowRejoin()) {
        this.failRecovery(
          new SfuReconnectError(
            "RECONNECT_EXHAUSTED",
            "Too many rejoin attempts in a short window",
          ),
        );
        return;
      }
      this.tokenRefreshAttempted = false;
      void this.joinRoom(this.lastJoinPayload).catch(() => undefined);
      return;
    }
    this.updateState({ connectionState: "connected" });
  }

  /** Sliding-window rejoin budget; false when this rejoin exceeds it. */
  private allowRejoin(): boolean {
    const now = Date.now();
    this.rejoinTimes = this.rejoinTimes.filter((t) => now - t < REJOIN_WINDOW_MS);
    if (this.rejoinTimes.length >= REJOIN_MAX_PER_WINDOW) {
      this.log.warn("[SFU] Rejoin rate limit reached, giving up recovery");
      return false;
    }
    this.rejoinTimes.push(now);
    return true;
  }

  private handleDisconnected(): void {
    this.log.info("[SFU] Disconnected");
    const recovering = this.sessionEstablished && this.lastJoinPayload !== null;
    this.updateState({
      connectionState: recovering ? "reconnecting" : "connecting",
    });
    if (recovering) {
      this.retainLocalProduces();
    }
    this.closeAll();
    this.device = null;
    this.pendingNewProducers = [];
  }

  /**
   * Holds live local tracks and buffered produce intents across the blip:
   * they replay through the rebuilt join pipeline after the rejoin ack.
   * Tracks are never re-acquired (no getUserMedia) and never stopped here.
   */
  private retainLocalProduces(): void {
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

  private replayRetainedProduces(): void {
    if (this.retainedLocalProduces.length === 0) return;
    const retained = this.retainedLocalProduces.splice(0);
    this.log.info("[SFU] Replaying",
    retained.length,
    "retained local produce(s)",);
    for (const entry of retained) {
      void this.produceWithSource(entry.track, entry.source, entry.options);
    }
  }

  private handleReconnectFailed(): void {
    this.log.warn("[SFU] Reconnect failed");
    if (this.sessionEstablished && this.lastJoinPayload) {
      this.failRecovery(
        new SfuReconnectError(
          "RECONNECT_EXHAUSTED",
          "Could not re-establish the signalling connection",
        ),
      );
      return;
    }
    this.updateState({ connectionState: "failed" });
  }

  private async handleJoined(payload: SfuJoinedPayload): Promise<void> {
    this.log.info("[SFU] Joined room, loading device...");
    // The server echoes back the verified identity and the effective
    // capabilities; payload identity is never trusted and rights are never
    // decoded from the token client-side.
    this.localUserId = payload.participant?.id ?? null;
    this.updateState({ capabilities: payload.capabilities ?? [] });
    if (this.sessionEstablished) {
      // Recovery complete: back to connected; retained tracks re-produce
      // through the rebuilt pipeline (buffered until the transport exists).
      this.updateState({ connectionState: "connected" });
      this.replayRetainedProduces();
    }
    this.sessionEstablished = true;
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
    } else {
      this.recvTransport = this.device.createRecvTransport(transportOptions);

      // Replay any producers that arrived before the recv transport was ready
      if (this.pendingNewProducers.length > 0) {
        const pending = this.pendingNewProducers.splice(0);
        this.log.debug("[SFU] Processing",
        pending.length,
        "buffered new-producer(s)",);
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
    this.log.debug("[SFU] Transport connected:", payload.transportId);
    if (this.sendTransport?.id === payload.transportId) {
    } else if (this.recvTransport?.id === payload.transportId) {
    }
  }

  private handleProducerCreated(payload: SfuProducerCreatedPayload): void {
    const { requestId, producerId, kind, appData } = payload;
    const source = appData?.source;

    this.log.debug("[SFU] Producer created:", kind, producerId, source ?? "");

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

  private handleJoinError(payload: SfuJoinErrorPayload): void {
    this.log.error("[SFU] Join error:", payload.code, payload.message);
    const error = new SfuJoinError(payload.code, payload.message);

    if (this.sessionEstablished && this.lastJoinPayload) {
      // A rejoin denial during recovery: kicked is terminal, an expired
      // token retries once through the provider, anything else stops.
      if (payload.code === "KICKED_FROM_ROOM") {
        this.handleKicked({ roomId: this.lastJoinPayload.roomId });
        return;
      }
      if (payload.code === "ROOM_TOKEN_EXPIRED") {
        void this.refreshTokenAndRejoin(error);
        return;
      }
      this.failRecovery(error);
      return;
    }

    for (const cb of this.joinErrorCallbacks) {
      cb(error);
    }
  }

  /** One provider retry per rejoin; any further denial fails typed. */
  private async refreshTokenAndRejoin(error: SfuJoinError): Promise<void> {
    const provider = this.joinOptions?.tokenProvider;
    if (!provider || this.tokenRefreshAttempted) {
      this.failRecovery(error);
      return;
    }
    this.tokenRefreshAttempted = true;
    try {
      const token = await provider();
      if (!this.lastJoinPayload) return;
      this.lastJoinPayload = { ...this.lastJoinPayload, token };
      await this.joinRoom(this.lastJoinPayload);
    } catch (providerError) {
      this.failRecovery(
        new SfuJoinError(
          "ROOM_TOKEN_EXPIRED",
          `Token provider failed: ${providerError instanceof Error ? providerError.message : "unknown error"}`,
        ),
      );
    }
  }

  /** Terminal recovery failure: stop retrying, fail typed, release state. */
  private failRecovery(error: SfuJoinError | SfuReconnectError): void {
    this.clearSession();
    this.closeAll();
    this.updateState({ connectionState: "failed" });
    if (error instanceof SfuJoinError) {
      for (const cb of this.joinErrorCallbacks) {
        cb(error);
      }
      return;
    }
    for (const cb of this.reconnectErrorCallbacks) {
      cb(error);
    }
  }

  private handlePeerJoined(payload: SfuParticipantJoinedPayload): void {
    this.log.debug("[SFU] Peer joined:", payload.userId, payload.username);
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
      // A (re)joining peer's media is live again after a detach.
      peer.mediaConnected = true;
    }
    this.peerJoinedCallbacks.forEach((callback) => {
      callback(peer!);
    });
  }

  private handleExistingPeers(peers: SfuExistingParticipantsPayload[]): void {
    this.log.debug("[SFU] Existing peers:", peers.length);
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
        // A peer present in existing-peers has live membership.
        peer.mediaConnected = true;
      }
      this.peerJoinedCallbacks.forEach((callback) => {
        callback(peer!);
      });
    }
  }

  private handleNewProducer(payload: SfuNewProducerPayload): void {
    this.log.debug("[SFU] New producer:", payload.userId, payload.kind);
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
      this.log.debug("[SFU] Consumer ready:", payload.kind, consumer.id);

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
      this.log.error("[SFU] Failed to create consumer:", error);
    }
  }

  private handleProducerStateChanged(
    payload: SfuProducerStateChangedPayload,
  ): void {
    this.log.debug("[SFU] Producer state changed:",
    payload.userId,
    payload.kind,
    payload.paused ? "paused" : "resumed",);
    this.producerStateCallbacks.forEach((callback) => {
      callback(payload);
    });
  }

  private handlePeerLeft(payload: { userId: string }): void {
    this.log.debug("[SFU] Peer left:", payload.userId);
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
    this.log.debug("[SFU] Kicked from room:", payload.roomId);
    this.kickedCallbacks.forEach((callback) => {
      callback(payload);
    });
    this.clearSession();
    this.closeAll();
    // Kick is terminal: stop socket.io reconnection attempts so the dead
    // session cannot idle back into a connected-but-roomless socket.
    this.connection.disconnect();
    this.eventRouter.teardown();
    this.updateState({ connectionState: "disconnected" });
  }

  private handleRoomEnded(payload: SfuRoomEndedPayload): void {
    this.log.debug("[SFU] Room ended:", payload.roomId);
    for (const callback of this.roomEndedCallbacks) {
      callback(payload);
    }
    this.clearSession();
    this.closeAll();
    this.updateState({ connectionState: "disconnected" });
  }

  private handleScreenShareStarted(payload: { userId: string }): void {
    this.log.debug("[SFU] Screen share started:", payload.userId);
    if (payload.userId !== this.localUserId) {
      this.updateState({ isScreenShareBlocked: true });
    }
  }

  private handleScreenShareStopped(
    payload: SfuScreenShareStoppedPayload,
  ): void {
    this.log.debug("[SFU] Screen share stopped:", payload.userId);
    if (payload.userId !== this.localUserId) {
      this.updateState({ isScreenShareBlocked: false });
      // Notify subscribers so they can clear the remote peer's screen state
      // immediately, without waiting for track.onended.
      for (const cb of this.screenShareStoppedCallbacks) {
        cb(payload);
      }
    }
  }

  private handleConsumerClosed(payload: SfuConsumerClosedPayload): void {
    this.log.debug("[SFU] Consumer closed by server:", payload.consumerId);
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
      this.log.debug("[SFU] Device loaded");

      // Create transports after device is loaded
      await this.createTransports();
    } catch (error) {
      this.log.error("[SFU] Failed to load device:", error);
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
      this.log.warn("[SFU] Recv transport not ready, buffering new-producer:",
      payload.producerId,);
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

    // Media from this peer is flowing again after any detach.
    peer.mediaConnected = true;

    // Request to consume
    this.connection.getSocket()!.emit("sfu:consume", {
      producerId: payload.producerId,
      rtpCapabilities: this.device.recvRtpCapabilities,
    });
  }

  private handlePeerMediaDetached(payload: SfuPeerMediaDetachedPayload): void {
    this.log.debug("[SFU] Peer media detached:", payload.userId);
    const peer = this.peers.get(payload.userId);
    if (!peer || peer.mediaConnected === false) {
      return;
    }
    peer.mediaConnected = false;
    this.peerMediaDetachedCallbacks.forEach((callback) => {
      callback(peer);
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
      audioProducerId: null,
      videoProducerId: null,
      screenProducerId: null,
      isScreenShareBlocked: false,
    });
  }

  /** Drops all recovery bookkeeping: the session is intentionally over. */
  private clearSession(): void {
    this.sessionEstablished = false;
    this.lastJoinPayload = null;
    this.tokenRefreshAttempted = false;
    this.rejoinTimes = [];
    this.retainedLocalProduces = [];
  }

  private resetState(): void {
    this.clearSession();
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

/** Options for {@link createSfuManager}. */
export interface SfuManagerOptions {
  /** Base URL of the Zvonok SFU server, e.g. "https://sfu.example.com". */
  serverUrl?: string;
  /**
   * Connection override for tests and custom transports. Omit it to get
   * the standard socket.io connection with cookie credentials.
   */
  connection?: SfuConnection;
}

/**
 * Builds a ready-to-use SfuManager, composing its own connection.
 * The identity is never passed here: the server derives it from the room
 * token in the join payload or from the verified browser session.
 */
export function createSfuManager(options: SfuManagerOptions = {}): SfuManager {
  return new SfuManager(
    options.connection ?? new SfuConnection(options.serverUrl),
  );
}

/** Singleton instance for backward compatibility */
export const sfuManager = new SfuManager();
