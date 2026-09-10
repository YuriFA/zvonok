import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SfuManager } from "@zvonok/client/sfu/manager";

import { useOwnCapabilities } from "../use-own-capabilities.js";
import {
  ZvonokProvider,
  useZvonokSession,
  type ZvonokSession,
} from "../zvonok-context.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

interface CapabilitiesHookResult {
  capabilities: string[];
  session: ZvonokSession;
}

function renderCapabilities() {
  return renderHook(
    () => ({ capabilities: useOwnCapabilities(), session: useZvonokSession() }),
    { wrapper: Provider },
  );
}

async function attachManager(
  result: { current: CapabilitiesHookResult },
  sfu: MockSfuManager,
) {
  await act(async () => {
    result.current.session.update({ manager: sfu.manager as unknown as SfuManager, status: "joined" });
  });
}

describe("useOwnCapabilities", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("is empty before a session exists", () => {
    const { result } = renderCapabilities();

    expect(result.current.capabilities).toEqual([]);
  });

  it("is empty after the manager exists but before the join acknowledgement", async () => {
    const { result } = renderCapabilities();
    await attachManager(result, sfu);

    expect(result.current.capabilities).toEqual([]);
  });

  it("mirrors the server-delivered list after join", async () => {
    const { result } = renderCapabilities();
    await attachManager(result, sfu);

    await act(async () => {
      sfu.manager.simulateCapabilities(["send-audio", "mute-users", "lock-room"]);
    });

    expect(result.current.capabilities).toEqual([
      "send-audio",
      "mute-users",
      "lock-room",
    ]);
  });
});
