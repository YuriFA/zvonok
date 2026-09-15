import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZvonokJoinError } from "../errors.js";
import { useZvonokConnection } from "../use-zvonok-connection.js";
import { ZvonokProvider } from "../zvonok-context.js";
import { createMockSfuManager, createTrack, tokenFor } from "./doubles.js";

const sfuHarness = vi.hoisted(() => ({
  instances: [] as unknown[],
  next: null as unknown,
}));
const connectionHarness = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@zvonok/client/sfu/manager", () => {
  const SfuManagerModule = {
    SfuManager: vi.fn(function () {
      if (sfuHarness.next) {
        const seeded = sfuHarness.next as ReturnType<
          typeof createMockSfuManager
        >;
        sfuHarness.next = null;
        sfuHarness.instances.push(seeded);
        return seeded.manager;
      }
      const mock = createMockSfuManager();
      sfuHarness.instances.push(mock);
      return mock.manager;
    }),
  };
  return {
    SfuManager: SfuManagerModule.SfuManager,
    createSfuManager: vi.fn((options: { serverUrl?: string } = {}) => {
      connectionHarness.urls.push(options.serverUrl ?? "");
      const MockSfuManager = vi.mocked(SfuManagerModule.SfuManager);
      return new MockSfuManager();
    }),
  };
});

const TOKEN = tokenFor({
  participantId: "participant-9",
  projectId: "p1",
  roomId: "room-1",
});

function Provider({ children }: { children: React.ReactNode }) {
  return (
    <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>
  );
}

function renderConnection() {
  return renderHook(
    () => useZvonokConnection({ roomSlug: "room-1", token: TOKEN }),
    {
      wrapper: Provider,
    },
  );
}

function lastSfu() {
  return sfuHarness.instances.at(-1) as ReturnType<typeof createMockSfuManager>;
}

async function joinFully(
  result: ReturnType<typeof renderConnection>["result"],
) {
  let promise: Promise<void> = Promise.resolve();
  act(() => {
    promise = result.current.join();
  });
  // Flush microtasks so the hook finishes subscribing to the join ack.
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    lastSfu().socket.fire("sfu:joined");
  });
  await act(async () => {
    await promise;
  });
}

describe("useZvonokConnection", () => {
  beforeEach(() => {
    sfuHarness.instances.length = 0;
    sfuHarness.next = null;
    connectionHarness.urls.length = 0;
  });

  it("transitions disconnected -> connecting -> joined and creates the manager with the server url", async () => {
    const { result } = renderConnection();

    let promise: Promise<void> = Promise.resolve();
    act(() => {
      promise = result.current.join();
    });
    expect(result.current.status).toBe("connecting");
    // Flush microtasks so the hook finishes subscribing to the join ack.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      lastSfu().socket.fire("sfu:joined");
    });
    await act(async () => {
      await promise;
    });

    expect(result.current.status).toBe("joined");
    expect(connectionHarness.urls).toEqual(["https://sfu.test"]);
    expect(result.current.manager).toBe(lastSfu().manager);
  });

  function renderConnectionWith(
    options: Parameters<typeof useZvonokConnection>[0],
  ) {
    return renderHook(() => useZvonokConnection(options), {
      wrapper: Provider,
    });
  }

  it("joins on the browser session without a token (cookie identity)", async () => {
    const { result } = renderConnectionWith({ roomSlug: "room-1" });
    await joinFully(result);

    expect(lastSfu().manager.joinRoom).toHaveBeenCalledWith(
      { roomSlug: "room-1" },
      { tokenProvider: undefined },
    );
  });

  it("joins by room id alone", async () => {
    const { result } = renderConnectionWith({ roomId: "room-id-9" });
    await joinFully(result);

    expect(lastSfu().manager.joinRoom).toHaveBeenCalledWith(
      { roomId: "room-id-9" },
      { tokenProvider: undefined },
    );
  });

  it("joins with both identifiers and a token", async () => {
    const { result } = renderConnectionWith({
      roomId: "room-id-9",
      roomSlug: "room-1",
      token: TOKEN,
    });
    await joinFully(result);

    expect(lastSfu().manager.joinRoom).toHaveBeenCalledWith(
      { roomId: "room-id-9", roomSlug: "room-1", token: TOKEN },
      { tokenProvider: undefined },
    );
  });

  it("rejects a join without any room identifier with a typed error", async () => {
    const { result } = renderConnectionWith({});

    await act(async () => {
      await expect(result.current.join()).rejects.toMatchObject({
        code: "INVALID_JOIN_PAYLOAD",
      });
    });
    expect(sfuHarness.instances).toHaveLength(0);
    expect(result.current.status).toBe("disconnected");
  });

  it("passes the mobile hint through produceTrack", async () => {
    const { result } = renderConnectionWith({
      roomSlug: "room-1",
      token: TOKEN,
    });
    await joinFully(result);

    await act(async () => {
      await result.current.produceTrack(createTrack("video", "v-mobile"), {
        isMobile: true,
      });
    });
    expect(lastSfu().manager.produce).toHaveBeenCalledWith(expect.anything(), {
      isMobile: true,
    });
  });

  it("surfaces room-ended, releases the connection, and stops recovery", async () => {
    const { result } = renderConnectionWith({
      roomSlug: "room-1",
      token: TOKEN,
    });
    await joinFully(result);

    act(() => {
      lastSfu().manager.emitRoomEnded("room-1");
    });

    expect(result.current.roomEnded).toBe(true);
    expect(result.current.status).toBe("disconnected");
    expect(lastSfu().manager.leaveRoom).toHaveBeenCalled();
    expect(lastSfu().manager.disconnect).toHaveBeenCalled();
    expect(result.current.manager).toBeNull();
  });

  it("joins with the room slug and token only, no client identity", async () => {
    const { result } = renderConnection();
    await joinFully(result);

    expect(lastSfu().manager.joinRoom).toHaveBeenCalledWith(
      { roomSlug: "room-1", token: TOKEN },
      { tokenProvider: undefined },
    );
  });

  it("rejects join with a typed error on sfu:join-error and surfaces status error", async () => {
    const { result } = renderConnection();

    let promise: Promise<void> = Promise.resolve();
    act(() => {
      promise = result.current.join();
    });
    await act(async () => {
      lastSfu().socket.fire("sfu:join-error", {
        code: "ROOM_LOCKED",
        message: "Room is locked",
      });
      await expect(promise).rejects.toBeInstanceOf(ZvonokJoinError);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatchObject({
      code: "ROOM_LOCKED",
      message: "Room is locked",
    });
  });

  it("deduplicates concurrent join calls", async () => {
    const { result } = renderConnection();

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.join();
      second = result.current.join();
    });
    act(() => {
      lastSfu().socket.fire("sfu:joined");
    });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(lastSfu().manager.connect).toHaveBeenCalledTimes(1);
  });

  it("times out when the server never confirms the join", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderConnection();

      // Mirror the rejection into a settled value immediately, so the
      // joined promise never carries an unhandled rejection past the tick
      // that fires the join timeout.
      let outcome: unknown;
      act(() => {
        outcome = result.current.join().then(
          () => null,
          (error: unknown) => error,
        );
      });
      let rejection: unknown;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
        rejection = await outcome;
      });
      expect(rejection).toMatchObject({ code: "JOIN_TIMEOUT" });
      expect(result.current.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails with CONNECTION_FAILED when the connection reports failure", async () => {
    const failing = createMockSfuManager();
    failing.manager.connect = vi.fn(() => {
      // Never becomes ready.
    });
    sfuHarness.next = failing;

    const { result } = renderConnection();

    let promise: Promise<void> = Promise.resolve();
    act(() => {
      promise = result.current.join();
    });
    act(() => {
      failing.manager.simulateConnected("failed");
    });
    await act(async () => {
      await expect(promise).rejects.toMatchObject({
        code: "CONNECTION_FAILED",
      });
    });
    expect(result.current.status).toBe("error");
  });

  it("tracks room lock broadcasts", async () => {
    const { result } = renderConnection();
    await joinFully(result);

    act(() => {
      lastSfu().socket.fire("sfu:room-locked", { locked: true });
    });
    expect(result.current.isRoomLocked).toBe(true);

    act(() => {
      lastSfu().socket.fire("sfu:room-locked", { locked: false });
    });
    expect(result.current.isRoomLocked).toBe(false);
  });

  it("flags wasKicked and drops to disconnected when kicked", async () => {
    const { result } = renderConnection();
    await joinFully(result);

    act(() => {
      lastSfu().manager.emitKicked("room-1");
    });

    expect(result.current.wasKicked).toBe(true);
    expect(result.current.status).toBe("disconnected");
  });

  it("leave tears down the manager and resets session state", async () => {
    const { result } = renderConnection();
    await joinFully(result);

    act(() => {
      result.current.leave();
    });

    const sfu = lastSfu();
    expect(sfu.manager.leaveRoom).toHaveBeenCalled();
    expect(sfu.manager.disconnect).toHaveBeenCalled();
    expect(result.current.status).toBe("disconnected");
    expect(result.current.manager).toBeNull();
    expect(result.current.wasKicked).toBe(false);
  });

  it("leave on unmount disconnects the manager", async () => {
    const { result, unmount } = renderConnection();
    await joinFully(result);

    unmount();
    expect(lastSfu().manager.disconnect).toHaveBeenCalled();
  });

  describe("publish controls", () => {
    it("pass through to the underlying manager", async () => {
      const { result } = renderConnection();
      await joinFully(result);

      const sfu = lastSfu();
      sfu.manager.getProducerByKind.mockReturnValue({ id: "audio-producer" });

      expect(
        await act(async () =>
          result.current.produceTrack(createTrack("video", "v1")),
        ),
      ).toBe(true);
      expect(sfu.manager.produce).toHaveBeenCalled();

      act(() => result.current.pauseProducer("audio"));
      expect(sfu.manager.pauseProducer).toHaveBeenCalledWith("audio-producer");

      act(() => result.current.resumeProducer("audio"));
      expect(sfu.manager.resumeProducer).toHaveBeenCalledWith("audio-producer");

      act(() => result.current.closeProducer("video"));
      expect(sfu.manager.closeProducer).toHaveBeenCalledWith("video");

      expect(
        await act(async () =>
          result.current.replaceTrack("audio", createTrack("audio", "a2")),
        ),
      ).toBe(true);

      expect(result.current.hasProducer("audio")).toBe(true);
      sfu.manager.getProducerByKind.mockReturnValue(undefined);
      expect(result.current.hasProducer("audio")).toBe(false);
    });

    it("reject with a typed error before joining", async () => {
      const { result } = renderConnection();

      await expect(
        result.current.produceTrack(createTrack("audio", "a1")),
      ).rejects.toMatchObject({
        code: "DISCONNECTED",
      });
    });
  });
  it("a leave during an in-flight join supersedes it without stale state", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderConnection();

      let joinPromise: Promise<void> = Promise.resolve();
      act(() => {
        joinPromise = result.current.join();
      });
      expect(result.current.status).toBe("connecting");

      act(() => {
        result.current.leave();
      });
      expect(result.current.status).toBe("disconnected");
      expect(result.current.manager).toBeNull();
      expect(lastSfu().manager.leaveRoom).toHaveBeenCalled();

      // The in-flight join never confirms (no ack); once its timers run out
      // it settles silently - no error status, no manager resurrection.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await expect(joinPromise).resolves.toBeUndefined();
      expect(result.current.status).toBe("disconnected");
      expect(result.current.error).toBeNull();
      expect(result.current.manager).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

});
