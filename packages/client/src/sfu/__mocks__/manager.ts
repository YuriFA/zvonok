/**
 * Mock SFU manager for testing.
 * Implements ISfuManager interface with controllable behavior.
 */

import type { Producer } from "mediasoup-client/types";
import type { Socket } from "socket.io-client";

import type { ISfuManager } from "../interfaces.js";
import type {
  SfuState,
  SfuStateCallback,
  SfuTrackCallback,
  SfuParticipantCallback,
  SfuParticipantInfo,
  SfuKickedPayload,
  SfuRoomEndedPayload,
  SfuJoinPayload,
  QualityStatsCallback,
  PeerQualityStats,
  QualityScore,
  SfuProducerStateCallback,
  SfuProduceErrorCode,
  SfuScreenShareStoppedCallback,
  SfuBroadcastMessage,
} from "../types.js";

export interface MockSfuManagerConfig {
  initialState?: Partial<SfuState>;
  initialParticipants?: SfuParticipantInfo[];
}

const DEFAULT_STATE: SfuState = {
  connectionState: "disconnected",
  isDeviceLoaded: false,
  isSendTransportCreated: false,
  isScreenShareBlocked: false,
  sendTransportConnected: false,
  recvTransportConnected: false,
  audioProducerId: null,
  videoProducerId: null,
  screenProducerId: null,
  capabilities: [],
  egress: null,
  lastBroadcast: null,
};

export function createMockSfuManager(
  config: MockSfuManagerConfig = {},
): ISfuManager & {
  // Test utilities
  setState(state: Partial<SfuState>): void;
  simulateConnection(): void;
  simulateDisconnection(): void;
  simulateParticipantJoined(peer: SfuParticipantInfo): void;
  simulateParticipantLeft(userId: string): void;
  emitQualityStats(stats: Map<string, PeerQualityStats>): void;
  simulateTrackReceived(
    track: MediaStreamTrack,
    kind: "audio" | "video",
    userId: string,
  ): void;
  simulateKicked(roomId: string): void;
  simulateRoomEnded(roomId: string): void;
  getJoinRoomCalls(): SfuJoinPayload[];
  getProduceCalls(): MediaStreamTrack[];
} {
  const { initialState, initialParticipants = [] } = config;

  let state: SfuState = { ...DEFAULT_STATE, ...initialState };

  const peers = new Map<string, SfuParticipantInfo>();
  initialParticipants.forEach((peer) => {
    peers.set(peer.userId, peer);
  });

  const stateCallbacks = new Set<SfuStateCallback>();
  const trackCallbacks = new Set<SfuTrackCallback>();
  const peerJoinedCallbacks = new Set<SfuParticipantCallback>();
  const peerLeftCallbacks = new Set<(userId: string) => void>();
  const kickedCallbacks = new Set<(payload: SfuKickedPayload) => void>();
  const broadcastCallbacks = new Set<(message: SfuBroadcastMessage) => void>();
  const roomEndedCallbacks = new Set<(payload: SfuRoomEndedPayload) => void>();
  const qualityStatsCallbacks = new Set<QualityStatsCallback>();
  const producerStateCallbacks = new Set<SfuProducerStateCallback>();

  const joinRoomCalls: SfuJoinPayload[] = [];
  const produceCalls: MediaStreamTrack[] = [];

  const producers = new Map<"audio" | "video", Producer>();
  let localUserId: string | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;

  const notifyStateChange = () => {
    stateCallbacks.forEach((cb) => {
      cb(state);
    });
  };

  const createMockQualityScore = (): QualityScore => ({
    level: "excellent",
    score: 100,
  });

  return {
    // ISfuConnection
    connect(): void {
      state = { ...state, connectionState: "connected" };
      notifyStateChange();
    },

    disconnect(): void {
      state = { ...state, connectionState: "disconnected" };
      notifyStateChange();
    },

    isConnected(): boolean {
      return state.connectionState === "connected";
    },

    getSocket(): Socket | null {
      return null;
    },

    // ISfuRoomMembership
    async joinRoom(payload: SfuJoinPayload): Promise<void> {
      joinRoomCalls.push(payload);
      state = { ...state, isSendTransportCreated: true, isDeviceLoaded: true };
      notifyStateChange();
    },

    leaveRoom(): void {
      state = { ...DEFAULT_STATE };
      peers.clear();
      localUserId = null;
      notifyStateChange();
    },

    getLocalUserId(): string | null {
      return localUserId;
    },

    async kickPeer(): Promise<void> {},
    async mutePeer(): Promise<void> {},
    async muteAll(): Promise<void> {},
    async lockRoom(): Promise<void> {},
    async startEgress(): Promise<void> {},
    async stopEgress(): Promise<void> {},
    async sendBroadcast(): Promise<void> {},

    onKicked(callback: (payload: SfuKickedPayload) => void): () => void {
      kickedCallbacks.add(callback);
      return () => kickedCallbacks.delete(callback);
    },

    onRoomEnded(callback: (payload: SfuRoomEndedPayload) => void): () => void {
      roomEndedCallbacks.add(callback);
      return () => roomEndedCallbacks.delete(callback);
    },

    onJoinError(): () => void {
      return () => {};
    },

    // ISfuProducerManager
    async produce(track: MediaStreamTrack): Promise<Producer | null> {
      produceCalls.push(track);
      const kind = track.kind as "audio" | "video";
      const producer = {
        id: `producer-${kind}-${Date.now()}`,
        kind,
        track,
        pause: () => {},
        resume: () => {},
        close: () => {},
      } as unknown as Producer;
      producers.set(kind, producer);
      if (kind === "audio") {
        state = { ...state, audioProducerId: producer.id };
      } else {
        state = { ...state, videoProducerId: producer.id };
      }
      notifyStateChange();
      return producer;
    },

    async produceScreen(track: MediaStreamTrack): Promise<Producer | null> {
      produceCalls.push(track);
      const producer = {
        id: `producer-screen-${Date.now()}`,
        kind: track.kind as "audio" | "video",
        track,
        pause: () => {},
        resume: () => {},
        close: () => {},
      } as unknown as Producer;
      state = { ...state, screenProducerId: producer.id };
      notifyStateChange();
      return producer;
    },

    closeScreenProducer(): void {
      state = { ...state, screenProducerId: null };
      notifyStateChange();
    },

    pauseProducer(producerId: string): void {
      const producer = Array.from(producers.values()).find(
        (p) => p.id === producerId,
      );
      producer?.pause();
    },

    resumeProducer(producerId: string): void {
      const producer = Array.from(producers.values()).find(
        (p) => p.id === producerId,
      );
      producer?.resume();
    },

    closeProducer(kind: "audio" | "video"): void {
      const producer = producers.get(kind);
      producer?.close();
      producers.delete(kind);
      if (kind === "audio") {
        state = { ...state, audioProducerId: null };
      } else {
        state = { ...state, videoProducerId: null };
      }
      notifyStateChange();
    },

    async replaceTrack(): Promise<boolean> {
      return true;
    },

    getProducerByKind(kind: "audio" | "video"): Producer | undefined {
      return producers.get(kind);
    },

    setPreferredLayers(): void {},

    getVideoConsumerIdForUserId(userId: string): string | undefined {
      const peer = peers.get(userId);
      if (!peer) {
        return undefined;
      }

      for (const [consumerId, producer] of peer.producers) {
        if (producer.kind === "video") {
          return consumerId;
        }
      }

      return undefined;
    },

    isScreenShareBlocked(): boolean {
      return state.isScreenShareBlocked;
    },

    onProduceError(callback: (code: SfuProduceErrorCode) => void): () => void {
      const produceErrorCallbacks = new Set<
        (code: SfuProduceErrorCode) => void
      >();
      produceErrorCallbacks.add(callback);
      return () => produceErrorCallbacks.delete(callback);
    },

    // ISfuParticipantRegistry
    getParticipants(): Map<string, SfuParticipantInfo> {
      return new Map(peers);
    },

    getParticipant(userId: string): SfuParticipantInfo | undefined {
      return peers.get(userId);
    },

    onParticipantJoined(callback: SfuParticipantCallback): () => void {
      peerJoinedCallbacks.add(callback);
      return () => peerJoinedCallbacks.delete(callback);
    },

    onParticipantLeft(callback: (userId: string) => void): () => void {
      peerLeftCallbacks.add(callback);
      return () => peerLeftCallbacks.delete(callback);
    },

    // ISfuStatsCollector
    startStatsCollection(intervalMs = 2000): void {
      if (statsInterval) {
        clearInterval(statsInterval);
      }
      statsInterval = setInterval(() => {
        const stats = new Map<string, PeerQualityStats>();
        peers.forEach((_peer, userId) => {
          stats.set(userId, {
            userId,
            stats: {
              bitrate: 1000,
              packetLoss: 0,
              rtt: 10,
              jitter: 5,
              width: 1280,
              height: 720,
              fps: 30,
            },
            score: createMockQualityScore(),
          });
        });
        qualityStatsCallbacks.forEach((cb) => {
          cb(stats);
        });
      }, intervalMs);
    },

    stopStatsCollection(): void {
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
    },

    onQualityStats(callback: QualityStatsCallback): () => void {
      qualityStatsCallbacks.add(callback);
      return () => qualityStatsCallbacks.delete(callback);
    },

    getStats(): Map<string, PeerQualityStats> {
      const stats = new Map<string, PeerQualityStats>();
      peers.forEach((_peer, userId) => {
        stats.set(userId, {
          userId,
          stats: {
            bitrate: 1000,
            packetLoss: 0,
            rtt: 10,
            jitter: 5,
            width: 1280,
            height: 720,
            fps: 30,
          },
          score: createMockQualityScore(),
        });
      });
      return stats;
    },

    // ISfuStateNotifier
    getState(): SfuState {
      return state;
    },

    onBroadcast(callback: (message: SfuBroadcastMessage) => void): () => void {
      broadcastCallbacks.add(callback);
      return () => broadcastCallbacks.delete(callback);
    },

    onStateChange(callback: SfuStateCallback): () => void {
      stateCallbacks.add(callback);
      return () => stateCallbacks.delete(callback);
    },

    onTrack(callback: SfuTrackCallback): () => void {
      trackCallbacks.add(callback);
      return () => trackCallbacks.delete(callback);
    },

    onScreenShareStopped(callback: SfuScreenShareStoppedCallback): () => void {
      const screenShareStoppedCallbacks =
        new Set<SfuScreenShareStoppedCallback>();
      screenShareStoppedCallbacks.add(callback);
      return () => screenShareStoppedCallbacks.delete(callback);
    },

    onProducerStateChange(callback: SfuProducerStateCallback): () => void {
      producerStateCallbacks.add(callback);
      return () => producerStateCallbacks.delete(callback);
    },

    // Test utilities
    setState(partialState: Partial<SfuState>): void {
      state = { ...state, ...partialState };
      notifyStateChange();
    },

    simulateConnection(): void {
      state = { ...state, connectionState: "connected" };
      notifyStateChange();
    },

    simulateDisconnection(): void {
      state = { ...state, connectionState: "disconnected" };
      notifyStateChange();
    },

    simulateParticipantJoined(peer: SfuParticipantInfo): void {
      peers.set(peer.userId, peer);
      peerJoinedCallbacks.forEach((cb) => {
        cb(peer);
      });
    },

    simulateParticipantLeft(userId: string): void {
      peers.delete(userId);
      peerLeftCallbacks.forEach((cb) => {
        cb(userId);
      });
    },

    emitQualityStats(stats: Map<string, PeerQualityStats>): void {
      qualityStatsCallbacks.forEach((cb) => {
        cb(new Map(stats));
      });
    },

    simulateTrackReceived(
      track: MediaStreamTrack,
      kind: "audio" | "video",
      userId: string,
    ): void {
      trackCallbacks.forEach((cb) => {
        cb(track, kind, userId);
      });
    },

    simulateKicked(roomId: string): void {
      kickedCallbacks.forEach((cb) => {
        cb({ roomId });
      });
    },

    simulateRoomEnded(roomId: string): void {
      roomEndedCallbacks.forEach((cb) => {
        cb({ roomId });
      });
    },

    getJoinRoomCalls(): SfuJoinPayload[] {
      return [...joinRoomCalls];
    },

    getProduceCalls(): MediaStreamTrack[] {
      return [...produceCalls];
    },
  };
}
