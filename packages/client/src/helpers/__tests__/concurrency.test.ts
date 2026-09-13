import { describe, expect, it, vi } from "vitest";

import { hasPending, singleFlight, withoutConcurrency } from "../concurrency.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withoutConcurrency", () => {
  it("serializes runs with the same tag", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const order: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();

    const run = (gate: typeof first, name: string) =>
      withoutConcurrency(pending, "track", async () => {
        order.push(`start:${name}`);
        await gate.promise;
        order.push(`end:${name}`);
      });

    const a = run(first, "a");
    const b = run(second, "b");

    await vi.waitFor(() => expect(order).toEqual(["start:a"]));
    first.resolve();
    await a;
    await vi.waitFor(() => expect(order).toEqual(["start:a", "end:a", "start:b"]));
    second.resolve();
    await b;
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("runs different tags in parallel", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const gate = deferred<void>();
    let started = 0;

    const run = (tag: string) =>
      withoutConcurrency(pending, tag, async () => {
        started += 1;
        await gate.promise;
      });

    const a = run("audio");
    const b = run("video");
    expect(started).toBe(2);

    gate.resolve();
    await Promise.all([a, b]);
  });

  it("chains across a failed run and clears the entry at the tail", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const a = withoutConcurrency(pending, "tag", async () => {
      throw new Error("boom");
    });
    const b = withoutConcurrency(pending, "tag", async () => "recovered");

    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("recovered");
    await vi.waitFor(() => expect(hasPending(pending, "tag")).toBe(false));
  });
});

describe("singleFlight", () => {
  it("shares the in-flight promise between concurrent callers", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const gate = deferred<string>();
    let runs = 0;

    const join = () =>
      singleFlight(pending, "join", () => {
        runs += 1;
        return gate.promise;
      });

    const a = join();
    const b = join();
    expect(runs).toBe(1);

    gate.resolve("done");
    await expect(a).resolves.toBe("done");
    await expect(b).resolves.toBe("done");
  });

  it("starts a fresh run after settlement and after rejection", async () => {
    const pending = new Map<string, Promise<unknown>>();
    let runs = 0;
    const run = () =>
      singleFlight(pending, "op", async () => {
        runs += 1;
        if (runs === 1) {
          throw new Error("first fails");
        }
        return "second ok";
      });

    await expect(run()).rejects.toThrow("first fails");
    await expect(run()).resolves.toBe("second ok");
    expect(runs).toBe(2);
    expect(hasPending(pending, "op")).toBe(false);
  });
});

describe("hasPending", () => {
  it("reflects the in-flight window only", async () => {
    const pending = new Map<string, Promise<unknown>>();
    const gate = deferred<void>();

    const run = singleFlight(pending, "op", () => gate.promise);
    expect(hasPending(pending, "op")).toBe(true);

    gate.resolve(undefined);
    await run;
    await vi.waitFor(() => expect(hasPending(pending, "op")).toBe(false));
  });
});
