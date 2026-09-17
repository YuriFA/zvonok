import { CaptureState } from "@zvonok/client/media/capture-state";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ToggleControl } from "../../use-zvonok-call.js";
import { useMediaControls } from "../media-controls.js";

function control(overrides: Partial<ToggleControl> = {}): ToggleControl {
  return {
    isEnabled: true,
    captureState: null,
    toggle: vi.fn().mockResolvedValue("published"),
    ...overrides,
  };
}

describe("useMediaControls", () => {
  it("derives on-state from the toggle controls", () => {
    const { result } = renderHook(() =>
      useMediaControls({ camera: control(), microphone: control() }),
    );

    expect(result.current.video.isOn).toBe(true);
    expect(result.current.video.hasError).toBe(false);
    expect(result.current.audio.isOn).toBe(true);
    expect(result.current.audio.isForcedOff).toBe(false);
  });

  it("overrides the audio display while host-muted without touching video", () => {
    const { result } = renderHook(() =>
      useMediaControls({
        camera: control(),
        microphone: control(),
        mutedByHost: true,
      }),
    );

    expect(result.current.audio.isForcedOff).toBe(true);
    expect(result.current.audio.isOn).toBe(false);
    expect(result.current.audio.display).toEqual({
      status: "off",
      tooltip: "Muted by host",
      statusText: null,
    });
    expect(result.current.video.isForcedOff).toBe(false);
    expect(result.current.video.isOn).toBe(true);
  });

  it("surfaces capture errors and loading from the capture state machine", () => {
    const failing = control({ captureState: CaptureState.DEVICE_ERROR, isEnabled: false });
    const starting = control({ captureState: CaptureState.STARTING });
    const { result } = renderHook(() =>
      useMediaControls({ camera: failing, microphone: starting }),
    );

    expect(result.current.video.hasError).toBe(true);
    expect(result.current.video.isOn).toBe(false);
    expect(result.current.audio.isLoading).toBe(true);
  });

  it("toggles through the underlying controls", async () => {
    const camera = control();
    const microphone = control();
    const { result } = renderHook(() => useMediaControls({ camera, microphone }));

    await act(() => result.current.toggleVideo());
    await act(() => result.current.toggleAudio());

    expect(camera.toggle).toHaveBeenCalledOnce();
    expect(microphone.toggle).toHaveBeenCalledOnce();
  });
});
