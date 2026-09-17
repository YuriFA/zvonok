import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockMediaManager } from "./doubles.js";

const mediaHarness = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("@zvonok/client/media/manager-factory", () => ({
  createMediaManager: () => {
    const instance = createMockMediaManager();
    mediaHarness.instances.push(instance);
    return instance;
  },
}));

import { useZvonokSession, ZvonokProvider } from "../contexts/zvonok-context.js";

function lastMediaManager() {
  return mediaHarness.instances.at(-1) as ReturnType<typeof createMockMediaManager>;
}

describe("ZvonokProvider", () => {
  beforeEach(() => {
    mediaHarness.instances.length = 0;
  });

  it("throws when hooks are used outside of a provider", () => {
    expect(() => renderHook(() => useZvonokSession())).toThrow("ZvonokProvider");
  });

  it("supplies the server url, session state, and a shared media manager", () => {
    const { result } = renderHook(() => useZvonokSession(), {
      wrapper: ({ children }) => (
        <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>
      ),
    });

    expect(result.current.serverUrl).toBe("https://sfu.test");
    expect(result.current.status).toBe("disconnected");
    expect(result.current.error).toBeNull();
    expect(result.current.locked).toBe(false);
    expect(result.current.manager).toBeNull();
    expect(result.current.mediaManager).toBe(lastMediaManager());
  });

  it("stops the media manager when the provider unmounts", () => {
    const { unmount } = renderHook(() => useZvonokSession(), {
      wrapper: ({ children }) => (
        <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>
      ),
    });

    const mediaManager = lastMediaManager();
    unmount();
    expect(mediaManager.stop).toHaveBeenCalled();
  });
});
