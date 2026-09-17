import * as Y from "yjs";

import { WHITEBOARD_UPDATE_MAX_BYTES } from "./protocol";

export type ApplyRoomUpdateResult = "applied" | "too-large" | "invalid";

/** A room board document: 'elements' (id -> element) and 'order' (ids). */
export function createRoomDoc(): Y.Doc {
  return new Y.Doc();
}

/** Full document state for late joiners and re-syncs. */
export function encodeRoomState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Applies a client-sent update with the size and integrity guards the server
 * applies before touching its document. Yjs decodes the full update before
 * applying, so a decode failure leaves the document untouched.
 */
export function applyRoomUpdate(doc: Y.Doc, update: Uint8Array): ApplyRoomUpdateResult {
  if (update.byteLength > WHITEBOARD_UPDATE_MAX_BYTES) {
    return "too-large";
  }
  try {
    Y.applyUpdate(doc, update);
    return "applied";
  } catch {
    return "invalid";
  }
}
