import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { SfuHostActionError } from "@zvonok/client/sfu/types";
import type { SfuManager } from "@zvonok/client/sfu/manager";

import { ZvonokHostError } from "../errors.js";
import type { UseHostControlsResult } from "../hooks/use-host-controls.js";
import { useHostControls } from "../hooks/use-host-controls.js";
import { ZvonokProvider, useZvonokSession, type ZvonokSession } from "../contexts/zvonok-context.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}
interface ControlsHookResult {
  controls: UseHostControlsResult;
  session: ZvonokSession;
}

function renderControls() {
  return renderHook(() => ({ controls: useHostControls(), session: useZvonokSession() }), {
    wrapper: Provider,
  });
}

async function attachManager(result: { current: ControlsHookResult }, sfu: MockSfuManager) {
  await act(async () => {
    result.current.session.update({ manager: sfu.manager as unknown as SfuManager, status: "joined" });
  });
}

describe("useHostControls", () => {
  let sfu: MockSfuManager;


  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("delegates mutePeer to the manager and resolves on the ack", async () => {
    const { result } = renderControls();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.controls.mutePeer("user-2");
    });

    expect(sfu.manager.mutePeer).toHaveBeenCalledWith("user-2");
  });

  it("rejects mutePeer with the server's coded denial", async () => {
    sfu.manager.mutePeer.mockRejectedValueOnce(
      new SfuHostActionError("MISSING_CAPABILITY", "Missing mute-users capability"),
    );
    const { result } = renderControls();
    await attachManager(result, sfu);

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.controls.mutePeer("user-2");
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ZvonokHostError);
    expect((caught as ZvonokHostError).code).toBe("MISSING_CAPABILITY");
  });

  it("delegates muteAll with no arguments", async () => {
    const { result } = renderControls();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.controls.muteAll();
    });

    expect(sfu.manager.muteAll).toHaveBeenCalledWith();
  });

  it("delegates lockRoom with the requested state", async () => {
    const { result } = renderControls();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.controls.lockRoom(true);
    });

    expect(sfu.manager.lockRoom).toHaveBeenCalledWith(true);
  });

  it("kickPeer settles on the manager promise", async () => {
    const { result } = renderControls();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.controls.kickPeer("user-2");
    });

    expect(sfu.manager.kickPeer).toHaveBeenCalledWith("user-2");
  });

  it("rejects with a typed error when there is no connection", async () => {
    const { result } = renderControls();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.controls.mutePeer("user-2");
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ZvonokHostError);
    expect((caught as ZvonokHostError).code).toBe("DISCONNECTED");
  });
});
