import { describe, expect, it } from "vitest";

import { computeLayout } from "../grid-layout";

describe("computeLayout", () => {
  it("returns empty layout for zero participants", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 0,
    });
    expect(result.tiles).toHaveLength(0);
    expect(result.rows).toBe(0);
    expect(result.cols).toBe(0);
  });

  it("returns empty layout for negative participants", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: -1,
    });
    expect(result.tiles).toHaveLength(0);
  });

  it("lays out a single participant centered", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 1,
    });
    expect(result.tiles).toHaveLength(1);
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(1);

    const tile = result.tiles[0];
    expect(tile.width).toBe(result.tileWidth);
    expect(tile.height).toBe(result.tileHeight);

    const centerX = tile.x + tile.width / 2;
    const centerY = tile.y + tile.height / 2;
    expect(centerX).toBeCloseTo(960, 0);
    expect(centerY).toBeCloseTo(540, 0);
  });

  it("creates correct number of tiles", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 6,
    });
    expect(result.tiles).toHaveLength(6);
  });

  it("respects aspect ratio", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 1,
      aspectRatio: 4 / 3,
    });
    const tile = result.tiles[0];
    expect(tile.width / tile.height).toBeCloseTo(4 / 3, 2);
  });

  it("applies gap between tiles", () => {
    const gap = 16;
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 4,
      gap,
    });
    expect(result.tiles).toHaveLength(4);

    const col0 = result.tiles.filter((_, i) => i % result.cols === 0);
    const col1 = result.tiles.filter((_, i) => i % result.cols === 1);

    if (result.cols >= 2 && col0.length > 0 && col1.length > 0) {
      const gapActual = col1[0].x - (col0[0].x + col0[0].width);
      expect(gapActual).toBeCloseTo(gap, 1);
    }
  });

  it("handles 2 participants as 1x2 or 2x1", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 2,
    });
    expect(result.tiles).toHaveLength(2);
    expect(result.rows * result.cols).toBeGreaterThanOrEqual(2);
  });

  it("handles 9 participants as 3x3", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 9,
    });
    expect(result.tiles).toHaveLength(9);
    expect(result.cols).toBeGreaterThanOrEqual(3);
    expect(result.rows).toBeGreaterThanOrEqual(3);
  });

  it("no tile exceeds container bounds", () => {
    const result = computeLayout({
      containerWidth: 800,
      containerHeight: 600,
      participantCount: 7,
      gap: 10,
    });
    for (const tile of result.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(801);
      expect(tile.y + tile.height).toBeLessThanOrEqual(601);
    }
  });

  it("respects minTileSize", () => {
    const result = computeLayout({
      containerWidth: 300,
      containerHeight: 200,
      participantCount: 2,
      minTileSize: 140,
    });
    for (const tile of result.tiles) {
      expect(tile.width).toBeGreaterThanOrEqual(140);
    }
  });
});

describe("computeLayout (spotlight mode)", () => {
  it("returns spotlightArea when spotlight is true", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 2,
      spotlight: true,
    });
    expect(result.spotlightArea).toBeDefined();
    expect(result.spotlightArea!.width).toBeGreaterThan(0);
    expect(result.spotlightArea!.height).toBeGreaterThan(0);
  });

  it("places strip on the right for wide containers (ratio > 1.5)", () => {
    // 1920x1080 ratio = 1.78 > 1.5 → right strip
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 3,
      spotlight: true,
    });
    expect(result.stripPosition).toBe("right");
    // Spotlight area should span full height and stop before the strip
    expect(result.spotlightArea!.height).toBe(1080);
    expect(result.spotlightArea!.x).toBe(0);
    expect(result.spotlightArea!.y).toBe(0);
  });

  it("places strip on the bottom for narrow/square containers (ratio <= 1.5)", () => {
    // 800x800 ratio = 1.0 <= 1.5 → bottom strip
    const result = computeLayout({
      containerWidth: 800,
      containerHeight: 800,
      participantCount: 2,
      spotlight: true,
    });
    expect(result.stripPosition).toBe("bottom");
    expect(result.spotlightArea!.width).toBe(800);
    expect(result.spotlightArea!.x).toBe(0);
    expect(result.spotlightArea!.y).toBe(0);
  });

  it("creates correct number of participant tiles", () => {
    const participantCount = 4;
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount,
      spotlight: true,
    });
    expect(result.tiles).toHaveLength(participantCount);
  });

  it("spotlight area and participant tiles do not overlap (right strip)", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 3,
      spotlight: true,
    });
    const sa = result.spotlightArea!;
    const spotlightRight = sa.x + sa.width;
    for (const tile of result.tiles) {
      // All participant tiles must start to the right of the spotlight area
      expect(tile.x).toBeGreaterThanOrEqual(spotlightRight);
    }
  });

  it("spotlight area and participant tiles do not overlap (bottom strip)", () => {
    const result = computeLayout({
      containerWidth: 800,
      containerHeight: 800,
      participantCount: 2,
      spotlight: true,
    });
    const sa = result.spotlightArea!;
    const spotlightBottom = sa.y + sa.height;
    for (const tile of result.tiles) {
      // All participant tiles must start below the spotlight area
      expect(tile.y).toBeGreaterThanOrEqual(spotlightBottom);
    }
  });

  it("returns empty tiles with spotlight area for zero participants", () => {
    const result = computeLayout({
      containerWidth: 1920,
      containerHeight: 1080,
      participantCount: 0,
      spotlight: true,
    });
    expect(result.tiles).toHaveLength(0);
    expect(result.spotlightArea).toBeDefined();
    expect(result.spotlightArea!.width).toBeGreaterThan(0);
  });

  it("returns empty layout for invalid container dimensions", () => {
    const result = computeLayout({
      containerWidth: 0,
      containerHeight: 0,
      participantCount: 2,
      spotlight: true,
    });
    expect(result.tiles).toHaveLength(0);
    expect(result.spotlightArea).toBeUndefined();
  });

  it("centers the clamped right-strip stack vertically", () => {
    const result = computeLayout({
      containerWidth: 1280,
      containerHeight: 720,
      participantCount: 4,
      spotlight: true,
    });
    // Tiles clamp to 90px (160/16:9); the 384px stack centers in 720px.
    expect(result.tiles[0]!.y).toBeCloseTo((720 - (4 * 90 + 3 * 8)) / 2);
    for (const tile of result.tiles) {
      expect(tile.height).toBeCloseTo(result.tiles[0]!.height);
    }
    const last = result.tiles[3]!;
    expect(last.y + last.height).toBeLessThanOrEqual(720);
  });

  it("clamps bottom-strip tiles to fit the container width", () => {
    const result = computeLayout({
      containerWidth: 640,
      containerHeight: 480,
      participantCount: 10,
      spotlight: true,
    });
    expect(result.stripPosition).toBe("bottom");
    for (const tile of result.tiles) {
      expect(tile.width).toBeCloseTo(result.tiles[0]!.width);
    }
    const last = result.tiles[9]!;
    expect(last.x + last.width).toBeLessThanOrEqual(640);
    // The centered row starts inside the strip, not below it.
    expect(result.tiles[0]!.x).toBeGreaterThanOrEqual(0);
  });
});
