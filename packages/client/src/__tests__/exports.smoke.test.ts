/**
 * Resolve-smoke over the public surface: the package.json exports map is
 * the interface. Every listed subpath must resolve to a module that
 * imports cleanly, the map must enumerate exactly the public set, and the
 * deleted internal modules must not come back as importable files.
 */

import { describe, expect, it } from "vitest";

import * as pkg from "../../package.json";

const EXPORTS = (
  pkg as { exports: Record<string, { default?: string } | string> }
).exports;

const PUBLIC_SUBPATHS = [
  "./audio/active-speaker-detector",
  "./audio/audio-level-sampler",
  "./audio/remote-audio-mixer",
  "./media/capture-state",
  "./media/interfaces",
  "./media/manager-factory",
  "./screen-share/service",
  "./screen-share/types",
  "./sfu/manager",
  "./sfu/quality-score",
  "./sfu/types",
];

/** Internal modules whose files were deleted outright, never re-export. */
const DELETED_FILES = ["../sfu/interfaces.js"];

// Static imports cannot verify the resolution boundary itself: this suite
// intentionally exercises module loading of map targets and deleted files.
describe("public exports map", () => {
  it("enumerates exactly the public set", () => {
    expect(Object.keys(EXPORTS).sort()).toEqual(
      ["./package.json", ...PUBLIC_SUBPATHS].sort(),
    );
  });

  it.each(PUBLIC_SUBPATHS)("resolves and imports %s", async (subpath) => {
    const entry = EXPORTS[subpath] as { default?: string };
    const target = entry.default ?? "";
    expect(target).toMatch(/^\.\/src\//);
    // The mapped source file, relative to this test: "./src/x.ts" from the
    // package root is "../x.ts" from src/__tests__.
    const relative = target.replace("./src/", "../").replace(/\.ts$/, ".js");
    // Type-only modules (media/interfaces, screen-share/types) resolve to
    // an empty runtime namespace; a successful import is the smoke.
    await import(relative);
    expect(true).toBe(true);
  });

  it.each(DELETED_FILES)(
    "keeps internal module unimportable: %s",
    async (specifier) => {
      await expect(import(/* @vite-ignore */ specifier)).rejects.toBeTruthy();
    },
  );
});
