import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SfuManager } from "@zvonok/client/sfu/manager";

import { ZvonokProvider, useZvonokSession } from "../zvonok-context.js";
import { useScreenShare } from "../use-screen-share.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

const serviceHarness = vi.hoisted(() => {
  const instances: Array<{
    getState: ReturnType<typeof vi.fn>;
    onStateChange: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  return { instances };
});

vi.mock("@zvonok/client/screen-share/service", () => ({
  ScreenShareService: vi.fn(function () {
    const listeners = new Set<(state: unknown) => void>();
    const instance = {
      getState: vi.fn(() => ({ isSharing: false, screenStream: null, isScreenShareBlocked: false })),
      onStateChange: vi.fn((listener: (state: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      start: vi.fn(async () => {
        for (const listener of listeners) {
          listener({ isSharing: true, screenStream: new MediaStream(), isScreenShareBlocked: false });
        }
      }),
      stop: vi.fn(() => {
        for (const listener of listeners) {
          listener({ isSharing: false, screenStream: null, isScreenShareBlocked: false });
        }
      }),
      destroy: vi.fn(),
    };
    serviceHarness.instances.push(instance);
    return instance;
  }),
  browserDisplayMediaService: {},
}));

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

function renderScreenShare() {
  return renderHook(
    () => {
      const session = useZvonokSession();
      const hook = useScreenShare();
      return { session, hook };
    },
    { wrapper: Provider },
  );
}

async function attachManager(
  result: ReturnType<typeof renderScreenShare>["result"],
  sfu: MockSfuManager,
) {
  await act(async () => {
    result.current.session.update({ manager: sfu.manager as unknown as SfuManager, status: "joined" });
  });
}

describe("useScreenShare", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
    serviceHarness.instances.length = 0;
  });

  it("reports an inactive, unblocked share before joining", () => {
    const { result } = renderScreenShare();

    expect(result.current.hook).toMatchObject({
      sharing: false,
      screenStream: null,
      blocked: false,
    });
    expect(serviceHarness.instances).toHaveLength(0);
  });

  it("publishes a screen producer on start and reports sharing", async () => {
    const { result } = renderScreenShare();
    await attachManager(result, sfu);

    await act(async () => {
      await result.current.hook.start();
    });

    expect(result.current.hook.sharing).toBe(true);
    expect(serviceHarness.instances.at(-1)!.start).toHaveBeenCalled();
  });

  it("surfaces the blocked state and typed start failures", async () => {
    const { result } = renderScreenShare();
    await attachManager(result, sfu);

    const service = serviceHarness.instances.at(-1)!;
    act(() => {
      // Simulate another participant holding the room's exclusive share.
      service.start.mockRejectedValueOnce("blocked");
    });

    await expect(result.current.hook.start()).rejects.toBe("blocked");

    act(() => {
      const onStateChange = service.onStateChange.mock.calls[0]?.[0];
      onStateChange?.({ isSharing: false, screenStream: null, isScreenShareBlocked: true });
    });
    expect(result.current.hook.blocked).toBe(true);
  });

  it("stops and unpublishes", async () => {
    const { result } = renderScreenShare();
    await attachManager(result, sfu);
    await act(async () => {
      await result.current.hook.start();
    });

    act(() => {
      result.current.hook.stop();
    });

    expect(result.current.hook.sharing).toBe(false);
    expect(serviceHarness.instances.at(-1)!.stop).toHaveBeenCalled();
  });

  it("destroys the service when the session goes away", async () => {
    const { result } = renderScreenShare();
    await attachManager(result, sfu);

    await act(async () => {
      result.current.session.update({ manager: null, status: "disconnected" });
    });

    expect(serviceHarness.instances.at(-1)!.destroy).toHaveBeenCalled();
    expect(result.current.hook.sharing).toBe(false);
  });
});
