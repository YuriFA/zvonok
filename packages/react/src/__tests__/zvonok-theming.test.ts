import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kitPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../css/component-kit.css",
);
const embeddedPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../css/embedded.css",
);

/**
 * The styling contract (D6): every color, radius, and font parameter is a
 * --zk-* custom property defined once on the .zk namespace class; the
 * preset sheet consumes the tokens. Renaming or dropping a token is a
 * breaking change for themed hosts.
 */
describe("embedded preset theming tokens", () => {
  const kit = readFileSync(kitPath, "utf8");
  const embedded = readFileSync(embeddedPath, "utf8");

  it("defines every documented token on the .zk namespace with its default", () => {
    const documented: Array<[name: string, fallback: string]> = [
      ["--zk-color-background", "#16181d"],
      ["--zk-color-text", "#e6e8eb"],
      ["--zk-color-accent", "#2f6f4f"],
      ["--zk-color-border", "#2a2e36"],
      ["--zk-radius", "10px"],
      ["--zk-font-family", "system-ui"],
    ];

    for (const [name, value] of documented) {
      const pattern = new RegExp(
        `\\.zk\\s*\\{[^}]*${name.replace(/-/g, "\\-")}\\s*:\\s*${value.replace(/[#]/g, "\\#")}`,
      );
      expect(kit, `${name}: ${value}`).toMatch(pattern);
    }
  });

  it("keeps token definitions out of the preset sheet", () => {
    const definitions = embedded.match(/--zk-[a-z0-9-]+\s*:/g) ?? [];
    expect(definitions).toEqual([]);
  });

  it("consumes tokens inside the preset sheet", () => {
    const reads = embedded.match(/var\(--zk-[a-z0-9-]+/g) ?? [];
    expect(reads.length).toBeGreaterThanOrEqual(10);
  });

  it("scopes the preset to zk-prefixed classes", () => {
    expect(embedded).toMatch(/^\.zk-room/m);
    expect(embedded).not.toMatch(/^\.(?!zk)[a-z]/m);
  });
});
