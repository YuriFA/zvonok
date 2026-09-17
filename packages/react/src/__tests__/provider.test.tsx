import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useZvonokSession, ZvonokProvider } from "../contexts/zvonok-context.js";
import { createMockMediaManager, type MockMediaManager } from "./doubles.js";

describe("ZvonokProvider", () => {
  let mediaManager: MockMediaManager;
  const createMediaManager = vi.fn(() => mediaManager);

  beforeEach(() => {
    mediaManager = createMockMediaManager();
    createMediaManager.mockClear();
  });

  it("throws when hooks are used outside of a provider", () => {
    expect(() => renderHook(() => useZvonokSession())).toThrow("ZvonokProvider");
  });

  it("supplies the server url, session state, and a shared media manager", () => {
    const { result } = renderHook(() => useZvonokSession(), {
      wrapper: ({ children }) => (
        <ZvonokProvider serverUrl="https://sfu.test" createMediaManager={createMediaManager}>
          {children}
        </ZvonokProvider>
      ),
    });

    expect(result.current.serverUrl).toBe("https://sfu.test");
    expect(result.current.status).toBe("disconnected");
    expect(result.current.error).toBeNull();
    expect(result.current.locked).toBe(false);
    expect(result.current.manager).toBeNull();
    expect(result.current.kicked).toBe(false);
    expect(result.current.mediaManager).toBe(mediaManager);
    expect(createMediaManager).toHaveBeenCalledTimes(1);
  });

  it("stops the media manager when the provider unmounts", () => {
    const { unmount } = renderHook(() => useZvonokSession(), {
      wrapper: ({ children }) => (
        <ZvonokProvider serverUrl="https://sfu.test" createMediaManager={createMediaManager}>
          {children}
        </ZvonokProvider>
      ),
    });

    unmount();
    expect(mediaManager.stop).toHaveBeenCalled();
  });
});
