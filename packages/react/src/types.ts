/**
 * Shared types for the @zvonok/react SDK.
 */

/** Lifecycle status of the room connection. */
export type ZvonokStatus =
  | "disconnected"
  | "connecting"
  | "joined"
  | "reconnecting"
  | "error";

/** A remote participant with their media grouped by source. */
export interface ZvonokParticipant {
  userId: string;
  displayName: string;
  /** Camera video stream, or null while the peer publishes no camera track. */
  cameraStream: MediaStream | null;
  /** Screen share video stream, or null while the peer is not sharing. */
  screenStream: MediaStream | null;
  /** Audio stream, or null while the peer publishes no audio track. */
  audioStream: MediaStream | null;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isAudioEnabled: boolean;
  /** False while the peer's media is detached (disconnect grace hold). */
  isConnected: boolean;
  /** True after the host muted this peer and before the peer unmutes again. */
  mutedByHost: boolean;
}
