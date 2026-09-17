import type { WhiteboardHistoryState } from "@zvonok/whiteboard-core/engine";
import type { WhiteboardTransport } from "@zvonok/whiteboard-core/transport";
import * as Y from "yjs";

/**
 * Minimal structural slice of an Excalidraw element. The binding works on
 * plain serializable objects; the engine casts real Excalidraw elements
 * (which satisfy this shape) into it.
 */
export interface ExcalidrawElementLike {
  id: string;
  version: number;
  versionNonce: number;
  [key: string]: unknown;
}

/** The slice of the Excalidraw imperative API the binding drives. */
export interface WhiteboardSceneApi {
  updateScene(scene: { elements: readonly ExcalidrawElementLike[] }): void;
}

export type RestoreFn = (
  remote: readonly ExcalidrawElementLike[],
  local: readonly ExcalidrawElementLike[],
) => readonly ExcalidrawElementLike[];

/** Marks updates that arrived from the network; never re-sent, never undoable. */
const REMOTE_ORIGIN = "zvonok-whiteboard-remote";

export interface BindingOptions {
  /**
   * Normalizes remote elements before they enter the scene. The engine passes
   * Excalidraw's documented `restoreElements` with dimension refresh disabled;
   * tests run the identity to stay deterministic.
   */
  restore?: RestoreFn;
}

/**
 * Binds an Excalidraw scene to a room Yjs document:
 * `elements` is a Y.Map keyed by element id (last-writer-wins by element
 * `version`), `order` is a Y.Array of ids preserving z-order. Local scene
 * changes are diffed into the document under a local origin tracked by a
 * Y.UndoManager; remote document changes rebuild the scene.
 */
export class ExcalidrawYjsBinding {
  readonly doc = new Y.Doc();
  private readonly elements: Y.Map<ExcalidrawElementLike>;
  private readonly order: Y.Array<string>;
  private readonly undoManager: Y.UndoManager;
  private readonly transport: WhiteboardTransport;
  private readonly restore: RestoreFn;
  private readonly transportOffs: Array<() => void> = [];
  private readonly historyListeners = new Set<(state: WhiteboardHistoryState) => void>();
  private scene: WhiteboardSceneApi | null = null;
  private applyingRemote = false;
  private flushScheduled = false;
  private localElements: readonly ExcalidrawElementLike[] = [];
  /** Scene before the most recent remote/undo apply, to recognize stale onChange. */
  private previousScene: readonly ExcalidrawElementLike[] = [];
  /** Elements just pushed by applyScene, to recognize the engine's echo. */
  private lastAppliedScene: readonly ExcalidrawElementLike[] = [];
  /** Room state vector as of the last update sent to the server. */
  private serverVector: Uint8Array;
  private disposed = false;

  constructor(transport: WhiteboardTransport, options: BindingOptions = {}) {
    this.transport = transport;
    this.serverVector = Y.encodeStateVector(this.doc);
    this.elements = this.doc.getMap<ExcalidrawElementLike>("elements");
    this.order = this.doc.getArray<string>("order");
    this.restore = options.restore ?? ((remote) => remote);
    this.undoManager = new Y.UndoManager([this.elements, this.order], {
      trackedOrigins: new Set([this]),
    });
    this.undoManager.on("stack-item-added", this.notifyHistory);
    this.undoManager.on("stack-item-popped", this.notifyHistory);
    // Outbound updates are sent explicitly (see sendLocalDiff) instead of
    // through the doc 'update' signal.
    this.elements.observe(this.handleDocChange);
    this.order.observe(this.handleDocChange);
    this.transportOffs.push(
      transport.onState((update) => this.receive(update)),
      transport.onUpdate((update) => this.receive(update)),
    );
  }

  /** Connects the scene the binding keeps in sync. Call once on mount. */
  attach(scene: WhiteboardSceneApi): void {
    this.scene = scene;
    // The document may already hold room state delivered before the engine
    // finished mounting (dynamic import): replay it into the fresh scene.
    this.scheduleApplyScene();
  }

  /**
   * Feeds a local Excalidraw scene change into the document. Must be wired to
   * the engine's change callback; remote applications set a guard flag so
   * echoed scenes are ignored.
   */
  handleLocalChange(elements: readonly ExcalidrawElementLike[]): void {
    if (this.disposed || this.applyingRemote) return;
    // Excalidraw fires onChange asynchronously, after applyingRemote is
    // already clear. Two calls are not user edits: the engine echoing the
    // scene applyScene just pushed, and a stale pre-apply scene snapshot.
    // Treating either as local would delete room elements (observed live:
    // a late joiner wiped the board it had just received).
    if (this.sameScene(elements, this.lastAppliedScene)) {
      this.localElements = elements;
      return;
    }
    if (this.sameScene(elements, this.previousScene)) return;
    const previousIds = new Set(this.localElements.map((element) => element.id));
    this.localElements = elements;
    const present = new Map(elements.map((element) => [element.id, element]));
    this.doc.transact(() => {
      // No per-field skip check here: Excalidraw mutates freedraw points in
      // place, so any comparison against the stored copy sees the mutated
      // array and would freeze the stroke at its first point (observed live).
      // The guards above already dropped echoes and stale snapshots; if a
      // change reaches this line it must land in the document.
      for (const element of elements) {
        const stored = this.elements.get(element.id);
        if (stored !== undefined && stored.version > element.version) continue;
        // A shallow clone is required: Yjs skips re-wrapping an object it
        // already holds by reference (Excalidraw reuses one element object
        // per gesture and mutates its points array in place), and the clone
        // snapshots the CURRENT point content into the new clock entry.
        this.elements.set(element.id, {
          ...element,
          points: element.points ? [...(element.points as unknown[])] : undefined,
        } as ExcalidrawElementLike);
      }
      for (const id of Array.from(this.elements.keys())) {
        if (!present.has(id) && previousIds.has(id)) this.elements.delete(id);
      }
      this.reconcileOrder(elements.map((element) => element.id));
    }, this);
    this.sendLocalDiff();
  }

  undo(): void {
    if (!this.disposed) {
      this.undoManager.undo();
      this.sendLocalDiff();
    }
  }

  redo(): void {
    if (!this.disposed) {
      this.undoManager.redo();
      this.sendLocalDiff();
    }
  }

  historyState(): WhiteboardHistoryState {
    return {
      canUndo: this.undoManager.undoStack.length > 0,
      canRedo: this.undoManager.redoStack.length > 0,
    };
  }

  onHistoryChange(callback: (state: WhiteboardHistoryState) => void): () => void {
    this.historyListeners.add(callback);
    return () => this.historyListeners.delete(callback);
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.transportOffs) off();
    this.undoManager.off("stack-item-added", this.notifyHistory);
    this.undoManager.off("stack-item-popped", this.notifyHistory);
    this.undoManager.destroy();
    this.doc.destroy();
  }

  /**
   * Sends everything the server has not seen yet as a diff against the
   * state vector of the last successful send. Sent explicitly from the
   * local-change/undo/redo paths instead of relying on the doc 'update'
   * signal, which proved unreliable to observe in the browser.
   */
  private sendLocalDiff(): void {
    if (this.disposed) return;
    const update = Y.encodeStateAsUpdate(this.doc, this.serverVector);
    // An empty diff is a 2-byte no-op; skip it to avoid server chatter.
    if (update.length <= 2) return;
    this.serverVector = Y.encodeStateVector(this.doc);
    this.transport.sendUpdate(update);
  }

  private readonly handleDocChange = (
    _event: Y.YMapEvent<ExcalidrawElementLike> | Y.YArrayEvent<string>,
    transaction: Y.Transaction,
  ): void => {
    // Local edits are already reflected in the scene; remote merges and
    // undo/redo results must be re-rendered.
    if (this.applyingRemote || transaction.origin === this) return;
    this.scheduleApplyScene();
  };

  private scheduleApplyScene(): void {
    if (this.flushScheduled || this.disposed) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.disposed) return;
      this.applyScene();
    });
  }

  private applyScene(): void {
    if (this.scene === null) return;
    const ids = this.order.toArray();
    const remote: ExcalidrawElementLike[] = [];
    for (const id of ids) {
      const element = this.elements.get(id);
      if (element !== undefined) remote.push(element);
    }
    const restored = this.restore(remote, this.localElements);
    // previousScene must be a value snapshot: Excalidraw mutates its element
    // objects in place during a gesture, so keeping references would make
    // the stale-snapshot guard below treat the mutated gesture as "unchanged".
    this.previousScene = this.localElements.map(
      (element) =>
        ({
          ...element,
          points: element.points ? [...(element.points as unknown[])] : undefined,
        }) as ExcalidrawElementLike,
    );
    this.lastAppliedScene = restored;
    this.localElements = restored;
    this.applyingRemote = true;
    try {
      this.scene.updateScene({ elements: restored });
    } finally {
      this.applyingRemote = false;
    }
  }

  /**
   * Identity by id, the LWW coordinates, and the visible content. Freedraw
   * strokes grow while Excalidraw keeps the version untouched, so a version
   * match alone cannot tell a live gesture from an echo of the same stroke.
   */
  private sameScene(
    left: readonly ExcalidrawElementLike[],
    right: readonly ExcalidrawElementLike[],
  ): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    return left.every((element, index) => {
      const other = right[index];
      if (element.id !== other.id) return false;
      if (element.version !== other.version || element.versionNonce !== other.versionNonce) {
        return false;
      }
      return samePoints(element, other);
    });
  }

  private reconcileOrder(target: readonly string[]): void {
    let cursor = 0;
    for (const id of target) {
      if (cursor < this.order.length && this.order.get(cursor) === id) {
        cursor += 1;
        continue;
      }
      const existing = this.order.toArray().indexOf(id);
      if (existing !== -1) this.order.delete(existing, 1);
      this.order.insert(cursor, [id]);
      cursor += 1;
    }
    if (cursor < this.order.length) {
      this.order.delete(cursor, this.order.length - cursor);
    }
  }

  private receive(update: Uint8Array): void {
    if (this.disposed) return;
    try {
      Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    } catch {
      // The server validates updates; a peer-side decode failure is ignored.
    }
  }

  private readonly notifyHistory = (): void => {
    const state = this.historyState();
    for (const listener of this.historyListeners) listener(state);
  };
}

/** Compares gesture-visible point content cheaply: count plus the ends. */
function samePoints(left: ExcalidrawElementLike, right: ExcalidrawElementLike): boolean {
  const a = left.points as unknown[] | undefined;
  const b = right.points as unknown[] | undefined;
  if (a === b) return true;
  const aLen = a?.length ?? 0;
  const bLen = b?.length ?? 0;
  if (aLen !== bLen) return false;
  if (aLen === 0) return true;
  if (JSON.stringify(a?.[0]) !== JSON.stringify(b?.[0])) return false;
  return JSON.stringify(a?.[aLen - 1]) === JSON.stringify(b?.[bLen - 1]);
}
