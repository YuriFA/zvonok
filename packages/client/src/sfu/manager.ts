/**
 * SFU manager facade.
 * Composes the session, publish, and subscribe units with the connection,
 * event router, and stats collector into a unified interface.
 */

import { Device } from "mediasoup-client";
import type {
  DtlsParameters,
  MediaKind,
  Producer,
  RtpCapabilities,
  RtpParameters,
  Transport,
} from "mediasoup-client/types";

import type { Socket } from "socket.io-client";

import { SfuActions } from "./actions.js";
import { SfuConnection } from "./connection.js";
import { SfuEventRouter, type SfuEventHandlers } from "./event-router.js";
import { SfuPublish } from "./publish.js";
import { SfuSession } from "./session.js";
import { SfuStatsCollector } from "./stats-collector.js";
import { SfuSubscribe } from "./subscribe.js";
import { createLogger } from "../helpers/logger.js";
import type {
  SfuState,
  SfuJoinPayload,
  SfuJoinOptions,
  SfuTransportCreatedPayload,
  SfuKickedPayload,
  SfuRoomEndedPayload,
  SfuRoomMediaResetPayload,
  SfuParticipantInfo,
  SfuParticipantJoinedPayload,
  SfuExistingParticipantsPayload,
  SfuPeerMediaDetachedPayload,
  QualityStatsCallback,
  PeerQualityStats,
  SfuStateCallback,
  SfuTrackCallback,
  SfuParticipantCallback,
  SfuProducerStateCallback,
  SimulcastSpatialLayer,
  SfuProduceErrorCode,
  SfuMediaSource,
  SfuScreenShareStoppedPayload,
  SfuScreenShareStoppedCallback,
  SfuGuestJoinRequestPayload,
  SfuJoinError,
  SfuReconnectError,
  SfuEgressOutputRequest,
  SfuBroadcastMessage,
} from "./types.js";

/**
 * The SFU connection facade: one deep module composing the session (join
 * and recovery), publish, and subscribe units together with the
 * connection, request-side actions, event router, and stats collector.
 * The facade owns what the units share: the mediasoup device, the
 * send/recv transports, and the participant registry. Transport
 * management is internal and deliberately not part of the public surface.
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
  private peers = new Map<string, SfuParticipantInfo>();
  private localUserId: string | null = null;

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
  private peerJoinedCallbacks = new Set<SfuParticipantCallback>();
  private peerLeftCallbacks = new Set<(userId: string) => void>();
  private peerMediaDetachedCallbacks = new Set<
    (peer: SfuParticipantInfo) => void
  >();
  private kickedCallbacks = new Set<(payload: SfuKickedPayload) => void>();
  private roomEndedCallbacks = new Set<
    (payload: SfuRoomEndedPayload) => void
  >();
  private roomMediaResetCallbacks = new Set<
    (payload: SfuRoomMediaResetPayload) => void
  >();

  // Publish unit: local track production and producer bookkeeping.
  private readonly publish = new SfuPublish({
    getSocket: () => this.connection.getSocket(),
    isConnected: () => this.connection.isConnected(),
    getSendTransport: () => this.sendTransport,
    updateState: (partial) => this.updateState(partial),
  });

  // Subscribe unit: remote media consumption and consumer bookkeeping.
  private readonly subscribe = new SfuSubscribe({
    getSocket: () => this.connection.getSocket(),
    getDevice: () => this.device,
    getRecvTransport: () => this.recvTransport,
    getPeers: () => this.peers,
    getLocalUserId: () => this.localUserId,
    updateState: (partial) => this.updateState(partial),
    notifyPeerJoined: (peer) => {
      this.peerJoinedCallbacks.forEach((callback) => {
        callback(peer);
      });
    },
    notifyProducerState: (payload) => this.publish.notifyProducerState(payload),
  });

  // Session unit: join lifecycle and automatic recovery.
  private readonly session = new SfuSession({
    getSocket: () => this.connection.getSocket(),
    updateState: (partial) => this.updateState(partial),
    setLocalUserId: (userId) => {
      this.localUserId = userId;
    },
    loadDevice: (routerRtpCapabilities) =>
      this.loadDevice(routerRtpCapabilities),
    closeAll: () => this.closeAll(),
    resetMediaState: () => this.resetMediaState(),
    retainLocalProduces: () => this.publish.retainLocalProduces(),
    replayRetainedProduces: () => this.publish.replayRetainedProduces(),
    clearRetainedLocalProduces: () => this.publish.clearRetainedProduces(),
    handleKicked: (payload) => this.handleKicked(payload),
  });

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
      () => this.subscribe.getConsumerEntries(),
      (producerId) => this.subscribe.findPeerForProducer(producerId),
    );
  }

  private createEventHandlers(): SfuEventHandlers {
    return {
      onConnected: () => this.session.handleConnected(),
      onDisconnected: () => this.session.handleDisconnected(),
      onReconnectFailed: () => this.session.handleReconnectFailed(),
      onJoined: (p) => this.session.handleJoined(p),
      onTransportCreated: (p) => this.handleTransportCreated(p),
      onTransportConnected: (p) => this.handleTransportConnected(p),
      onProducerCreated: (p) => this.publish.handleProducerCreated(p),
      onProduceError: (p) => this.publish.handleProduceError(p),
      onJoinError: (p) => this.session.handleJoinError(p),
      onParticipantJoined: (p) => this.handlePeerJoined(p),
      onExistingParticipants: (p) => this.handleExistingPeers(p),
      onNewProducer: (p) => this.subscribe.handleNewProducer(p),
      onConsumerCreated: (p) => this.subscribe.handleConsumerCreated(p),
      onConsumerClosed: (p) => this.subscribe.handleConsumerClosed(p),
      onProducerStateChanged: (p) => this.publish.handleProducerStateChanged(p),
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
    if (!this.session.hasRecoverableSession()) return;

    this.log.warn("[SFU] Room media reset - rebuilding media session");
    for (const callback of this.roomMediaResetCallbacks) {
      callback(payload);
    }

    this.publish.retainLocalProduces();
    this.closeAll();
    this.resetMediaState();
    // loadDevice emits create-send/recv-transport. The new recv transport
    // triggers the server to re-announce the room's producers as they
    // re-publish; retained local tracks replay through the produce path.
    await this.loadDevice(payload.routerRtpCapabilities);
    this.publish.replayRetainedProduces();
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
    await this.session.joinRoom(payload, options);
  }

  leaveRoom(): void {
    const socket = this.connection.getSocket();
    if (socket) {
      socket.emit("sfu:leave");
    }
    this.session.clearSession();
    this.closeAll();
  }

  getLocalUserId(): string | null {
    return this.localUserId;
  }

  hasJoinedSession(): boolean {
    return this.session.hasJoinedSession();
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
    return this.publish.produce(track, { isMobile });
  }

  async produceScreen(track: MediaStreamTrack): Promise<Producer | null> {
    return this.publish.produceScreen(track);
  }

  closeScreenProducer(): void {
    this.publish.closeScreenProducer();
  }

  isScreenShareBlocked(): boolean {
    return this.state.isScreenShareBlocked;
  }

  onProduceError(callback: (code: SfuProduceErrorCode) => void): () => void {
    return this.publish.onProduceError(callback);
  }

  onJoinError(callback: (error: SfuJoinError) => void): () => void {
    return this.session.onJoinError(callback);
  }

  onReconnectError(callback: (error: SfuReconnectError) => void): () => void {
    return this.session.onReconnectError(callback);
  }

  pauseProducer(producerId: string): void {
    this.publish.pauseProducer(producerId);
  }

  resumeProducer(producerId: string): void {
    this.publish.resumeProducer(producerId);
  }

  closeProducer(kind: "audio" | "video"): void {
    this.publish.closeProducer(kind);
  }

  async replaceTrack(
    kind: "audio" | "video",
    newTrack: MediaStreamTrack | null,
  ): Promise<boolean> {
    return this.publish.replaceTrack(kind, newTrack);
  }

  getProducerByKind(kind: "audio" | "video"): Producer | undefined {
    return this.publish.getProducerByKind(kind);
  }

  setPreferredLayers(
    consumerId: string,
    spatialLayer: SimulcastSpatialLayer,
  ): void {
    this.subscribe.setPreferredLayers(consumerId, spatialLayer);
  }

  getVideoConsumerIdForUserId(userId: string): string | undefined {
    return this.subscribe.getVideoConsumerIdForUserId(userId);
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
    return this.subscribe.onTrack(callback);
  }

  onScreenShareStopped(callback: SfuScreenShareStoppedCallback): () => void {
    return this.subscribe.onScreenShareStopped(callback);
  }

  onGuestJoinRequest(
    callback: (payload: SfuGuestJoinRequestPayload) => void,
  ): () => void {
    return this.actions.onGuestJoinRequest(callback);
  }

  onProducerStateChange(callback: SfuProducerStateCallback): () => void {
    return this.publish.onProducerStateChange(callback);
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

            const promise = this.publish.createProduceRequest(
              requestId,
              source ?? "camera",
            );

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
      this.publish.flushPendingProduces();
    } else {
      this.recvTransport = this.device.createRecvTransport(transportOptions);

      // Replay any producers that arrived before the recv transport was ready
      this.subscribe.flushPendingProducers();

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

  private handlePeerLeft(payload: { userId: string }): void {
    this.log.debug("[SFU] Peer left:", payload.userId);
    const peer = this.peers.get(payload.userId);
    if (peer) {
      // Close consumers for this peer
      this.subscribe.closeConsumersForPeer(peer);
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
    this.session.clearSession();
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
    this.session.clearSession();
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
      this.subscribe.notifyScreenShareStopped(payload);
    }
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

  /** Post-teardown media reset: drop the device and buffered producers. */
  private resetMediaState(): void {
    this.device = null;
    this.subscribe.clearPendingProducers();
  }

  private closeAll(): void {
    this.publish.closeAll();
    this.subscribe.closeAll();
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

  private resetState(): void {
    this.session.clearSession();
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.publish.resetState();
    this.subscribe.resetState();
    this.peers.clear();
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
 * Reads the room id (`sub` claim) from an unverified room token. Moved to
 * the session unit with the join flow; re-exported so the
 * `@zvonok/client/sfu/manager` surface is unchanged.
 */
export { readRoomIdFromToken } from "./session.js";

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
