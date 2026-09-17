import { act, renderHook } from "@testing-library/react";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { SfuBroadcastError } from "@zvonok/client/sfu/types";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ZvonokProvider,
  useZvonokSession,
  type ZvonokSession,
} from "../contexts/zvonok-context.js";
import { ZvonokBroadcastError } from "../errors.js";
import { useBroadcast, useBroadcasts } from "../hooks/use-broadcast.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

interface BroadcastHookResult {
  send: ReturnType<typeof useBroadcast>;
  receive: ReturnType<typeof useBroadcasts>;
  session: ZvonokSession;
}

function renderBroadcasts(topic: string) {
  return renderHook(
    () => ({
      send: useBroadcast(),
      receive: useBroadcasts(topic),
      session: useZvonokSession(),
    }),
    { wrapper: Provider },
  );
}

async function attachManager(result: { current: BroadcastHookResult }, sfu: MockSfuManager) {
  await act(async () => {
    result.current.session.store.setManager(sfu.manager as unknown as SfuManager);
    result.current.session.store.joined();
  });
}

function message(
  overrides: Partial<Parameters<MockSfuManager["manager"]["simulateBroadcast"]>[0]> = {},
) {
  return {
    senderId: "user-2",
    topic: "reactions",
    payload: { emoji: "wave" },
    timestamp: "2026-09-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("useBroadcast / useBroadcasts", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("sends through the manager and resolves on its acknowledgement", async () => {
    const { result } = renderBroadcasts("reactions");
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.send.send("reactions", { emoji: "wave" });
    });

    expect(sfu.manager.sendBroadcast).toHaveBeenCalledWith("reactions", { emoji: "wave" });
  });

  it("rejects with the typed SDK error carrying the server's code", async () => {
    const { result } = renderBroadcasts("reactions");
    await attachManager(result, sfu);
    sfu.manager.sendBroadcast.mockRejectedValueOnce(
      new SfuBroadcastError("MISSING_CAPABILITY", "denied"),
    );

    let caught: unknown;
    await act(async () => {
      caught = await result.current.send.send("reactions", 1).catch((error: unknown) => error);
    });

    expect(caught).toBeInstanceOf(ZvonokBroadcastError);
    expect((caught as ZvonokBroadcastError).code).toBe("MISSING_CAPABILITY");
  });

  it("rejects with DISCONNECTED before a manager exists", async () => {
    const { result } = renderBroadcasts("reactions");

    let caught: unknown;
    await act(async () => {
      caught = await result.current.send.send("reactions", 1).catch((error: unknown) => error);
    });

    expect((caught as ZvonokBroadcastError).code).toBe("DISCONNECTED");
  });

  it("delivers only the subscribed topic's messages, oldest first", async () => {
    const { result } = renderBroadcasts("reactions");
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.simulateBroadcast(message({ payload: { emoji: "one" } }));
      sfu.manager.simulateBroadcast(message({ topic: "chat", payload: "off-topic" }));
      sfu.manager.simulateBroadcast(message({ payload: { emoji: "two" }, senderId: "user-3" }));
    });

    expect(result.current.receive.messages).toEqual([
      message({ payload: { emoji: "one" } }),
      message({ payload: { emoji: "two" }, senderId: "user-3" }),
    ]);
  });

  it("never feeds the sender's own sends into the receive surface", async () => {
    const { result } = renderBroadcasts("reactions");
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.send.send("reactions", { emoji: "mine" });
    });

    expect(result.current.receive.messages).toEqual([]);
  });

  it("resubscribes when the topic changes and clears the list", async () => {
    const { result, rerender } = renderBroadcasts("reactions");
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.simulateBroadcast(message());
    });
    expect(result.current.receive.messages).toHaveLength(1);

    rerender();
    await act(async () => {
      rerender();
    });
    // Topic change mounts a fresh subscription: no replay of old messages.
    const { result: chatResult } = renderBroadcasts("chat");
    await attachManager(chatResult, sfu);
    expect(chatResult.current.receive.messages).toEqual([]);
  });
});
