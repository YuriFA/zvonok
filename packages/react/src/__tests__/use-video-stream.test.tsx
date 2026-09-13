import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./doubles.js";
import { useVideoStream } from "../use-video-stream.js";

function Harness({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useVideoStream(ref, stream);
  return <video ref={ref} data-testid="video" />;
}

describe("useVideoStream", () => {
  let play: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("assigns the stream to the element and starts playback", () => {
    const stream = new MediaStream();
    const view = render(<Harness stream={stream} />);
    const element = view.getByTestId("video") as HTMLVideoElement;

    expect(element.srcObject).toBe(stream);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("clears the element when the stream goes away", () => {
    const stream = new MediaStream();
    const view = render(<Harness stream={stream} />);

    view.rerender(<Harness stream={null} />);
    const element = view.getByTestId("video") as HTMLVideoElement;

    expect(element.srcObject).toBe(null);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("keeps the assignment when the same stream is re-passed", () => {
    const stream = new MediaStream();
    const view = render(<Harness stream={stream} />);

    view.rerender(<Harness stream={stream} />);

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("retries play a bounded number of times when it keeps failing", async () => {
    play.mockRejectedValue(new Error("autoplay blocked"));
    const stream = new MediaStream();
    render(<Harness stream={stream} />);
    expect(play).toHaveBeenCalledTimes(1);

    // Each await flushes the rejection microtask that schedules the next
    // retry, so timer windows stay deterministic.
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(play).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(play).toHaveBeenCalledTimes(3);

    // Bounded: the cap stops further attempts.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(play).toHaveBeenCalledTimes(3);
  });
});
