import { describe, expect, it, vi } from "vitest";

import { SessionStore } from "../core/session-store.js";

describe("SessionStore", () => {
  it("starts disconnected with no manager", () => {
    const store = new SessionStore();
    expect(store.getSnapshot()).toEqual({
      manager: null,
      status: "disconnected",
      error: null,
      locked: false,
      roomEnded: false,
      kicked: false,
    });
  });

  it("walks the join lifecycle through named transitions", () => {
    const store = new SessionStore();
    const manager = { id: "manager-1" };
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().status));

    store.setManager(manager as never);
    expect(store.getSnapshot().manager).toBe(manager);

    store.connecting();
    expect(store.getSnapshot().status).toBe("connecting");

    store.setLocked(true);
    expect(store.getSnapshot().locked).toBe(true);

    store.joined();
    expect(store.getSnapshot().status).toBe("joined");

    store.reconnecting();
    expect(store.getSnapshot().status).toBe("reconnecting");

    store.joined();
    expect(store.getSnapshot().status).toBe("joined");
    expect(store.getSnapshot().manager).toBe(manager);
    expect(store.getSnapshot().locked).toBe(true);
    expect(seen).toEqual([
      "disconnected",
      "connecting",
      "connecting",
      "joined",
      "reconnecting",
      "joined",
    ]);
  });

  it("carries the typed error on failure and clears it on the next join", () => {
    const store = new SessionStore();
    const error = new Error("JOIN_FAILED");
    store.failed(error);
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().error).toBe(error);

    store.connecting();
    expect(store.getSnapshot().error).toBeNull();
  });

  it("disconnected releases the manager and clears transient flags", () => {
    const store = new SessionStore();
    store.setManager({ id: "m" } as never);
    store.setLocked(true);
    store.kicked();
    expect(store.getSnapshot().kicked).toBe(true);
    expect(store.getSnapshot().status).toBe("disconnected");
    expect(store.getSnapshot().locked).toBe(false);
    expect(store.getSnapshot().manager).not.toBeNull();

    store.disconnected();
    expect(store.getSnapshot().manager).toBeNull();
    expect(store.getSnapshot().kicked).toBe(false);
    expect(store.getSnapshot().status).toBe("disconnected");
  });

  it("kicked keeps the manager alive; disconnected after room end keeps roomEnded", () => {
    const store = new SessionStore();
    const manager = { id: "m" };
    store.setManager(manager as never);
    store.kicked();
    expect(store.getSnapshot().manager).toBe(manager);

    store.setManager(manager as never);
    store.roomEnded();
    store.disconnected();
    expect(store.getSnapshot().roomEnded).toBe(true);
  });

  it("keeps the snapshot reference stable when a transition changes nothing", () => {
    const store = new SessionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const before = store.getSnapshot();
    store.setManager(null);
    store.setLocked(false);
    store.disconnected();
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes listeners", () => {
    const store = new SessionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.connecting();
    expect(listener).not.toHaveBeenCalled();
  });
});
