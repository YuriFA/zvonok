/**
 * Minimal concurrency primitives for serializing and deduplicating async
 * work. Callers own the pending map, so scope is explicit (per manager
 * instance, per hook instance) and entries stay clearable from lifecycle
 * code such as disconnect teardown.
 */

type PendingMap = Map<string, Promise<unknown>>;

/**
 * Runs `fn` serially per `tag`: while another tagged fn is in flight, this
 * one waits for it to settle (resolved or rejected) before starting.
 * Returns the caller's own promise; the in-flight entry is removed once the
 * tail of the chain settles.
 */
export function withoutConcurrency<T>(
  pending: PendingMap,
  tag: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = pending.get(tag);
  const promise = previous ? previous.then(fn, fn) : fn();
  pending.set(tag, promise);
  void promise
    .catch(() => {})
    .finally(() => {
      if (pending.get(tag) === promise) {
        pending.delete(tag);
      }
    });
  return promise;
}

/**
 * Concurrent callers tagged with the same tag share the in-flight promise
 * instead of starting another run; after settlement the next call starts
 * fresh. A rejected run is shared too, then cleared.
 */
export function singleFlight<T>(
  pending: PendingMap,
  tag: string,
  fn: () => Promise<T>,
): Promise<T> {
  const inFlight = pending.get(tag);
  if (inFlight) {
    return inFlight as Promise<T>;
  }
  const promise = fn();
  pending.set(tag, promise);
  void promise
    .catch(() => {})
    .finally(() => {
      if (pending.get(tag) === promise) {
        pending.delete(tag);
      }
    });
  return promise;
}

/** True while a tagged run is in flight in the given pending map. */
export function hasPending(pending: PendingMap, tag: string): boolean {
  return pending.has(tag);
}
