import type { RtpParameters } from 'mediasoup/types';

/** Media kind of a tapped producer. */
export type RoomTapKind = 'audio' | 'video';

/** Producer origin, mirroring `SfuMediaSource` appData. */
export type RoomTapSource = 'camera' | 'screen';

/** Minimal description of a room producer available for tapping. */
export interface RoomTapDescriptor {
  producerId: string;
  kind: RoomTapKind;
  source: RoomTapSource;
}

/** Where the consumer listens for this tap's RTP. */
export interface RoomTapTarget {
  ip: string;
  port: number;
}

/**
 * An established tap. Plain data plus lifecycle controls only: the
 * implementation owns its transport and consumer objects.
 */
export interface RoomTapHandle {
  /** RTP parameters of the consumed producer, for SDP/ffmpeg signalling. */
  rtpParameters: RtpParameters;
  /** Fires when the upstream producer closes. Returns an unsubscribe. */
  onProducerClosed(cb: () => void): () => void;
  /** Releases the tap. Safe to call more than once. */
  close(): void;
}

/**
 * Port over the room media plane for consumers that tap producer RTP
 * (today: egress). Implementations own all mediasoup objects; only plain
 * data and lifecycle controls cross this seam. Producers appear through
 * {@link RoomMediaSource.onProducerAdded}; room lifetime is a Room
 * Presence concern (see room-presence.port.ts).
 */
export interface RoomMediaSource {
  /** Producers currently available for tapping in the room. */
  listTaps(roomId: string): RoomTapDescriptor[];
  /** Open a tap on one producer and point its RTP at `target`. */
  openTap(
    roomId: string,
    producerId: string,
    target: RoomTapTarget,
  ): Promise<RoomTapHandle>;
  /** Subscribe to producers appearing in the room. Returns an unsubscribe. */
  onProducerAdded(
    roomId: string,
    handler: (descriptor: RoomTapDescriptor) => void,
  ): () => void;
}

/** Nest DI token binding {@link RoomMediaSource} to its SFU adapter. */
export const ROOM_MEDIA_SOURCE = Symbol('ROOM_MEDIA_SOURCE');
