import type {
  WhiteboardDrawMode,
  WhiteboardErrorPayload,
  WhiteboardJoinPayload,
  WhiteboardModePayload,
  WhiteboardStatePayload,
  WhiteboardUpdatePayload,
} from "./protocol";
import {
  WHITEBOARD_ERROR,
  WHITEBOARD_JOIN,
  WHITEBOARD_MODE,
  WHITEBOARD_STATE,
  WHITEBOARD_UPDATE,
} from "./protocol";

/**
 * Structural slice of a Socket.io socket the transport needs. Keeps core
 * free of a socket.io-client dependency; the server never imports this module.
 */
export interface WhiteboardSocketLike {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (...args: never[]) => void): unknown;
  off(event: string, handler: (...args: never[]) => void): unknown;
}

export interface WhiteboardTransport {
  /** Subscribe to the room board (idempotent; call after connect). */
  join(): void;
  /** Send a local Yjs update to the room. */
  sendUpdate(update: Uint8Array): void;
  /** Ask the server to change the draw-lock mode (owner-only action). */
  setMode(mode: WhiteboardDrawMode): void;
  /** Full document state, delivered once after joining. */
  onState(callback: (update: Uint8Array) => void): () => void;
  /** Incremental remote update. */
  onUpdate(callback: (update: Uint8Array) => void): () => void;
  onMode(callback: (mode: WhiteboardDrawMode) => void): () => void;
  onError(callback: (payload: WhiteboardErrorPayload) => void): () => void;
}

function toUpdate(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

/**
 * Wires the whiteboard wire protocol onto a connected (or connecting) socket.
 * The caller owns the socket lifecycle; the transport only subscribes to it.
 */
export function createWhiteboardTransport(
  socket: WhiteboardSocketLike,
  roomSlug: string,
): WhiteboardTransport {
  const stateListeners = new Set<(update: Uint8Array) => void>();
  const updateListeners = new Set<(update: Uint8Array) => void>();
  const modeListeners = new Set<(mode: WhiteboardDrawMode) => void>();
  const errorListeners = new Set<(payload: WhiteboardErrorPayload) => void>();
  // The server answers join with the full state while the engine is still
  // loading (dynamic import); frames arriving before a consumer subscribes
  // must be queued, not dropped, or late joiners render an empty board.
  const pending: Array<{ kind: "state" | "update"; update: Uint8Array }> = [];
  let pendingFlushed = false;
  const flushPending = (): void => {
    if (pendingFlushed) return;
    pendingFlushed = true;
    // Defer one microtask so consumers subscribing to both channels in the
    // same tick (the binding does) both receive the queued frames.
    queueMicrotask(() => {
      for (const frame of pending.splice(0)) {
        const listeners = frame.kind === "state" ? stateListeners : updateListeners;
        for (const listener of listeners) listener(frame.update);
      }
    });
  };

  const handleState = (...args: never[]): void => {
    const payload = args[0] as unknown as WhiteboardStatePayload | undefined;
    const update = toUpdate(payload?.update);
    if (!update) return;
    if (!pendingFlushed) {
      pending.push({ kind: "state", update });
      return;
    }
    for (const listener of stateListeners) listener(update);
  };
  const handleUpdate = (...args: never[]): void => {
    const payload = args[0] as unknown as WhiteboardUpdatePayload | undefined;
    const update = toUpdate(payload?.update);
    if (!update) return;
    if (!pendingFlushed) {
      pending.push({ kind: "update", update });
      return;
    }
    for (const listener of updateListeners) listener(update);
  };
  const handleMode = (...args: never[]): void => {
    const payload = args[0] as unknown as WhiteboardModePayload | undefined;
    if (payload?.mode !== "owner" && payload?.mode !== "open") return;
    for (const listener of modeListeners) listener(payload.mode);
  };
  const handleError = (...args: never[]): void => {
    const payload = args[0] as unknown as WhiteboardErrorPayload | undefined;
    if (!payload || typeof payload.message !== "string") return;
    for (const listener of errorListeners) listener(payload);
  };

  socket.on(WHITEBOARD_STATE, handleState);
  socket.on(WHITEBOARD_UPDATE, handleUpdate);
  socket.on(WHITEBOARD_MODE, handleMode);
  socket.on(WHITEBOARD_ERROR, handleError);

  return {
    join(): void {
      const payload: WhiteboardJoinPayload = { roomSlug };
      socket.emit(WHITEBOARD_JOIN, payload);
    },
    sendUpdate(update: Uint8Array): void {
      const payload: WhiteboardUpdatePayload = { roomSlug, update };
      socket.emit(WHITEBOARD_UPDATE, payload);
    },
    setMode(mode: WhiteboardDrawMode): void {
      const payload: WhiteboardModePayload = { roomSlug, mode };
      socket.emit(WHITEBOARD_MODE, payload);
    },
    onState(callback: (update: Uint8Array) => void): () => void {
      stateListeners.add(callback);
      flushPending();
      return () => stateListeners.delete(callback);
    },
    onUpdate(callback: (update: Uint8Array) => void): () => void {
      updateListeners.add(callback);
      flushPending();
      return () => updateListeners.delete(callback);
    },
    onMode(callback: (mode: WhiteboardDrawMode) => void): () => void {
      modeListeners.add(callback);
      return () => modeListeners.delete(callback);
    },
    onError(callback: (payload: WhiteboardErrorPayload) => void): () => void {
      errorListeners.add(callback);
      return () => errorListeners.delete(callback);
    },
  };
}
