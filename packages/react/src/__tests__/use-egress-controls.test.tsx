import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { SfuEgressActionError } from "@zvonok/client/sfu/types";
import type { SfuManager } from "@zvonok/client/sfu/manager";

import { ZvonokEgressError } from "../errors.js";
import { useEgressControls } from "../hooks/use-egress-controls.js";
import { ZvonokProvider, useZvonokSession, type ZvonokSession } from "../contexts/zvonok-context.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

interface ControlsHookResult {
  controls: ReturnType<typeof useEgressControls>;
  session: ZvonokSession;
}

function renderControls() {
  return renderHook(() => ({ controls: useEgressControls(), session: useZvonokSession() }), {
    wrapper: Provider,
  });
}

async function attachManager(result: { current: ControlsHookResult }, sfu: MockSfuManager) {
  await act(async () => {
    result.current.session.update({ manager: sfu.manager as unknown as SfuManager, status: "joined" });
  });
}

describe("useEgressControls", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("starts a session through the manager", async () => {
    const { result } = renderControls();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.controls.start({ record: true });
    });

    expect(sfu.manager.startEgress).toHaveBeenCalledWith({ record: true });
  });

  it("rejects with the server's coded denial", async () => {
    sfu.manager.startEgress.mockRejectedValueOnce(
      new SfuEgressActionError("MISSING_CAPABILITY", "Missing start-recording capability"),
    );
    const { result } = renderControls();
    await attachManager(result, sfu);

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.controls.start({ record: true });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ZvonokEgressError);
    expect((caught as ZvonokEgressError).code).toBe("MISSING_CAPABILITY");
  });

  it("stops the room session through the manager", async () => {
    const { result } = renderControls();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.controls.stop();
    });

    expect(sfu.manager.stopEgress).toHaveBeenCalledWith();
  });

  it("rejects with a typed error before a session exists", async () => {
    const { result } = renderControls();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.controls.start({ record: true });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ZvonokEgressError);
    expect((caught as ZvonokEgressError).code).toBe("DISCONNECTED");
  });
});
