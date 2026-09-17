/**
 * Wire contract for the `/whiteboard` Socket.io namespace.
 *
 * The NestJS server cannot consume workspace TS source, so
 * apps/server/src/whiteboard/whiteboard.types.ts mirrors these constants.
 * Keep both files in sync; the whiteboard e2e suite pins them together.
 */

export type WhiteboardDrawMode = "owner" | "open";

export const WHITEBOARD_NAMESPACE = "/whiteboard";

/** Client -> server: subscribe to a room board. Payload: WhiteboardJoinPayload. */
export const WHITEBOARD_JOIN = "whiteboard:join";
/** Server -> client: full document state on join. Payload: WhiteboardStatePayload. */
export const WHITEBOARD_STATE = "whiteboard:state";
/** Bidirectional: incremental Yjs update. Payload: WhiteboardUpdatePayload. */
export const WHITEBOARD_UPDATE = "whiteboard:update";
/** Bidirectional (server authoritative): draw-lock mode. Payload: WhiteboardModePayload. */
export const WHITEBOARD_MODE = "whiteboard:mode";
/** Server -> client: rejection. Payload: WhiteboardErrorPayload. */
export const WHITEBOARD_ERROR = "whiteboard:error";

/**
 * Cap for a single client-sent update. Yjs updates are deltas, so this is
 * generous; a whole-board paste still fits while garbage payloads do not.
 */
export const WHITEBOARD_UPDATE_MAX_BYTES = 512 * 1024;

export interface WhiteboardJoinPayload {
  roomSlug: string;
}

export interface WhiteboardStatePayload {
  roomSlug: string;
  /** Y.encodeStateAsUpdate of the room document. */
  update: Uint8Array;
}

export interface WhiteboardUpdatePayload {
  roomSlug: string;
  /** Incremental Yjs update (Y.encodeStateAsUpdate of a local delta). */
  update: Uint8Array;
}

export interface WhiteboardModePayload {
  roomSlug: string;
  mode: WhiteboardDrawMode;
}

export interface WhiteboardErrorPayload {
  event: string;
  message: string;
}
