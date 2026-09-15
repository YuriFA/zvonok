import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useRoomLayout,
  type RoomLayoutParticipant,
} from "../use-room-layout.js";

function grid(
  participants: RoomLayoutParticipant[],
  width = 1280,
  height = 720,
) {
  return renderHook(() =>
    useRoomLayout({ participants, containerWidth: width, containerHeight: height }),
  ).result.current;
}

const local = (sharing = false): RoomLayoutParticipant => ({
  userId: "local",
  isLocal: true,
  isScreenSharing: sharing,
});

const remote = (userId: string, sharing = false): RoomLayoutParticipant => ({
  userId,
  isScreenSharing: sharing,
});

describe("useRoomLayout", () => {
  it("orders local first and lays the rest out in input order", () => {
    const layout = grid([remote("b"), local(), remote("a")]);

    expect(layout.mode).toBe("grid");
    expect(layout.spotlight).toBeNull();
    expect(layout.tiles.map((tile) => tile.userId)).toEqual(["local", "b", "a"]);
    expect(layout.tiles.every((tile) => tile.rect.width > 0 && tile.rect.height > 0)).toBe(true);
  });

  it("gives a sharing local participant the spotlight", () => {
    const layout = grid([local(true), remote("a", true)]);

    expect(layout.mode).toBe("spotlight");
    expect(layout.spotlight?.userId).toBe("local");
    expect(layout.spotlight?.rect.width).toBeGreaterThan(0);
    expect(layout.tiles.map((tile) => tile.userId)).toEqual(["local", "a"]);
  });

  it("picks the first sharing remote when local is not sharing", () => {
    const layout = grid([local(), remote("a"), remote("b", true), remote("c", true)]);

    expect(layout.mode).toBe("spotlight");
    expect(layout.spotlight?.userId).toBe("b");
  });

  it("matches the geometry computeLayout produces for the same inputs", () => {
    const layout = grid([local(), remote("a"), remote("b")], 800, 600);

    // 3 participants in an 800x600 container: center-packed 16:9 tiles.
    expect(layout.tiles).toHaveLength(3);
    const rects = layout.tiles.map((tile) => tile.rect);
    expect(new Set(rects.map((rect) => rect.width))).toHaveProperty("size", 1);
    expect(new Set(rects.map((rect) => rect.height))).toHaveProperty("size", 1);
    const xs = rects.map((rect) => rect.x).sort((x, y) => x - y);
    expect(xs[2]).toBeGreaterThan(xs[0]);
  });

  it("keeps the previous reference when only unrelated participant state churns", () => {
    const { result, rerender } = renderHook(
      ({ participants }: { participants: RoomLayoutParticipant[] }) =>
        useRoomLayout({ participants, containerWidth: 1280, containerHeight: 720 }),
      { initialProps: { participants: [local(), remote("a")] } },
    );
    const first = result.current;

    // New array identity, same arrangement semantics.
    rerender({ participants: [local(), remote("a")] });
    expect(result.current).toBe(first);
  });

  it("recomputes when the arrangement semantics change", () => {
    const { result, rerender } = renderHook(
      ({ participants }: { participants: RoomLayoutParticipant[] }) =>
        useRoomLayout({ participants, containerWidth: 1280, containerHeight: 720 }),
      { initialProps: { participants: [local(), remote("a")] } },
    );
    const first = result.current;

    rerender({ participants: [local(), remote("a", true)] });
    expect(result.current).not.toBe(first);
    expect(result.current.spotlight?.userId).toBe("a");

    rerender({ participants: [local(), remote("a", true), remote("b")] });
    expect(result.current.spotlight?.userId).toBe("a");
    expect(result.current.tiles).toHaveLength(3);
  });

  it("recomputes when the container resizes", () => {
    const { result, rerender } = renderHook(
      ({ size }: { size: number }) =>
        useRoomLayout({
          participants: [local()],
          containerWidth: size,
          containerHeight: 720,
        }),
      { initialProps: { size: 1280 } },
    );
    const first = result.current;

    rerender({ size: 640 });
    expect(result.current).not.toBe(first);
    expect(result.current.tiles[0].rect.width).toBeLessThan(first.tiles[0].rect.width);
  });

  it("degenerates safely for empty rooms and zero containers", () => {
    expect(grid([])).toEqual({ mode: "grid", spotlight: null, tiles: [] });
    const zeroed = grid([local()], 0, 0);
    expect(zeroed.mode).toBe("grid");
    expect(zeroed.tiles[0].rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
