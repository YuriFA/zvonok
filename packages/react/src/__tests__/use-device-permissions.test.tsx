import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaHarness = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("@zvonok/client/media/manager-factory", () => ({
  createMediaManager: () => {
    const instance = createMockMediaManager();
    mediaHarness.instances.push(instance);
    return instance;
  },
}));

import "./doubles.js";
import { useDevicePermissions } from "../hooks/use-device-permissions.js";
import { ZvonokProvider } from "../contexts/zvonok-context.js";
import { createMockMediaManager } from "./doubles.js";

function makeStatus(state: string): PermissionStatus {
  return { state, onchange: null } as unknown as PermissionStatus;
}

function lastService() {
  const mediaManager = mediaHarness.instances.at(-1) as ReturnType<typeof createMockMediaManager>;
  return mediaManager.getDeviceService();
}

function queryMock(service: ReturnType<typeof lastService>) {
  return service.queryPermission as unknown as ReturnType<typeof vi.fn>;
}

function renderPermissions(kind: "video" | "audio") {
  return renderHook(() => useDevicePermissions(kind), {
    wrapper: ({ children }) => <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>,
  });
}

/**
 * The hook re-queries on window focus: use it to flush a configured result.
 * Async act so the query's promise chain settles inside the act scope.
 */
async function refocus() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

describe("useDevicePermissions", () => {
  beforeEach(() => {
    mediaHarness.instances.length = 0;
  });

  it("surfaces the granted state from the device service", async () => {
    const { result } = renderPermissions("video");
    const service = lastService();
    queryMock(service).mockResolvedValue(makeStatus("granted"));

    await refocus();
    await waitFor(() => expect(result.current).toBe("granted"));
    expect(service.queryPermission).toHaveBeenCalledWith("video");
  });

  it("maps the prompt state to prompting and rejections to unknown", async () => {
    const first = renderPermissions("video");
    queryMock(lastService()).mockResolvedValue(makeStatus("prompt"));
    await refocus();
    await waitFor(() => expect(first.result.current).toBe("prompting"));

    const second = renderPermissions("audio");
    queryMock(lastService()).mockRejectedValue(new Error("unsupported"));
    await refocus();
    await waitFor(() => expect(second.result.current).toBe("unknown"));
  });

  it("updates through PermissionStatus.onchange", async () => {
    const { result } = renderPermissions("video");
    const service = lastService();
    const status = makeStatus("granted");
    queryMock(service).mockResolvedValue(status);

    await refocus();
    await waitFor(() => expect(result.current).toBe("granted"));

    (status as { state: string }).state = "denied";
    act(() => {
      status.onchange?.(new Event("change"));
    });
    expect(result.current).toBe("denied");
  });

  it("re-queries when the window regains focus", async () => {
    renderPermissions("video");
    const service = lastService();
    queryMock(service).mockResolvedValue(makeStatus("granted"));

    await refocus();
    await waitFor(() => expect(queryMock(service)).toHaveBeenCalledTimes(2));

    await refocus();
    await waitFor(() => expect(queryMock(service)).toHaveBeenCalledTimes(3));
  });

  it("stops listening on unmount", async () => {
    const { unmount } = renderPermissions("video");
    const service = lastService();
    const status = makeStatus("granted");
    queryMock(service).mockResolvedValue(status);

    await refocus();
    await waitFor(() => expect(queryMock(service)).toHaveBeenCalledTimes(2));

    unmount();
    expect(status.onchange).toBeNull();

    await refocus();
    expect(queryMock(service)).toHaveBeenCalledTimes(2);
  });
});
