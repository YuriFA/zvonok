import { act, renderHook } from "@testing-library/react";
import { CaptureState } from "@zvonok/client/media/capture-state";
import { describe, expect, it, vi } from "vitest";

import { deriveMediaControlState } from "../hooks/derive-media-control.js";
import { mapScreenShareError } from "../hooks/map-screen-share-error.js";
import { usePrejoin } from "../hooks/use-prejoin.js";
import { CapabilitiesGate, hasCapabilities } from "../wrappers/capability-gate.js";

describe("usePrejoin", () => {
  it("confirms with the drafted name and lands on confirmed", async () => {
    const onConfirm = vi.fn(async () => {});
    const { result } = renderHook(() => usePrejoin({ initialName: "  Yuri ", onConfirm }));

    expect(result.current.canConfirm).toBe(true);
    await act(async () => {
      await result.current.confirm();
    });

    expect(onConfirm).toHaveBeenCalledWith({ displayName: "  Yuri " });
    expect(result.current.phase).toBe("confirmed");
  });

  it("rejects an empty name and never calls the join action", async () => {
    const onConfirm = vi.fn(async () => {});
    const { result } = renderHook(() => usePrejoin({ onConfirm }));

    expect(result.current.canConfirm).toBe(false);
    expect(result.current.displayName).toBe("");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("returns to confirming when the join action rejects", async () => {
    const onConfirm = vi.fn(async (): Promise<void> => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => usePrejoin({ onConfirm }));
    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.phase).toBe("confirming");
    // A retry works after the failure.
    onConfirm.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.phase).toBe("confirmed");
  });

  it("auto-confirms once when skip flips true", async () => {
    const onConfirm = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ skip }: { skip: boolean }) => usePrejoin({ initialName: "Guest", skip, onConfirm }),
      { initialProps: { skip: false } },
    );

    rerender({ skip: true });
    await act(async () => {});
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("confirmed");
  });

  it("reset returns a confirmed prejoin to the confirmation stage", async () => {
    const onConfirm = vi.fn(async () => {});
    const { result } = renderHook(() => usePrejoin({ onConfirm }));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.phase).toBe("confirmed");

    act(() => {
      result.current.reset();
    });
    expect(result.current.phase).toBe("confirming");
  });
});

describe("hasCapabilities / CapabilitiesGate", () => {
  it("requires every listed capability", () => {
    expect(hasCapabilities(["mute-users", "lock-room"], "mute-users")).toBe(true);
    expect(hasCapabilities(["mute-users"], ["mute-users", "lock-room"])).toBe(false);
    expect(hasCapabilities(undefined, "mute-users")).toBe(false);
    expect(hasCapabilities(["a"], undefined)).toBe(true);
    expect(hasCapabilities(["a"], [])).toBe(true);
  });

  it("renders children only when capabilities cover the requirement", () => {
    const granted = CapabilitiesGate({
      capabilities: ["lock-room"],
      required: "lock-room",
      children: "host-ui",
    });
    expect(granted.props.children).toBe("host-ui");

    const denied = CapabilitiesGate({
      capabilities: [],
      required: "lock-room",
      children: "host-ui",
      fallback: "no-access",
    });
    expect(denied.props.children).toBe("no-access");
  });
});

describe("deriveMediaControlState", () => {
  it("marks an enabled active capture as on", () => {
    const state = deriveMediaControlState({
      isEnabled: true,
      captureState: CaptureState.ACTIVE,
      kind: "video",
    });
    expect(state.isOn).toBe(true);
    expect(state.hasError).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.isForcedOff).toBe(false);
    expect(state.display.status).toBe("on");
  });

  it("forces off and flags a host mute regardless of the enabled flag", () => {
    const state = deriveMediaControlState({
      isEnabled: true,
      captureState: CaptureState.ACTIVE,
      kind: "audio",
      isMutedByHost: true,
    });
    expect(state.isOn).toBe(false);
    expect(state.isForcedOff).toBe(true);
  });

  it("surfaces starting and error capture states as loading and error badges", () => {
    const starting = deriveMediaControlState({
      isEnabled: true,
      captureState: CaptureState.STARTING,
      kind: "video",
    });
    expect(starting.isLoading).toBe(true);

    const failed = deriveMediaControlState({
      isEnabled: false,
      captureState: CaptureState.DEVICE_ERROR,
      kind: "audio",
    });
    expect(failed.hasError).toBe(true);
    expect(failed.isOn).toBe(false);
  });
});

describe("mapScreenShareError", () => {
  it("maps each typed failure onto the supplied presentation", () => {
    const presentation = {
      blocked: "blocked-message",
      unsupported: "unsupported-message",
      cancelled: "cancelled-message",
      denied: "denied-message",
      fallback: "fallback-message",
    };
    expect(mapScreenShareError("blocked", presentation)).toBe("blocked-message");
    expect(mapScreenShareError("unsupported", presentation)).toBe("unsupported-message");
    expect(mapScreenShareError("cancelled", presentation)).toBe("cancelled-message");
    expect(mapScreenShareError("denied", presentation)).toBe("denied-message");
    expect(mapScreenShareError("nonsense", presentation)).toBe("fallback-message");
  });

  it("stays silent for kinds without presentation", () => {
    expect(mapScreenShareError("unsupported", { fallback: "x" })).toBeUndefined();
    expect(mapScreenShareError("denied", { fallback: "x" })).toBeUndefined();
    expect(mapScreenShareError("blocked", { blocked: "b" })).toBe("b");
  });
});
