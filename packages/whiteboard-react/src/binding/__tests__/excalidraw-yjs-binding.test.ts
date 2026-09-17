import type { WhiteboardTransport } from "@zvonok/whiteboard-core/transport";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { ExcalidrawElementLike, WhiteboardSceneApi } from "../excalidraw-yjs-binding";
import { ExcalidrawYjsBinding } from "../excalidraw-yjs-binding";

class FakeTransport implements WhiteboardTransport {
  peer: FakeTransport | null = null;
  readonly sent: Uint8Array[] = [];
  private readonly listeners = {
    state: new Set<(update: Uint8Array) => void>(),
    update: new Set<(update: Uint8Array) => void>(),
    mode: new Set<(mode: "owner" | "open") => void>(),
    error: new Set<(payload: { event: string; message: string }) => void>(),
  };

  join(): void {}

  sendUpdate(update: Uint8Array): void {
    this.sent.push(update);
    this.peer?.deliver("update", update);
  }

  setMode(): void {}

  onState(callback: (update: Uint8Array) => void): () => void {
    this.listeners.state.add(callback);
    return () => this.listeners.state.delete(callback);
  }

  onUpdate(callback: (update: Uint8Array) => void): () => void {
    this.listeners.update.add(callback);
    return () => this.listeners.update.delete(callback);
  }

  onMode(callback: (mode: "owner" | "open") => void): () => void {
    this.listeners.mode.add(callback);
    return () => this.listeners.mode.delete(callback);
  }

  onError(callback: (payload: { event: string; message: string }) => void): () => void {
    this.listeners.error.add(callback);
    return () => this.listeners.error.delete(callback);
  }

  /** Server-side injection point (join state / relayed peer update). */
  deliver(kind: "state" | "update", update: Uint8Array): void {
    for (const listener of this.listeners[kind]) listener(update);
  }
}

function pair(): { a: FakeTransport; b: FakeTransport } {
  const a = new FakeTransport();
  const b = new FakeTransport();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

class Scene implements WhiteboardSceneApi {
  elements: readonly ExcalidrawElementLike[] = [];

  updateScene(scene: { elements: readonly ExcalidrawElementLike[] }): void {
    this.elements = scene.elements;
  }
}
/**
 * Real Excalidraw already renders its own edit before handing it to the
 * binding, so the fake scene mirrors that before the diff runs.
 */
function localEdit(
  binding: ExcalidrawYjsBinding,
  scene: Scene,
  elements: readonly ExcalidrawElementLike[],
): void {
  scene.updateScene({ elements });
  binding.handleLocalChange(elements);
}
function element(id: string, version: number, nonce = 1): ExcalidrawElementLike {
  return { id, type: "rectangle", version, versionNonce: nonce, x: version };
}

const flush = async (): Promise<void> => {
  // Drain the bindings' microtask flushes deterministically (no timed wait).
  const { promise, resolve } = Promise.withResolvers<void>();
  queueMicrotask(() => queueMicrotask(() => queueMicrotask(resolve)));
  await promise;
};

function wiredPair(): {
  a: ExcalidrawYjsBinding;
  b: ExcalidrawYjsBinding;
  sceneA: Scene;
  sceneB: Scene;
} {
  const wire = pair();
  const a = new ExcalidrawYjsBinding(wire.a);
  const b = new ExcalidrawYjsBinding(wire.b);
  const sceneA = new Scene();
  const sceneB = new Scene();
  a.attach(sceneA);
  b.attach(sceneB);
  return { a, b, sceneA, sceneB };
}

describe("ExcalidrawYjsBinding", () => {
  it("propagates a local edit to a remote scene and converges", async () => {
    const { a, b, sceneB } = wiredPair();

    a.handleLocalChange([element("el:1", 1)]);
    await flush();

    expect(sceneB.elements.map((el) => el.id)).toEqual(["el:1"]);
    expect(b.doc.getMap("elements").get("el:1")).toEqual(element("el:1", 1));
    expect(Y.encodeStateAsUpdate(a.doc)).toEqual(Y.encodeStateAsUpdate(b.doc));
  });

  it("keeps z-order across concurrent insertions on both sides", async () => {
    const { a, b, sceneA, sceneB } = wiredPair();

    localEdit(a, sceneA, [element("el:1", 1), element("el:2", 1)]);
    await flush();
    localEdit(b, sceneB, [element("el:1", 1), element("el:2", 1), element("el:3", 1)]);
    await flush();

    expect(sceneA.elements.map((el) => el.id)).toEqual(["el:1", "el:2", "el:3"]);
    expect(sceneB.elements.map((el) => el.id)).toEqual(["el:1", "el:2", "el:3"]);
  });

  it("propagates deletions to the remote scene", async () => {
    const { a, sceneB } = wiredPair();

    a.handleLocalChange([element("el:1", 1), element("el:2", 1)]);
    await flush();
    a.handleLocalChange([element("el:2", 2)]);
    await flush();

    expect(sceneB.elements.map((el) => el.id)).toEqual(["el:2"]);
    expect(a.doc.getMap("elements").has("el:1")).toBe(false);
  });

  it("propagates in-place point mutation of the same element object", async () => {
    // Excalidraw appends freedraw points to the SAME array of the SAME
    // element object during a gesture; a stored-copy comparison sees the
    // mutated array and used to freeze the stroke at its first point.
    const { a, b, sceneA } = wiredPair();
    const stroke = {
      id: "stroke:live",
      type: "freedraw",
      version: 2,
      versionNonce: 7,
      x: 0,
      y: 0,
      points: [[0, 0]] as unknown[],
    } as unknown as ExcalidrawElementLike;

    localEdit(a, sceneA, [stroke]);
    for (let i = 1; i <= 5; i += 1) {
      (stroke.points as unknown[]).push([i * 10, i * 5]);
      localEdit(a, sceneA, [stroke]);
      await flush();
    }

    const stored: unknown = b.doc.getMap("elements").get("stroke:live");
    expect((stored as { points?: unknown[] }).points).toHaveLength(6);
  });

  it("skips stale local writes behind a newer remote version", async () => {
    const { a, b } = wiredPair();

    a.handleLocalChange([element("el:1", 5)]);
    await flush();

    // A stale local scene (version behind the document) must not win.
    a.handleLocalChange([element("el:1", 2)]);
    await flush();

    expect(a.doc.getMap("elements").get("el:1")).toEqual(element("el:1", 5));
    expect(b.doc.getMap("elements").get("el:1")).toEqual(element("el:1", 5));
  });

  it("undoes the local user action on every scene", async () => {
    const { a, sceneA, sceneB } = wiredPair();

    a.handleLocalChange([element("el:1", 1)]);
    await flush();
    expect(a.historyState()).toEqual({ canUndo: true, canRedo: false });

    a.undo();
    await flush();

    expect(sceneA.elements).toEqual([]);
    expect(sceneB.elements).toEqual([]);
    expect(a.historyState()).toEqual({ canUndo: false, canRedo: true });
  });

  it("undo reverts only the local user actions, never remote ones", async () => {
    const { a, b, sceneA, sceneB } = wiredPair();

    localEdit(a, sceneA, [element("el:mine", 1)]);
    await flush();
    localEdit(b, sceneB, [element("el:mine", 1), element("el:theirs", 1)]);
    await flush();

    b.undo();
    await flush();

    expect(sceneA.elements.map((el) => el.id)).toEqual(["el:mine"]);
    expect(sceneB.elements.map((el) => el.id)).toEqual(["el:mine"]);
  });

  it("applies late-joiner state exactly like live updates", async () => {
    const authoritative = new ExcalidrawYjsBinding(new FakeTransport());
    authoritative.handleLocalChange([element("el:1", 3)]);
    // Simulate the server: it holds the document and sends the full state.
    const state = Y.encodeStateAsUpdate(authoritative.doc);

    const wire = new FakeTransport();
    const late = new ExcalidrawYjsBinding(wire);
    const lateScene = new Scene();
    late.attach(lateScene);
    wire.deliver("state", state);
    await flush();

    expect(lateScene.elements).toEqual([element("el:1", 3)]);
    expect(late.historyState()).toEqual({ canUndo: false, canRedo: false });
  });

  it("never echoes remote frames back to the transport", () => {
    const wireA = new FakeTransport();
    const wireB = new FakeTransport();
    new ExcalidrawYjsBinding(wireA);
    new ExcalidrawYjsBinding(wireB);

    wireB.deliver("state", new Uint8Array([0, 1, 2]));
    wireB.deliver("update", new Uint8Array([3, 4]));

    expect(wireA.sent).toEqual([]);
    expect(wireB.sent).toEqual([]);
  });

  it("replays document state into a scene attached after the updates arrived", async () => {
    const wireA = new FakeTransport();
    const wireB = new FakeTransport();
    wireA.peer = wireB;
    wireB.peer = wireA;
    const bindingA = new ExcalidrawYjsBinding(wireA);
    // Late joiner: the binding exists, but the engine has not attached a
    // scene yet (the Excalidraw bundle is still loading).
    const bindingB = new ExcalidrawYjsBinding(wireB);
    localEdit(bindingA, new Scene(), [element("el:1", 1)]);
    await flush();

    const sceneB = new Scene();
    bindingB.attach(sceneB);
    await flush();

    expect(sceneB.elements).toEqual([element("el:1", 1)]);
  });

  it("propagates freedraw point growth when the version is unchanged", async () => {
    const wireA = new FakeTransport();
    const wireB = new FakeTransport();
    wireA.peer = wireB;
    wireB.peer = wireA;
    const bindingA = new ExcalidrawYjsBinding(wireA);
    const bindingB = new ExcalidrawYjsBinding(wireB);
    const sceneA = new Scene();
    bindingA.attach(sceneA);
    const stroke = (points: number[][]): ExcalidrawElementLike =>
      ({
        id: "stroke:1",
        type: "freedraw",
        version: 2,
        versionNonce: 7,
        x: 0,
        y: 0,
        points,
      }) as unknown as ExcalidrawElementLike;

    localEdit(bindingA, sceneA, [stroke([[0, 0]])]);
    await flush();

    // Excalidraw keeps version while the gesture is in flight.
    localEdit(bindingA, sceneA, [
      stroke([
        [0, 0],
        [10, 5],
        [20, 9],
      ]),
    ]);
    await flush();

    // Both gesture transactions must have been relayed to the room.
    expect(wireA.sent.length).toBeGreaterThanOrEqual(2);

    const stored: unknown = bindingB.doc.getMap("elements").get("stroke:1");
    expect(stored).toBeTruthy();
    const points = (stored as { points?: unknown }).points;
    expect(points).toHaveLength(3);
  });

  it("ignores the engine echo of a remote apply instead of re-sending it", async () => {
    const wireA = new FakeTransport();
    const wireB = new FakeTransport();
    wireA.peer = wireB;
    wireB.peer = wireA;
    const bindingA = new ExcalidrawYjsBinding(wireA);
    const bindingB = new ExcalidrawYjsBinding(wireB);
    const sceneB = new Scene();
    bindingB.attach(sceneB);

    localEdit(bindingA, new Scene(), [element("el:1", 1)]);
    await flush();
    expect(sceneB.elements).toHaveLength(1);

    // Engine echoes the scene applyScene just pushed.
    bindingB.handleLocalChange(sceneB.elements);

    expect(wireB.sent).toEqual([]);
    expect(bindingB.historyState()).toEqual({ canUndo: false, canRedo: false });
  });

  it("ignores a stale pre-apply onChange instead of wiping the board", async () => {
    const wireA = new FakeTransport();
    const wireB = new FakeTransport();
    wireA.peer = wireB;
    wireB.peer = wireA;
    const bindingA = new ExcalidrawYjsBinding(wireA);
    const bindingB = new ExcalidrawYjsBinding(wireB);
    bindingB.attach(new Scene());

    localEdit(bindingA, new Scene(), [element("el:1", 1)]);
    await flush();

    // Excalidraw may deliver the scene snapshot from before the remote
    // apply; treating it as local would delete el:1 for everyone.
    bindingB.handleLocalChange([]);

    expect(wireB.sent).toEqual([]);
    const ids = Array.from(bindingB.doc.getMap("elements").keys());
    expect(ids).toEqual(["el:1"]);
  });
});
