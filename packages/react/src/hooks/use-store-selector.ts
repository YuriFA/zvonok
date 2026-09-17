/**
 * Selector subscription over an external store: the component re-renders
 * only when its selected slice changes, not on every store mutation.
 * Mirrors stream-chat-react's useStateStore over `useSyncExternalStore`.
 *
 * Selector contract: return the slice you need (state field, named object,
 * or array) built from stable references. Fresh objects/arrays per call
 * would shallow-compare as changed and re-render on every mutation.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Minimal store contract shared by RoomTracker and AudioActivityEngine. */
export interface ExternalStore<T> {
  /** Notifies listeners after the snapshot changed; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Stable reference between mutations; safe for useSyncExternalStore. */
  getSnapshot(): T;
}

export function useStoreSelector<T extends object, S>(
  store: ExternalStore<T>,
  selector: (state: T) => S,
): S;
export function useStoreSelector<T extends object, S>(
  store: ExternalStore<T> | null,
  selector: (state: T) => S,
): S | undefined;
export function useStoreSelector<T extends object, S>(
  store: ExternalStore<T> | null,
  selector: (state: T) => S,
): S | undefined {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store?.subscribe(onStoreChange) ?? (() => {}),
    [store],
  );

  // Snapshot closure with a [snapshot, selected] cache: when the store
  // object is unchanged the cached selection is returned as-is, and when it
  // changed the new selection is shallow-compared per key so a semantically
  // equal slice keeps the old reference (no useSyncExternalStore loop).
  const getSnapshot = useMemo(() => {
    let cache: { snapshot: T; selected: S } | null = null;

    return () => {
      const snapshot = store?.getSnapshot();
      if (!snapshot) {
        return undefined;
      }

      if (cache && cache.snapshot === snapshot) {
        return cache.selected;
      }

      const selected = selector(snapshot);

      if (cache && shallowEqual(cache.selected, selected)) {
        return cache.selected;
      }

      cache = { snapshot, selected };
      return selected;
    };
  }, [store, selector]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

function shallowEqual(previous: unknown, next: unknown): boolean {
  if (typeof previous !== "object" || previous === null) {
    return previous === next;
  }
  if (typeof next !== "object" || next === null) {
    return false;
  }
  const previousKeys = Object.keys(previous);
  if (previousKeys.length !== Object.keys(next).length) {
    return false;
  }
  for (const key of previousKeys) {
    if ((previous as Record<string, unknown>)[key] !== (next as Record<string, unknown>)[key]) {
      return false;
    }
  }
  return true;
}
