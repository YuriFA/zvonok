import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePeerViewport } from "../../contexts/peer-quality.context";
import { RoomVideo } from "../room-video";

// RoomVideo pulls app contexts for the quality badge, the audio overlay, and
// viewport tracking; the memo behavior under test needs none of them real.
// usePeerViewport doubles as the render counter: it runs once per tile body
// execution, and a memo bailout skips the body entirely.
vi.mock("../../contexts/peer-quality.context", () => ({
  usePeerQualityContext: vi.fn(() => ({
    store: { subscribePeer: () => () => {}, getPeerStats: () => undefined },
  })),
  usePeerViewport: vi.fn(),
}));
vi.mock("@/features/room/contexts/room-audio.context", () => ({
  useActiveSpeakerId: () => null,
  useAudioLevel: () => 0,
}));
vi.mock("../../contexts/room-audio.context", () => ({
  useActiveSpeakerId: () => null,
  useAudioLevel: () => 0,
}));

const viewportSpy = vi.mocked(usePeerViewport);

const baseProps = {
  userId: "u1",
  stream: null,
  username: "Ann",
  isVideoEnabled: true,
  isAudioEnabled: true,
};

describe("RoomVideo memoization", () => {
  it("does not re-render when the parent re-renders with equal props", () => {
    const view = render(<RoomVideo {...baseProps} />);
    expect(view.getByText("Ann")).toBeInTheDocument();
    expect(viewportSpy).toHaveBeenCalledTimes(1);

    // Unrelated parent re-renders with the same prop values: the memoized
    // tile must bail out and skip its body.
    view.rerender(<RoomVideo {...baseProps} />);
    view.rerender(<RoomVideo {...baseProps} />);
    expect(viewportSpy).toHaveBeenCalledTimes(1);

    // A real prop change must go through.
    view.rerender(<RoomVideo {...baseProps} username="Bob" />);
    expect(viewportSpy).toHaveBeenCalledTimes(2);
    expect(view.getByText("Bob")).toBeInTheDocument();
  });
});
