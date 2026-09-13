import { describe, expect, it } from "vitest";

import { ensureExhausted } from "../exhausted.js";

describe("ensureExhausted", () => {
  it("throws on a value that slipped through the switch", () => {
    expect(() => ensureExhausted("surprise" as never)).toThrow("Unhandled case: surprise");
  });

  it("is assignable while narrowing holds (compile-time contract)", () => {
    type Kind = "video" | "audio";
    const label = (kind: Kind): string => {
      switch (kind) {
        case "video":
          return "Camera";
        case "audio":
          return "Microphone";
        default:
          return ensureExhausted(kind);
      }
    };
    expect(label("video")).toBe("Camera");
    expect(label("audio")).toBe("Microphone");
  });
});
