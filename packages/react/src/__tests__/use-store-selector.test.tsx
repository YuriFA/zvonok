import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStoreSelector, type ExternalStore } from "../hooks/use-store-selector.js";

interface FakeState {
  name: string;
  level: number;
}

class FakeStore implements ExternalStore<FakeState> {
  private listeners = new Set<() => void>();
  private snapshot: FakeState = { name: "a", level: 0 };

  getSnapshot = (): FakeState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<FakeState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

describe("useStoreSelector", () => {
  it("returns the selected slice and follows slice changes", () => {
    const store = new FakeStore();
    const { result } = renderHook(() => useStoreSelector(store, (s) => ({ name: s.name })));

    expect(result.current.name).toBe("a");

    act(() => store.set({ name: "b" }));

    expect(result.current.name).toBe("b");
  });

  it("skips re-renders when only unselected state changes", () => {
    const store = new FakeStore();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useStoreSelector(store, (s) => ({ name: s.name }));
    });

    act(() => store.set({ level: 1 }));
    act(() => store.set({ level: 2 }));

    expect(renders).toBe(1);
    expect(result.current.name).toBe("a");
  });

  it("keeps the previous reference when the selected slice is semantically equal", () => {
    const store = new FakeStore();
    const { result } = renderHook(() => useStoreSelector(store, (s) => ({ name: s.name })));
    const first = result.current;

    act(() => store.set({ name: "a", level: 5 }));

    expect(result.current).toBe(first);
  });

  it("updates when a selected array grows from empty", () => {
    const store = new FakeStore();
    const selectNamesAboveZero = (s: FakeState) => (s.level > 0 ? [s.name] : []);
    const { result } = renderHook(() => useStoreSelector(store, selectNamesAboveZero));

    expect(result.current).toEqual([]);

    act(() => store.set({ level: 1 }));

    expect(result.current).toEqual(["a"]);

    act(() => store.set({ name: "a", level: 1 }));

    expect(result.current).toEqual(["a"]);
  });

  it("supports primitive selectors", () => {
    const store = new FakeStore();
    const { result } = renderHook(() => useStoreSelector(store, (s) => s.level));

    expect(result.current).toBe(0);

    act(() => store.set({ level: 3 }));
    expect(result.current).toBe(3);

    act(() => store.set({ name: "x" }));
    expect(result.current).toBe(3);
  });

  it("returns undefined for a missing store", () => {
    const { result } = renderHook(() => useStoreSelector(null, (s: FakeState) => s.name));

    expect(result.current).toBeUndefined();
  });
});
