import type {
  RtpCapabilities,
  RtpParameters,
  DtlsParameters,
  IceParameters,
  IceCandidate,
} from "mediasoup-client/types";

export type SfuMediaSource = "camera" | "screen";

/**
 * Capability vocabulary delivered by the server in the join acknowledgement.
 * Mirrors the server's fixed vocabulary; unknown ids are ignored.
 */
export type CapabilityId =
  | "send-audio"
  | "send-video"
  | "send-screenshare"
  | "mute-users"
  | "remove-participants"
  | "lock-room"
  | "start-recording"
  | "start-broadcast";

/** Coded denials the server sends in host-action acknowledgements. */
export type SfuHostActionServerErrorCode =
  | "NOT_IN_ROOM"
  | "MISSING_CAPABILITY"
  | "TARGET_NOT_FOUND";

/** Local host-action failure codes (no socket, no ack in time). */
export type SfuHostActionLocalErrorCode = "DISCONNECTED" | "HOST_ACTION_TIMEOUT";

export type SfuHostActionErrorCode =
  | SfuHostActionServerErrorCode
  | SfuHostActionLocalErrorCode;

/**
 * A host-control action was refused by the server or could not reach it.
 * `code` mirrors the server's coded acknowledgement (or a local timeout).
 */
export class SfuHostActionError extends Error {
  readonly code: SfuHostActionErrorCode;

  constructor(code: SfuHostActionErrorCode, message: string) {
    super(message);
    this.name = "SfuHostActionError";
    this.code = code;
  }
}

export type SfuProduceErrorCode =
  | "SCREEN_SHARE_ALREADY_ACTIVE"
  | "SEND_TRANSPORT_NOT_READY"
  | "TRANSPORT_NOT_FOUND"
  | "PUBLISH_NOT_ALLOWED"
  | "PRODUCE_FAILED";

export class SfuProduceError extends Error {
  readonly code: SfuProduceErrorCode;
  constructor(code: SfuProduceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type SfuJoinErrorCode =
  | "ROOM_TOKEN_INVALID"
  | "ROOM_TOKEN_EXPIRED"
  | "ROOM_TOKEN_ROOM_MISMATCH"
  | "ROOM_LOCKED"
  | "SFU_JOIN_UNAUTHORIZED"
  | "SFU_JOIN_FORBIDDEN";

export interface SfuJoinErrorPayload {
  code: SfuJoinErrorCode;
  message: string;
}

export class SfuJoinError extends Error {
  readonly code: SfuJoinErrorCode;
  constructor(code: SfuJoinErrorCode, message: string) {
    super(message);
    this.name = "SfuJoinError";
    this.code = code;
  }
}

// Join payload sent to server. Identity is never carried in the payload:
// the server derives it from a room token (platform) or the authenticated
// session cookies (app UI).
export interface SfuJoinPayload {
  roomId: string;
  roomSlug?: string;
  /** Room token (project rooms). When present, the server derives identity
   * from the verified token claims. */
  token?: string;
}

/** Server-verified identity of the local participant, delivered on join. */
export interface SfuParticipantIdentity {
  id: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: unknown;
}


/** Lifecycle statuses of a room egress session, mirrored from the server. */
export type SfuEgressSessionStatus =
  | "starting"
  | "live"
  | "stopping"
  | "ended"
  | "failed";

/** The client-visible slice of an egress session (egress:status events). */
export interface SfuEgressStatusPayload {
  sessionId: string;
  outputs: { record: boolean; hls: boolean };
  status: SfuEgressSessionStatus;
}

/** Coded denials the server sends in egress action acknowledgements. */
export type SfuEgressActionServerErrorCode =
  | "NOT_IN_ROOM"
  | "MISSING_CAPABILITY"
  | "NOT_PROJECT_ROOM"
  | "INVALID_OUTPUTS"
  | "ALREADY_ACTIVE"
  | "NOT_ACTIVE"
  | "EGRESS_UNAVAILABLE";

/** Local egress action failure codes (no socket, no ack in time). */
export type SfuEgressActionLocalErrorCode = "DISCONNECTED" | "EGRESS_ACTION_TIMEOUT";

export type SfuEgressActionErrorCode =
  | SfuEgressActionServerErrorCode
  | SfuEgressActionLocalErrorCode;

/**
 * A client-initiated egress action was refused by the server or could not
 * reach it. `code` mirrors the server's coded acknowledgement.
 */
export class SfuEgressActionError extends Error {
  readonly code: SfuEgressActionErrorCode;

  constructor(code: SfuEgressActionErrorCode, message: string) {
    super(message);
    this.name = "SfuEgressActionError";
    this.code = code;
  }
}

/** Outputs requestable through the client signalling path (no RTMP). */
export interface SfuEgressOutputRequest {
  record?: boolean;
  hls?: boolean;
}
// Joined response from server
export interface SfuJoinedPayload {
  routerRtpCapabilities: RtpCapabilities;
  participant: SfuParticipantIdentity;
  /** Own capabilities from the verified credential path (server authority). */
  capabilities: CapabilityId[];
}


// Transport direction
export type SfuTransportDirection = "send" | "recv";

// Transport created response from server
export interface SfuTransportCreatedPayload {
  direction: SfuTransportDirection;
  transportId: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  iceServers?: RTCIceServer[];
}

// Transport connect payload sent to server
export interface SfuTransportConnectPayload {
  transportId: string;
  dtlsParameters: DtlsParameters;
}

// Transport connected response from server
export interface SfuTransportConnectedPayload {
  transportId: string;
}

export interface SfuProduceAppData {
  source?: SfuMediaSource;
}

// Produce payload sent to server
export interface SfuProducePayload {
  requestId: string;
  transportId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  appData?: SfuProduceAppData;
}

// Producer created response from server
export interface SfuProducerCreatedPayload {
  requestId: string;
  producerId: string;
  userId: string;
  kind: "audio" | "video";
  appData?: SfuProduceAppData;
}

// Produce error response from server
export interface SfuProduceErrorPayload {
  requestId: string;
  code: SfuProduceErrorCode;
  message: string;
}

// New producer notification from server
export interface SfuNewProducerPayload {
  producerId: string;
  userId: string;
  username: string;
  kind: "audio" | "video";
  paused: boolean;
  appData?: SfuProduceAppData;
}

// Screen share started notification from server
export interface SfuScreenShareStartedPayload {
  userId: string;
}

// Screen share stopped notification from server
export interface SfuScreenShareStoppedPayload {
  userId: string;
}

// Consumer closed notification from server
export interface SfuConsumerClosedPayload {
  consumerId: string;
}

// Consume payload sent to server
export interface SfuConsumePayload {
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

// Consumer created response from server
export interface SfuConsumerCreatedPayload {
  consumerId: string;
  producerId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
}

// Resume consumer payload sent to server
export interface SfuResumeConsumerPayload {
  consumerId: string;
}

// Pause/Resume producer payloads
export interface SfuPauseProducerPayload {
  producerId: string;
}

export interface SfuResumeProducerPayload {
  producerId: string;
}

// Producer state changed notification from server (broadcast to other peers)
export interface SfuProducerStateChangedPayload {
  producerId: string;
  kind: "audio" | "video";
  userId: string;
  paused: boolean;
  source?: SfuMediaSource;
}

export interface SfuKickPeerPayload {
  userId: string;
}

export interface SfuKickedPayload {
  roomId: string;
}

export interface SfuRoomEndedPayload {
  roomId: string;
}

export interface SfuGuestJoinRequestPayload {
  requestId: string;
  displayName: string;
}

// Peer info for tracking remote producers
export interface SfuParticipantInfo {
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: unknown;
  producers: Map<string, { kind: "audio" | "video"; paused?: boolean; source?: SfuMediaSource }>;
}

// Payload for sfu:peer-joined event (peer joins after you)
export interface SfuParticipantJoinedPayload {
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: unknown;
}

// Payload for sfu:existing-peers event (peers already in room when you join)
export interface SfuExistingParticipantsPayload {
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: unknown;
}

// SFU connection state
export type SfuConnectionState = "disconnected" | "connecting" | "connected" | "failed";

// SFU manager state
export interface SfuState {
  connectionState: SfuConnectionState;
  isDeviceLoaded: boolean;
  isSendTransportCreated: boolean;
  sendTransportConnected: boolean;
  recvTransportConnected: boolean;
  /** Own capabilities delivered by the server; empty until joined. */
  capabilities: CapabilityId[];
  /** Latest egress session state broadcast for the room; null when idle. */
  egress: SfuEgressStatusPayload | null;
  audioProducerId: string | null;
  videoProducerId: string | null;
  screenProducerId: string | null;
  isScreenShareBlocked: boolean;
}

// Callback types
export type SfuTrackCallback = (
  track: MediaStreamTrack,
  kind: "audio" | "video",
  userId: string,
  source?: SfuMediaSource,
) => void;
export type SfuParticipantCallback = (peer: SfuParticipantInfo) => void;
export type SfuStateCallback = (state: SfuState) => void;
export type SfuProducerStateCallback = (payload: SfuProducerStateChangedPayload) => void;
export type SfuScreenShareStoppedCallback = (payload: SfuScreenShareStoppedPayload) => void;

// Quality stats types
export interface QualityStats {
  bitrate: number; // kbps
  packetLoss: number; // percentage
  rtt: number; // ms
  jitter: number; // ms
  width: number;
  height: number;
  fps: number;
}

export type QualityLevel = "excellent" | "good" | "fair" | "poor";

export interface QualityScore {
  level: QualityLevel;
  score: number; // 0-100
}

export interface PeerQualityStats {
  userId: string;
  stats: QualityStats;
  score: QualityScore;
}

export type QualityStatsCallback = (stats: Map<string, PeerQualityStats>) => void;

// Simulcast spatial layer (0 = low, 1 = mid, 2 = high)
export type SimulcastSpatialLayer = 0 | 1 | 2;

// Payload sent to server to request a simulcast layer switch
export interface SfuSetPreferredLayersPayload {
  consumerId: string;
  spatialLayer: SimulcastSpatialLayer;
}
