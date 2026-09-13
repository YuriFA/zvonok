import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../logger.js";

describe("createLogger", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.removeItem("zvonok:log-level");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("zvonok:log-level");
  });

  it("suppresses debug and info at the default warn level", () => {
    const logger = createLogger("sfu");
    logger.debug("hidden");
    logger.info("hidden too");
    logger.warn("shown", 1);
    logger.error("shown too");

    expect(log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[zvonok:sfu]", "shown", 1);
    expect(console.error).toHaveBeenCalledWith("[zvonok:sfu]", "shown too");
  });

  it("lets localStorage raise the level to debug", () => {
    localStorage.setItem("zvonok:log-level", "debug");
    const logger = createLogger("test");
    logger.debug("visible");

    expect(log).toHaveBeenCalledWith("[zvonok:test]", "visible");
  });

  it("lets localStorage lower the level to error", () => {
    localStorage.setItem("zvonok:log-level", "error");
    const logger = createLogger("test");
    logger.warn("hidden");

    expect(console.warn).not.toHaveBeenCalled();
  });

  it("falls back to the default on an invalid stored level", () => {
    localStorage.setItem("zvonok:log-level", "loud");
    const logger = createLogger("test");
    logger.info("hidden");
    logger.warn("shown");

    expect(log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[zvonok:test]", "shown");
  });

  it("tolerates unavailable storage", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });

    try {
      const logger = createLogger("test");
      expect(() => logger.warn("still works")).not.toThrow();
      expect(console.warn).toHaveBeenCalledWith("[zvonok:test]", "still works");
    } finally {
      if (original) {
        Object.defineProperty(window, "localStorage", original);
      }
    }
  });
});
