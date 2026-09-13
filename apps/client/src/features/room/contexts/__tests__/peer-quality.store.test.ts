import { describe, expect, it } from "vitest";

import { PeerQualityStore } from "../peer-quality.store";

describe("PeerQualityStore visibility", () => {
  it("defaults to visible and skips unchanged writes", () => {
    const store = new PeerQualityStore();
    const seen: string[] = [];
    store.subscribeVisibility((userId) => seen.push(userId));

    expect(store.isViewportVisible("u1")).toBe(true);

    // First "visible" write for an unknown user: already the default.
    store.setVisibility("u1", true);
    expect(seen).toEqual([]);

    store.setVisibility("u1", false);
    expect(store.isViewportVisible("u1")).toBe(false);
    expect(seen).toEqual(["u1"]);

    // Same value again: no notification.
    store.setVisibility("u1", false);
    expect(seen).toEqual(["u1"]);

    store.setVisibility("u1", true);
    expect(store.isViewportVisible("u1")).toBe(true);
    expect(seen).toEqual(["u1", "u1"]);
  });

  it("drops hidden state on reset", () => {
    const store = new PeerQualityStore();
    store.setVisibility("u1", false);
    expect(store.isViewportVisible("u1")).toBe(false);

    store.reset();
    expect(store.isViewportVisible("u1")).toBe(true);
  });
});
