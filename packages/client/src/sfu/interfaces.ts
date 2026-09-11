/**
 * SFU module interfaces.
 * These interfaces define the contracts for SFU management components,
 * following SOLID principles with single-responsibility interfaces.
 */

import type { Producer } from "mediasoup-client/types";
import type { Socket } from "socket.io-client";

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
  SfuProducerStateCallback,
  SimulcastSpatialLayer,
  SfuProduceErrorCode,
  SfuJoinError,
  SfuScreenShareStoppedCallback,
} from "./types.js";

/**
 * Responsible for socket connection lifecycle.
 * Single responsibility: connect/disconnect/reconnect.
 */
interface ISfuConnection {
  /** Connect to SFU server */
  connect(): void;
  /** Disconnect from SFU server */
  disconnect(): void;
  /** Check if connected */
  isConnected(): boolean;
  /** Get the underlying socket */
  getSocket(): Socket | null;
}

/**
 * Responsible for room join/leave operations.
 * Single responsibility: room membership signaling.
 */
interface ISfuRoomMembership {
  /** Join a room */
  joinRoom(payload: SfuJoinPayload): Promise<void>;
  /** Leave the current room */
  leaveRoom(): void;
  /** Server-verified id of the local participant; null before a successful join */
  getLocalUserId(): string | null;
  /** Subscribe to kicked events */
  onKicked(callback: (payload: SfuKickedPayload) => void): () => void;
  /** Subscribe to room-ended events */
  onRoomEnded(callback: (payload: SfuRoomEndedPayload) => void): () => void;
  /** Subscribe to server-refused joins */
  onJoinError(callback: (error: SfuJoinError) => void): () => void;
}

/**
 * Responsible for host-control actions.
 * Single responsibility: capability-guarded room moderation signalling.
 */
interface ISfuHostControls {
  /** Mute a single participant (requires mute-users). */
  mutePeer(userId: string, options?: { timeoutMs?: number }): Promise<void>;
  /** Mute every publishing participant except the caller (mute-users). */
  muteAll(options?: { timeoutMs?: number }): Promise<void>;
  /** Lock or unlock the room (lock-room). */
  lockRoom(locked: boolean, options?: { timeoutMs?: number }): Promise<void>;
  /** Kick a participant; resolves after the server confirms the removal. */
  kickPeer(userId: string, options?: { timeoutMs?: number }): Promise<void>;
}

/**
 * Responsible for client-initiated egress control.
 * Single responsibility: capability-gated egress session signalling.
 */
interface ISfuEgressControls {
  /** Start a client-initiated session with record and/or HLS outputs. */
  startEgress(
    outputs: { record?: boolean; hls?: boolean },
    options?: { timeoutMs?: number },
  ): Promise<void>;
  /** Stop the room's active session. */
  stopEgress(options?: { timeoutMs?: number }): Promise<void>;
}

/**
 * Responsible for producing local tracks.
 * Single responsibility: producer lifecycle.
 */
interface ISfuProducerManager {
  /** Produce a local track */
  produce(
    track: MediaStreamTrack,
    params?: { isMobile?: boolean },
  ): Promise<Producer | null>;
  /** Produce a screen share track */
  produceScreen(track: MediaStreamTrack): Promise<Producer | null>;
  /** Close the screen share producer */
  closeScreenProducer(): void;
  /** Pause a producer */
  pauseProducer(producerId: string): void;
  /** Resume a producer */
  resumeProducer(producerId: string): void;
  /** Close a producer by kind */
  closeProducer(kind: "audio" | "video"): void;
  /** Replace track in a producer */
  replaceTrack(
    kind: "audio" | "video",
    track: MediaStreamTrack | null,
  ): Promise<boolean>;
  /** Get producer by kind */
  getProducerByKind(kind: "audio" | "video"): Producer | undefined;
  /** Request a simulcast spatial layer switch for a consumer */
  setPreferredLayers(
    consumerId: string,
    spatialLayer: SimulcastSpatialLayer,
  ): void;
  /** Get the video consumer ID for a remote peer, if one exists */
  getVideoConsumerIdForUserId(userId: string): string | undefined;
  /** Check if screen share is blocked by another participant */
  isScreenShareBlocked(): boolean;
  /** Subscribe to produce errors */
  onProduceError(callback: (code: SfuProduceErrorCode) => void): () => void;
}

/**
 * Responsible for peer tracking.
 * Single responsibility: peer registry.
 */
interface ISfuParticipantRegistry {
  /** Get all peers */
  getParticipants(): Map<string, SfuParticipantInfo>;
  /** Get a specific peer */
  getParticipant(userId: string): SfuParticipantInfo | undefined;
  /** Subscribe to peer joined events */
  onParticipantJoined(callback: SfuParticipantCallback): () => void;
  /** Subscribe to peer left events */
  onParticipantLeft(callback: (userId: string) => void): () => void;
  /** Subscribe to remote producer state change events */
  onProducerStateChange(callback: SfuProducerStateCallback): () => void;
}

/**
 * Responsible for quality statistics.
 * Single responsibility: stats collection and scoring.
 */
interface ISfuStatsCollector {
  /** Start collecting stats */
  startStatsCollection(intervalMs?: number): void;
  /** Stop collecting stats */
  stopStatsCollection(): void;
  /** Subscribe to quality stats */
  onQualityStats(callback: QualityStatsCallback): () => void;
  /** Get current stats */
  getStats(): Map<string, PeerQualityStats>;
}

/**
 * Responsible for SFU state broadcasting.
 * Single responsibility: state events.
 */
interface ISfuStateNotifier {
  /** Get current state */
  getState(): SfuState;
  /** Subscribe to state changes */
  onStateChange(callback: SfuStateCallback): () => void;
  onTrack(callback: SfuTrackCallback): () => void;
  /** Subscribe to screen share stopped events (remote peer stopped sharing) */
  onScreenShareStopped(callback: SfuScreenShareStoppedCallback): () => void;
}

/**
 * Facade combining all SFU concerns.
 * Note: Transport management (device, send/recv transports) is an internal
 * implementation detail and not exposed on the public interface.
 */
export interface ISfuManager
  extends
    ISfuConnection,
    ISfuRoomMembership,
    ISfuHostControls,
    ISfuEgressControls,
    ISfuProducerManager,
    ISfuParticipantRegistry,
    ISfuStatsCollector,
    ISfuStateNotifier {}
