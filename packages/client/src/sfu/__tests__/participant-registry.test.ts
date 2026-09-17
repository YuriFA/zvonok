import { describe, expect, it } from "vitest";

import { ParticipantRegistry } from "../participant-registry.js";

describe("ParticipantRegistry", () => {
  it("creates a participant on first upsert with a fallback username", () => {
    const registry = new ParticipantRegistry();

    const { peer, created } = registry.upsert({ userId: "u1", username: "" });

    expect(created).toBe(true);
    expect(peer).toMatchObject({ userId: "u1", username: "" });
    expect(peer.producers.size).toBe(0);
    expect(peer.mediaConnected).toBeUndefined();
  });

  it("refreshes the username and marks media live on re-upsert", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });
    registry.markMediaDetached("u1");

    const { peer, created } = registry.upsert({ userId: "u1", username: "Ann II" });

    expect(created).toBe(false);
    expect(peer.username).toBe("Ann II");
    expect(peer.mediaConnected).toBe(true);
  });

  it("keeps the existing username when an update supplies none", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });

    const { peer } = registry.upsert({ userId: "u1" });

    expect(peer.username).toBe("Ann");
  });

  it("attachProducer records the announcement and marks media live", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });
    registry.markMediaDetached("u1");

    registry.attachProducer("u1", "p1", { kind: "video", paused: false, source: "camera" });

    const peer = registry.get("u1");
    expect(peer?.producers.get("p1")).toEqual({ kind: "video", paused: false, source: "camera" });
    expect(peer?.mediaConnected).toBe(true);
  });

  it("attachProducer ignores unknown participants", () => {
    const registry = new ParticipantRegistry();

    expect(() => registry.attachProducer("ghost", "p1", { kind: "audio" })).not.toThrow();
    expect(registry.get("ghost")).toBeUndefined();
  });

  it("markMediaDetached transitions only live participants", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });

    const detached = registry.markMediaDetached("u1");
    expect(detached?.mediaConnected).toBe(false);

    // Already detached: no second transition, no re-notification.
    expect(registry.markMediaDetached("u1")).toBeUndefined();
    expect(registry.markMediaDetached("ghost")).toBeUndefined();
  });

  it("remove returns the record and drops the participant", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });
    registry.attachProducer("u1", "p1", { kind: "audio" });

    const removed = registry.remove("u1");
    expect(removed?.producers.has("p1")).toBe(true);
    expect(registry.get("u1")).toBeUndefined();
    expect(registry.remove("u1")).toBeUndefined();
  });

  it("findProducer resolves the participant carrying a producer id", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });
    registry.attachProducer("u1", "p1", { kind: "video", paused: true, source: "screen" });

    expect(registry.findProducer("p1")).toEqual({
      userId: "u1",
      info: { kind: "video", paused: true, source: "screen" },
    });
    expect(registry.findProducer("missing")).toBeUndefined();
  });

  it("snapshot is a copy of the registry with shared records", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });

    const snapshot = registry.snapshot();
    registry.upsert({ userId: "u2", username: "Bob" });

    expect(snapshot.size).toBe(1);
    expect(snapshot.get("u1")).toBe(registry.get("u1"));
  });

  it("clear drops every participant", () => {
    const registry = new ParticipantRegistry();
    registry.upsert({ userId: "u1", username: "Ann" });
    registry.upsert({ userId: "u2", username: "Bob" });

    registry.clear();

    expect(registry.snapshot().size).toBe(0);
  });
});
