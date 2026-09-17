import { describe, expect, it } from "vitest";

import { WHITEBOARD_JOIN, WHITEBOARD_UPDATE } from "../protocol";
import { createWhiteboardTransport, type WhiteboardSocketLike } from "../transport";

type Handler = (...args: unknown[]) => void;

class FakeSocket {
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  private readonly handlers = new Map<string, Set<Handler>>();

  emit(event: string, ...args: unknown[]): void {
    this.sent.push({ event, payload: args[0] });
  }

  on(event: string, handler: Handler): void {
    const listeners = this.handlers.get(event) ?? new Set<Handler>();
    listeners.add(handler);
    this.handlers.set(event, listeners);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  receive(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

function socketLike(socket: FakeSocket): WhiteboardSocketLike {
  return socket as unknown as WhiteboardSocketLike;
}

describe("createWhiteboardTransport", () => {
  it("joins with the room slug", () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");

    transport.join();

    expect(socket.sent).toEqual([{ event: WHITEBOARD_JOIN, payload: { roomSlug: "room-a" } }]);
  });

  it("sends updates addressed to the room", () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");
    const update = new Uint8Array([1, 2, 3]);

    transport.sendUpdate(update);

    expect(socket.sent).toEqual([
      { event: WHITEBOARD_UPDATE, payload: { roomSlug: "room-a", update } },
    ]);
  });

  it("delivers state and update payloads as Uint8Array, accepting ArrayBuffer frames", () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");
    const statePayloads: Uint8Array[] = [];
    const updatePayloads: Uint8Array[] = [];
    transport.onState((update) => statePayloads.push(update));
    transport.onUpdate((update) => updatePayloads.push(update));

    const asBuffer = new Uint8Array([9, 9]).buffer;
    socket.receive("whiteboard:state", { roomSlug: "room-a", update: asBuffer });
    socket.receive("whiteboard:update", { roomSlug: "room-a", update: new Uint8Array([7]) });

    expect(statePayloads).toEqual([new Uint8Array([9, 9])]);
    expect(updatePayloads).toEqual([new Uint8Array([7])]);
  });

  it("delivers frames that arrive before any consumer subscribed once one attaches", async () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");

    // Join state beats engine mount: the frames land with no listeners yet.
    socket.receive("whiteboard:state", { roomSlug: "room-a", update: new Uint8Array([1]) });
    socket.receive("whiteboard:update", { roomSlug: "room-a", update: new Uint8Array([2]) });
    const statePayloads: Uint8Array[] = [];
    const updatePayloads: Uint8Array[] = [];
    transport.onState((update) => statePayloads.push(update));
    transport.onUpdate((update) => updatePayloads.push(update));
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(statePayloads).toEqual([new Uint8Array([1])]);
    expect(updatePayloads).toEqual([new Uint8Array([2])]);

    // Live frames keep flowing after the flush.
    socket.receive("whiteboard:update", { roomSlug: "room-a", update: new Uint8Array([3]) });
    expect(updatePayloads).toEqual([new Uint8Array([2]), new Uint8Array([3])]);
  });

  it("ignores malformed binary payloads and invalid modes", () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");
    const states: Uint8Array[] = [];
    const modes: string[] = [];
    transport.onState((update) => states.push(update));
    transport.onMode((mode) => modes.push(mode));

    socket.receive("whiteboard:state", { roomSlug: "room-a", update: "not-binary" });
    socket.receive("whiteboard:mode", { roomSlug: "room-a", mode: "nonsense" });
    socket.receive("whiteboard:mode", { roomSlug: "room-a", mode: "open" });

    expect(states).toEqual([]);
    expect(modes).toEqual(["open"]);
  });

  it("unsubscribes listeners", () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");
    const modes: string[] = [];
    const unsubscribe = transport.onMode((mode) => modes.push(mode));

    socket.receive("whiteboard:mode", { roomSlug: "room-a", mode: "owner" });
    unsubscribe();
    socket.receive("whiteboard:mode", { roomSlug: "room-a", mode: "open" });

    expect(modes).toEqual(["owner"]);
  });

  it("forwards error payloads", () => {
    const socket = new FakeSocket();
    const transport = createWhiteboardTransport(socketLike(socket), "room-a");
    const errors: unknown[] = [];
    transport.onError((payload) => errors.push(payload));

    socket.receive("whiteboard:error", { event: "whiteboard:update", message: "Rejected" });
    socket.receive("whiteboard:error", { event: "whiteboard:update" });

    expect(errors).toEqual([{ event: "whiteboard:update", message: "Rejected" }]);
  });
});
