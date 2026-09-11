import type { Socket } from 'socket.io';
import type {
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  RtpParameters,
  DtlsParameters,
  IceParameters,
  IceCandidate,
} from 'mediasoup/types';
import type { IceServerConfig } from '../config/mediasoup.config';
import type { CapabilityId } from '../capabilities';

export interface Peer {
  id: string;
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: Record<string, unknown>;
  socket: Socket;
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  /** Effective capabilities resolved by the server from the verified
   * credential path; never read from client-supplied payload fields. */
  capabilities: CapabilityId[];
  /** Set only when a verified identity matches the DB room owner. */
  ownsRoom?: boolean;
}

export interface Room {
  id: string;
  router: Router;
  peers: Map<string, Peer>;
}

export interface SfuJoinPayload {
  roomId: string;
  roomSlug?: string;
  token?: string;
}

export type SfuJoinErrorCode =
  | 'ROOM_TOKEN_INVALID'
  | 'ROOM_TOKEN_EXPIRED'
  | 'ROOM_TOKEN_ROOM_MISMATCH'
  | 'ROOM_LOCKED'
  | 'SFU_JOIN_UNAUTHORIZED'
  | 'SFU_JOIN_FORBIDDEN';

export interface SfuJoinErrorPayload {
  code: SfuJoinErrorCode;
  message: string;
}

export interface SfuJoinedPayload {
  routerRtpCapabilities: RtpCapabilities;
  participant: {
    id: string;
    username: string;
    externalId?: string;
    metadata?: Record<string, unknown>;
  };
  /** The participant's effective capabilities from the verified
   * credential path (single source of truth; clients never decode tokens). */
  capabilities: CapabilityId[];
}
export type SfuTransportDirection = 'send' | 'recv';

export interface SfuTransportCreatedPayload {
  transportId: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  iceServers?: IceServerConfig[];
}

export interface SfuTransportConnectPayload {
  transportId: string;
  dtlsParameters: DtlsParameters;
}

export interface SfuTransportConnectedPayload {
  transportId: string;
}

export type SfuMediaSource = 'camera' | 'screen';

export interface SfuProduceAppData {
  source?: SfuMediaSource;
}

export type SfuProduceErrorCode =
  | 'SCREEN_SHARE_ALREADY_ACTIVE'
  | 'SEND_TRANSPORT_NOT_READY'
  | 'TRANSPORT_NOT_FOUND'
  | 'PUBLISH_NOT_ALLOWED'
  | 'PRODUCE_FAILED';

export interface SfuProducePayload {
  requestId: string;
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: RtpParameters;
  appData?: SfuProduceAppData;
}

export interface SfuProducerCreatedPayload {
  requestId: string;
  producerId: string;
  userId: string;
  kind: 'audio' | 'video';
  appData?: SfuProduceAppData;
}

export interface SfuProduceErrorPayload {
  requestId: string;
  code: SfuProduceErrorCode;
  message: string;
}

export interface SfuCloseProducerPayload {
  producerId: string;
}

export interface SfuScreenShareStartedPayload {
  userId: string;
}

export interface SfuScreenShareStoppedPayload {
  userId: string;
}

export interface SfuConsumePayload {
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

export interface SfuConsumerCreatedPayload {
  consumerId: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: RtpParameters;
}

export interface SfuResumeConsumerPayload {
  consumerId: string;
}

export interface SfuPauseProducerPayload {
  producerId: string;
}

export interface SfuResumeProducerPayload {
  producerId: string;
}

export interface SfuKickPeerPayload {
  userId: string;
}

export interface SfuMutePeerPayload {
  userId: string;
}

export interface SfuLockRoomPayload {
  locked: boolean;
}

export interface SfuPeerMutedPayload {
  userId: string;
}

export interface SfuRoomLockedPayload {
  locked: boolean;
}

// Acknowledgement for host-control actions (sfu:mute-peer, sfu:mute-all,
// sfu:lock-room, sfu:kick-peer), answered on the requesting socket only.
export type SfuHostActionErrorCode =
  | 'NOT_IN_ROOM' // requester has no peer state in a room
  | 'MISSING_CAPABILITY' // requester lacks the capability the action guards
  | 'TARGET_NOT_FOUND'; // target peer absent from the room

export type SfuHostActionAck =
  | { ok: true }
  | { ok: false; code: SfuHostActionErrorCode; message: string };

// Data channel: a participant emits sfu:broadcast {topic, payload}; the
// acknowledgement lands on the requesting socket, and on success every
// other participant in the room receives the relayed message below.
export interface SfuBroadcastPayload {
  topic: string;
  payload: unknown;
}

export interface SfuBroadcastMessage {
  senderId: string;
  topic: string;
  payload: unknown;
  /** ISO timestamp set by the server at relay time. */
  timestamp: string;
}

export type SfuBroadcastErrorCode =
  | 'NOT_IN_ROOM' // requester has no peer state in a room
  | 'MISSING_CAPABILITY' // requester lacks send-data-message
  | 'PAYLOAD_TOO_LARGE' // serialized payload exceeds 8192 bytes
  | 'INVALID_TOPIC'; // topic is not 1-64 chars of [A-Za-z0-9._-]

export type SfuBroadcastAck =
  | { ok: true }
  | { ok: false; code: SfuBroadcastErrorCode; message: string };

// Peer joined payload - sent when a peer joins the room (independent of media)
export interface SfuPeerJoinedPayload {
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: Record<string, unknown>;
}

// Existing peer info - sent to new peer about existing room members
export interface SfuExistingPeerPayload {
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: Record<string, unknown>;
}

// Payload for sfu:set-preferred-layers (client → server)
export interface SfuSetPreferredLayersPayload {
  consumerId: string;
  spatialLayer: number;
}
