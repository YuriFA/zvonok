import type { WhiteboardTransport } from "./transport";

/**
 * A whiteboard engine renders and edits a collaborative board. The engine
 * owns its document model (how elements are represented, serialized, and
 * merged) and drives the injected transport with opaque Yjs updates; the
 * host never interprets engine state.
 */
export interface WhiteboardEngine {
  readonly id: string;
  mount(container: HTMLElement, options: WhiteboardMountOptions): Promise<WhiteboardSession>;
}

export interface WhiteboardMountOptions {
  transport: WhiteboardTransport;
  /** Whether the local participant may currently draw. */
  canDraw: boolean;
}

export interface WhiteboardSession {
  /** Switch the engine between editable and read-only rendering. */
  setReadonly(readonly: boolean): void;
  /** Revert the local user's latest action; propagates to all participants. */
  undo(): void;
  /** Re-apply the local user's latest undone action; propagates to all participants. */
  redo(): void;
  /** Current undo/redo availability. */
  historyState(): WhiteboardHistoryState;
  /** Subscribe to undo/redo availability. Returns an unsubscribe function. */
  onHistoryChange(callback: (state: WhiteboardHistoryState) => void): () => void;
  dispose(): void;
}

export interface WhiteboardHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}
