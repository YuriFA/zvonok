import { act, renderHook } from "@testing-library/react";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ZvonokProvider,
  useZvonokSession,
  type ZvonokSession,
} from "../contexts/zvonok-context.js";
import { useEgressState } from "../hooks/use-egress-state.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

interface EgressHookResult {
  state: {
    egress: {
      sessionId: string;
      outputs: { record: boolean; hls: boolean };
      status: string;
    } | null;
    isRecording: boolean;
    isLive: boolean;
  };
  session: ZvonokSession;
}

function renderEgressState() {
  return renderHook(() => ({ state: useEgressState(), session: useZvonokSession() }), {
    wrapper: Provider,
  });
}

async function attachManager(result: { current: EgressHookResult }, sfu: MockSfuManager) {
  await act(async () => {
    result.current.session.store.setManager(sfu.manager as unknown as SfuManager);
    result.current.session.store.joined();
  });
}

describe("useEgressState", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("is idle before any session broadcast", async () => {
    const { result } = renderEgressState();
    await attachManager(result, sfu);

    expect(result.current.state.egress).toBeNull();
    expect(result.current.state.isRecording).toBe(false);
    expect(result.current.state.isLive).toBe(false);
  });

  it("follows the session lifecycle", async () => {
    const { result } = renderEgressState();
    await attachManager(result, sfu);

    await act(async () => {
      sfu.manager.simulateEgressStatus({
        sessionId: "egress-1",
        outputs: { record: true, hls: true },
        status: "starting",
      });
    });
    expect(result.current.state.isRecording).toBe(true);
    expect(result.current.state.isLive).toBe(false);

    await act(async () => {
      sfu.manager.simulateEgressStatus({
        sessionId: "egress-1",
        outputs: { record: true, hls: true },
        status: "live",
      });
    });
    expect(result.current.state.isRecording).toBe(true);
    expect(result.current.state.isLive).toBe(true);

    await act(async () => {
      sfu.manager.simulateEgressStatus({
        sessionId: "egress-1",
        outputs: { record: true, hls: true },
        status: "ended",
      });
    });
    expect(result.current.state.isRecording).toBe(false);
    expect(result.current.state.isLive).toBe(false);
    expect(result.current.state.egress?.status).toBe("ended");
  });

  it("treats a failed session as not recording", async () => {
    const { result } = renderEgressState();
    await attachManager(result, sfu);

    await act(async () => {
      sfu.manager.simulateEgressStatus({
        sessionId: "egress-1",
        outputs: { record: true, hls: false },
        status: "failed",
      });
    });

    expect(result.current.state.isRecording).toBe(false);
  });
});
