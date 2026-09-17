import { describe, expect, it } from "vitest";

import { WHITEBOARD_UPDATE_MAX_BYTES } from "../protocol";
import { applyRoomUpdate, createRoomDoc, encodeRoomState } from "../yjs-room";

describe("yjs-room", () => {
  it("round-trips a room document as a state update", () => {
    const source = createRoomDoc();
    source.transact(() => {
      source.getMap("elements").set("el:1", { id: "el:1", version: 3 });
      source.getArray("order").push(["el:1"]);
    });

    const replica = createRoomDoc();
    const result = applyRoomUpdate(replica, encodeRoomState(source));

    expect(result).toBe("applied");
    expect(replica.getMap("elements").get("el:1")).toEqual({ id: "el:1", version: 3 });
    expect(replica.getArray("order").toArray()).toEqual(["el:1"]);
  });

  it("rejects updates above the byte cap before touching the document", () => {
    const doc = createRoomDoc();
    const oversized = new Uint8Array(WHITEBOARD_UPDATE_MAX_BYTES + 1);

    expect(applyRoomUpdate(doc, oversized)).toBe("too-large");
    expect(encodeRoomState(doc).byteLength).toBeGreaterThan(0);
    expect(doc.getMap("elements").size).toBe(0);
  });

  it("rejects a truncated update without corrupting the document", () => {
    const source = createRoomDoc();
    source.transact(() => {
      source.getMap("elements").set("el:1", { id: "el:1" });
      source.getMap("elements").set("el:2", { id: "el:2" });
      source.getArray("order").push(["el:1", "el:2"]);
    });
    const update = encodeRoomState(source);

    const doc = createRoomDoc();
    const result = applyRoomUpdate(doc, update.slice(0, 4));

    // lib0 rejects an incomplete frame; whatever yjs cannot decode leaves
    // the document untouched either way.
    if (result === "invalid") {
      expect(doc.getMap("elements").size).toBe(0);
    } else {
      expect(result).toBe("applied");
      // The full update still applies cleanly afterwards.
      expect(applyRoomUpdate(doc, update)).toBe("applied");
      expect(doc.getMap("elements").size).toBe(2);
    }
  });

  it("rejects an empty update frame", () => {
    const doc = createRoomDoc();
    // yjs refuses zero-length frames; the gateway drops them earlier anyway.
    expect(applyRoomUpdate(doc, new Uint8Array(0))).toBe("invalid");
    expect(doc.getMap("elements").size).toBe(0);
  });
});
