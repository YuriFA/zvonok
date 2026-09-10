import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../prebuilt/zvonok.css",
);

/**
 * The documented theming contract: the stylesheet consumes the --zvonok-*
 * custom properties with the built-in defaults as fallbacks. Renaming or
 * dropping a variable is a breaking change for styled hosts.
 */
describe("ZvonokRoom theming variables", () => {
  const css = readFileSync(cssPath, "utf8");

  it("reads every documented variable with a default fallback", () => {
    const documented: Array<[name: string, fallback: string]> = [
      ["--zvonok-accent-color", "#2f6f4f"],
      ["--zvonok-background-color", "#16181d"],
      ["--zvonok-text-color", "#e6e8eb"],
      ["--zvonok-radius", "10px"],
      ["--zvonok-font-family", "system-ui"],
    ];

    for (const [name, fallback] of documented) {
      const pattern = new RegExp(
        `var\\(\\s*${name.replace(/[-]/g, "\\-")}\\s*,\\s*[^)]*${fallback.replace(/[#]/g, "\\#")}`,
      );
      expect(css, `${name} with ${fallback} fallback`).toMatch(pattern);
    }
  });

  it("never defines --zvonok-* properties itself", () => {
    expect(css).not.toMatch(/--zvonok-[a-z-]+\s*:/);
  });

  it("keeps every read inside the namespaced widget scope", () => {
    const reads = css.match(/var\(--zvonok-[a-z-]+/g) ?? [];
    expect(reads.length).toBeGreaterThanOrEqual(5);
  });
});
