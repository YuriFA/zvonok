/**
 * Typed errors surfaced by the @zvonok/react SDK.
 */

/**
 * Base class for all SDK errors. Carries a stable machine-readable code
 * mirroring the server's coded sfu events (sfu:join-error, sfu:host-error).
 */
export class ZvonokError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZvonokError";
    this.code = code;
  }
}

/**
 * Join failures. Codes follow the server's SfuJoinErrorCode union plus the
 * client-side timeouts.
 */
export class ZvonokJoinError extends ZvonokError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ZvonokJoinError";
  }
}

/** Codes the server sends on sfu:join-error. */
export type ZvonokServerJoinErrorCode =
  | "ROOM_TOKEN_INVALID"
  | "ROOM_TOKEN_EXPIRED"
  | "ROOM_TOKEN_ROOM_MISMATCH"
  | "ROOM_LOCKED";

/** Client-side join failure codes. */
export type ZvonokJoinTimeoutCode = "JOIN_TIMEOUT";

/**
 * Host control action failures (mutePeer, muteAll, lockRoom, kickPeer).
 * The server answers each action with an acknowledgement; denials carry a
 * coded error that lands here unchanged.
 */
export class ZvonokHostError extends ZvonokError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ZvonokHostError";
  }
}

/** Codes the server sends in host-action acknowledgement denials. */
export type ZvonokServerHostErrorCode =
  | "MISSING_CAPABILITY"
  | "TARGET_NOT_FOUND"
  | "NOT_IN_ROOM";

/** Client-side host action failure codes. */
export type ZvonokHostLocalErrorCode =
  | "DISCONNECTED"
  | "HOST_ACTION_TIMEOUT"
  | "HOST_ACTION_FAILED";

/**
 * Client-initiated egress action failures (start/stop). The server answers
 * with an acknowledgement; coded denials land here unchanged.
 */
export class ZvonokEgressError extends ZvonokError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ZvonokEgressError";
  }
}

/** Codes the server sends in egress action acknowledgement denials. */
export type ZvonokServerEgressErrorCode =
  | "NOT_IN_ROOM"
  | "MISSING_CAPABILITY"
  | "NOT_PROJECT_ROOM"
  | "INVALID_OUTPUTS"
  | "ALREADY_ACTIVE"
  | "NOT_ACTIVE"
  | "EGRESS_UNAVAILABLE";

/** Client-side egress action failure codes. */
export type ZvonokEgressLocalErrorCode =
  | "DISCONNECTED"
  | "EGRESS_ACTION_TIMEOUT"
  | "EGRESS_ACTION_FAILED";
