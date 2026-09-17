import { act, renderHook } from "@testing-library/react";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ZvonokProvider, useZvonokSession } from "../contexts/zvonok-context.js";
import { useGuestJoinRequests } from "../hooks/use-guest-join-requests.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

function renderGuestRequests() {
  return renderHook(
    () => {
      const session = useZvonokSession();
      const hook = useGuestJoinRequests();
      return { session, hook };
    },
    { wrapper: Provider },
  );
}

async function attachManager(
  result: ReturnType<typeof renderGuestRequests>["result"],
  sfu: MockSfuManager,
) {
  await act(async () => {
    result.current.session.store.setManager(sfu.manager as unknown as SfuManager);
    result.current.session.store.joined();
  });
}

describe("useGuestJoinRequests", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("starts with an empty queue and gains a request on the wire event", async () => {
    const { result } = renderGuestRequests();
    expect(result.current.hook.pendingRequests).toEqual([]);

    await attachManager(result, sfu);
    act(() => {
      sfu.manager.emitGuestJoinRequest({ requestId: "req-1", displayName: "Guest Guy" });
    });

    expect(result.current.hook.pendingRequests).toEqual([
      { requestId: "req-1", displayName: "Guest Guy" },
    ]);
  });

  it("keeps arrival order and drops duplicates by request id", async () => {
    const { result } = renderGuestRequests();
    await attachManager(result, sfu);

    act(() => {
      sfu.manager.emitGuestJoinRequest({ requestId: "req-1", displayName: "First" });
      sfu.manager.emitGuestJoinRequest({ requestId: "req-2", displayName: "Second" });
      sfu.manager.emitGuestJoinRequest({ requestId: "req-1", displayName: "First replay" });
    });

    expect(result.current.hook.pendingRequests.map((r) => r.requestId)).toEqual(["req-1", "req-2"]);
  });

  it("removes a request after the consumer acted on it", async () => {
    const { result } = renderGuestRequests();
    await attachManager(result, sfu);
    act(() => {
      sfu.manager.emitGuestJoinRequest({ requestId: "req-1", displayName: "First" });
      sfu.manager.emitGuestJoinRequest({ requestId: "req-2", displayName: "Second" });
    });

    act(() => {
      result.current.hook.removeRequest("req-1");
    });

    expect(result.current.hook.pendingRequests.map((r) => r.requestId)).toEqual(["req-2"]);
  });

  it("clears the queue when the session goes away", async () => {
    const { result } = renderGuestRequests();
    await attachManager(result, sfu);
    act(() => {
      sfu.manager.emitGuestJoinRequest({ requestId: "req-1", displayName: "First" });
    });

    await act(async () => {
      result.current.session.store.disconnected();
    });

    expect(result.current.hook.pendingRequests).toEqual([]);
  });
});
