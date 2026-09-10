import type { Consumer, PlainTransport, RtpParameters } from 'mediasoup/types';

/** Media kind of a tapped producer. */
export type EgressTapKind = 'audio' | 'video';

/** Producer origin, mirroring `SfuMediaSource` appData. */
export type EgressTapSource = 'camera' | 'screen';

/** Minimal description of a room producer available for tapping. */
export interface EgressTapDescriptor {
  producerId: string;
  kind: EgressTapKind;
  source: EgressTapSource;
}

/** An established server-side tap: consumer + the transport feeding FFmpeg. */
export interface EgressTap {
  descriptor: EgressTapDescriptor;
  transport: PlainTransport;
  consumer: Consumer;
  /** Local UDP port FFmpeg listens on for this tap's RTP. */
  port: number;
}

/** Outputs requested for one egress session. */
export interface EgressOutputs {
  rtmpEndpoints: string[];
  hls: boolean;
  /** Persist the composited program to server disk for later download. */
  record: boolean;
}

/** Input file contract handed to the FFmpeg args composer. */
export interface EgressPipelineInput {
  descriptor: EgressTapDescriptor;
  rtpParameters: RtpParameters;
  /** Absolute path of the SDP file describing this input. */
  sdpPath: string;
  port: number;
}

/** Terminal states of an egress session. */
export type EgressSessionStatus =
  | 'starting'
  | 'live'
  | 'stopping'
  | 'ended'
  | 'failed';

/** Why a session reached `ended`. */
export type EgressEndReason = 'stopped' | 'room-ended';

/** Webhook-facing end reason spelling (kebab, matches webhook specs). */
export type EgressEndReasonDto = 'stopped' | 'room-ended';

/** Serializable session snapshot returned by the REST surface. */
export interface EgressSessionView {
  id: string;
  roomId: string;
  status: EgressSessionStatus;
  outputs: EgressOutputs;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: EgressEndReasonDto | null;
  error: string | null;
  /** Playback URL when HLS output is enabled, else null. */
  hlsUrl: string | null;
  /** Download URL once a recording output is finalized or crashed-with-parts, else null. */
  recordingUrl: string | null;
  /** Finalized recording size in bytes, when known. */
  recordingSizeBytes: number | null;
}

/** Coded denials for client-initiated egress actions (signalling acks). */
export type EgressActionErrorCode =
  | 'NOT_IN_ROOM'
  | 'MISSING_CAPABILITY'
  | 'NOT_PROJECT_ROOM'
  | 'INVALID_OUTPUTS'
  | 'ALREADY_ACTIVE'
  | 'NOT_ACTIVE'
  | 'EGRESS_UNAVAILABLE';

/** Acknowledgement for egress:start / egress:stop on the requesting socket. */
export type EgressActionAck =
  | { ok: true }
  | { ok: false; code: EgressActionErrorCode; message: string };

/** Client-visible slice of an egress session's state (egress:status). */
export interface EgressStatusBroadcast {
  sessionId: string;
  outputs: { record: boolean; hls: boolean };
  status: EgressSessionStatus;
}
