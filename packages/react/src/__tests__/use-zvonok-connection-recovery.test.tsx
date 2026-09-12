import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useZvonokConnection } from "../use-zvonok-connection.js";
import { ZvonokProvider } from "../zvonok-context.js";
import { createMockSfuManager, tokenFor } from "./doubles.js";

const sfuHarness = vi.hoisted(() => ({
  instances: [] as ReturnType<typeof createMockSfuManager>[],
}));
vi.mock("@zvonok/client/sfu/manager", () => {
  const SfuManagerModule = {
    SfuManager: vi.fn(function () {
      const mock = createMockSfuManager();
      sfuHarness.instances.push(mock);
      return mock.manager;
    }),
  };
  return {
    SfuManager: SfuManagerModule.SfuManager,
    createSfuManager: vi.fn(() => new SfuManagerModule.SfuManager()),
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

function renderConnection(tokenProvider?: () => Promise<string>) {
  return renderHook(
    () =>
      useZvonokConnection({ roomSlug: "room-1", token: TOKEN, tokenProvider }),
    { wrapper: Provider },
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

describe("useZvonokConnection recovery", () => {
  beforeEach(() => {
    sfuHarness.instances.length = 0;
  });

  it("moves joined -> reconnecting -> joined through a blip", async () => {
    const { result } = renderConnection();
    await joinFully(result);
    expect(result.current.status).toBe("joined");

    act(() => {
      lastSfu().manager.simulateConnected("reconnecting");
    });
    expect(result.current.status).toBe("reconnecting");

    act(() => {
      lastSfu().manager.simulateConnected("connected");
    });
    expect(result.current.status).toBe("joined");
  });

  it("passes the token provider through to the manager join", async () => {
    const tokenProvider = async () => "fresh-token";
    const { result } = renderConnection(tokenProvider);
    await joinFully(result);

    expect(lastSfu().manager.joinRoom).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN }),
      { tokenProvider },
    );
  });

  it("surfaces recovery exhaustion as a typed error", async () => {
    const { result } = renderConnection();
    await joinFully(result);

    act(() => {
      lastSfu().manager.simulateReconnectError(
        "RECONNECT_EXHAUSTED",
        "Could not re-establish the signalling connection",
      );
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatchObject({ code: "RECONNECT_FAILED" });
  });

  it("keeps kick terminal: wasKicked wins over reconnecting", async () => {
    const { result } = renderConnection();
    await joinFully(result);

    act(() => {
      lastSfu().manager.simulateConnected("reconnecting");
    });
    expect(result.current.status).toBe("reconnecting");

    act(() => {
      lastSfu().manager.emitKicked("room-1");
    });

    expect(result.current.wasKicked).toBe(true);
    expect(result.current.status).toBe("disconnected");
  });
});
