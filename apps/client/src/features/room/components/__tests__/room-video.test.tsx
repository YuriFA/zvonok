import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The memoization contract under test: the tile body runs once for equal
// parent props (bailout) and re-runs on a real prop change. Tile stands in
// as the render counter - the real Tile pulls the quality engine, which
// this isolation test does not exercise.
const tileSpy = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@zvonok/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zvonok/react")>()),
  Tile: function MockTile({ children }: { children?: React.ReactNode }) {
    tileSpy.calls += 1;
    return <>{children}</>;
  },
  usePeerQualityStats: vi.fn(() => undefined),
}));

vi.mock("@/features/room/contexts/room-audio.context", () => ({
  useActiveSpeakerId: () => null,
  useAudioLevel: () => 0,
}));
vi.mock("../../contexts/room-audio.context", () => ({
  useActiveSpeakerId: () => null,
  useAudioLevel: () => 0,
}));

import { RoomVideo } from "../room-video";

const baseProps = {
  userId: "u1",
  stream: null,
  username: "Ann",
  isVideoEnabled: true,
  isAudioEnabled: true,
};

describe("RoomVideo memoization", () => {
  beforeEach(() => {
    tileSpy.calls = 0;
  });

  it("does not re-render when the parent re-renders with equal props", () => {
    const view = render(<RoomVideo {...baseProps} />);
    expect(view.getByText("Ann")).toBeInTheDocument();
    expect(tileSpy.calls).toBe(1);

    // Unrelated parent re-renders with the same prop values: the memoized
    // tile must bail out and skip its body.
    view.rerender(<RoomVideo {...baseProps} />);
    view.rerender(<RoomVideo {...baseProps} />);
    expect(tileSpy.calls).toBe(1);

    // A real prop change must go through.
    view.rerender(<RoomVideo {...baseProps} username="Bob" />);
    expect(tileSpy.calls).toBe(2);
    expect(view.getByText("Bob")).toBeInTheDocument();
  });
});
