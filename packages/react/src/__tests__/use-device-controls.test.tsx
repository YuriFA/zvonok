import { act, renderHook } from "@testing-library/react";
import { CaptureState } from "@zvonok/client/media/capture-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDeviceSelection, useDeviceControls } from "../hooks/use-device-controls.js";
import { createMockMediaManager, type MockMediaManager } from "./doubles.js";

const mediaHarness = vi.hoisted(() => ({
  instances: [] as unknown[],
  enumerateResult: [] as MediaDeviceInfo[],
  permissionState: "unknown",
}));

vi.mock("@zvonok/client/media/manager-factory", () => ({
  createMediaManager: () => {
    const instance = createMockMediaManager();
    const service = instance.getDeviceService();
    service.enumerateDevices.mockResolvedValue(mediaHarness.enumerateResult);
    service.queryPermission.mockResolvedValue({
      state: mediaHarness.permissionState,
      onchange: null,
    });
    mediaHarness.instances.push(instance);
    return instance;
  },
}));

import { ZvonokProvider } from "../contexts/zvonok-context.js";

function Provider({ children }: { children: React.ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

function lastMediaManager(): MockMediaManager {
  return mediaHarness.instances.at(-1) as MockMediaManager;
}

const mediaDevicesListeners = vi.hoisted(() => ({
  handlers: new Set<(event: Event) => void>(),
}));

beforeEach(() => {
  mediaHarness.instances.length = 0;
  mediaHarness.enumerateResult = [];
  mediaHarness.permissionState = "unknown";
  mediaDevicesListeners.handlers.clear();
  localStorage.clear();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      addEventListener: (_: string, handler: (event: Event) => void) => {
        mediaDevicesListeners.handlers.add(handler);
      },
      removeEventListener: (_: string, handler: (event: Event) => void) => {
        mediaDevicesListeners.handlers.delete(handler);
      },
    },
  });
});

function emitDeviceChange() {
  act(() => {
    mediaDevicesListeners.handlers.forEach((handler) => handler(new Event("devicechange")));
  });
}

function device(id: string, kind: MediaDeviceInfo["kind"], label = id): MediaDeviceInfo {
  return { deviceId: id, kind, label, groupId: "group", toJSON: () => ({}) } as MediaDeviceInfo;
}

describe("useDeviceControls", () => {

  it("shares the provider media manager and exposes capture snapshots", () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });

    expect(result.current.camera.state).toBe(0);
    expect(result.current.camera.track).toBeNull();
  });

  it("delegates start and stop, letting explicit device ids win", async () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();

    await act(async () => {
      await result.current.start({ video: true, audio: false, videoDeviceId: "cam-9" });
    });
    expect(media.start).toHaveBeenCalledWith({ video: true, audio: false, videoDeviceId: "cam-9" });

    act(() => {
      result.current.stop();
    });
    expect(media.stop).toHaveBeenCalled();
  });

  it("fills the start call with the persisted selection when ids are omitted", async () => {
    localStorage.setItem(
      "zvonok:device-selection",
      JSON.stringify({ videoDeviceId: "cam-kept", audioDeviceId: "mic-kept", speakerDeviceId: null }),
    );
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();

    await act(async () => {
      await result.current.start({ video: true, audio: true });
    });
    expect(media.start).toHaveBeenCalledWith({
      video: true,
      audio: true,
      videoDeviceId: "cam-kept",
      audioDeviceId: "mic-kept",
    });
  });

  it("delegates camera and mic toggles and active-capture device switches", async () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();

    await act(async () => {
      await result.current.camera.toggle(false);
    });
    expect(media.videoCapture.toggle).toHaveBeenCalledWith(false);

    act(() => {
      media.videoCapture.getState.mockReturnValue(CaptureState.ACTIVE);
      media.emitVideoState(CaptureState.ACTIVE, null);
    });

    await act(async () => {
      await result.current.camera.switchDevice("cam-2");
    });
    expect(media.videoCapture.switchDevice).toHaveBeenCalledWith("cam-2");

    await act(async () => {
      await result.current.mic.toggle(true);
    });
    expect(media.audioCapture.toggle).toHaveBeenCalledWith(true);

    act(() => {
      media.audioCapture.getState.mockReturnValue(CaptureState.ACTIVE);
      media.emitAudioState(CaptureState.ACTIVE, null);
    });

    await act(async () => {
      await result.current.mic.switchDevice("mic-3");
    });
    expect(media.audioCapture.switchDevice).toHaveBeenCalledWith("mic-3");
  });

  it("switching an inactive device records intent without powering the hardware", async () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();

    await act(async () => {
      const switched = await result.current.camera.switchDevice("cam-off");
      expect(switched).toBe(true);
    });
    expect(media.videoCapture.switchDevice).not.toHaveBeenCalled();
  });

  it("serializes device switches across kinds", async () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();
    let releaseVideo: ((value: boolean) => void) | undefined;
    media.videoCapture.switchDevice.mockImplementation(
      () => new Promise<boolean>((resolve) => (releaseVideo = resolve)),
    );
    act(() => {
      media.videoCapture.getState.mockReturnValue(CaptureState.ACTIVE);
      media.audioCapture.getState.mockReturnValue(CaptureState.ACTIVE);
      media.emitVideoState(CaptureState.ACTIVE, null);
      media.emitAudioState(CaptureState.ACTIVE, null);
    });

    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => {
      first = result.current.camera.switchDevice("cam-a");
      second = result.current.mic.switchDevice("mic-b");
    });
    await act(async () => {
      releaseVideo?.(true);
      await first;
    });

    await act(async () => {
      const secondResult = await second;
      expect(secondResult).toBe(false);
    });
    expect(media.audioCapture.switchDevice).not.toHaveBeenCalled();
  });

  it("delegates device enumeration to the media device service", async () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();

    await act(async () => {
      await result.current.enumerateDevices();
    });

    expect(media.getDeviceService().enumerateDevices).toHaveBeenCalled();
  });

  it("exposes a reactive device list refreshed on devicechange", async () => {
    mediaHarness.enumerateResult = [device("cam-1", "videoinput", "Cam One")];
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();
    const service = media.getDeviceService();

    await act(async () => {});
    expect(result.current.devices).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);

    service.enumerateDevices.mockResolvedValue([
      device("cam-1", "videoinput", "Cam One"),
      device("mic-1", "audioinput", "Mic One"),
    ]);
    emitDeviceChange();

    await act(async () => {});
    expect(result.current.devices).toHaveLength(2);
  });

  it("keeps selection in storage and restores it on remount", async () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });

    act(() => {
      result.current.selectVideoDevice("cam-2");
      result.current.selectSpeakerDevice("spk-1");
    });

    expect(loadDeviceSelection("zvonok:device-selection")).toEqual({
      videoDeviceId: "cam-2",
      audioDeviceId: null,
      speakerDeviceId: "spk-1",
    });

    const restored = renderHook(() => useDeviceControls(), { wrapper: Provider });
    expect(restored.result.current.selectedDevices).toEqual({
      videoDeviceId: "cam-2",
      audioDeviceId: null,
      speakerDeviceId: "spk-1",
    });
  });

  it("falls back to an empty selection for missing or corrupt storage", () => {
    expect(loadDeviceSelection("zvonok:device-selection")).toEqual({
      videoDeviceId: null,
      audioDeviceId: null,
      speakerDeviceId: null,
    });

    localStorage.setItem("zvonok:device-selection", "{not json");
    expect(loadDeviceSelection("zvonok:device-selection")).toEqual({
      videoDeviceId: null,
      audioDeviceId: null,
      speakerDeviceId: null,
    });
  });

  it("folds permission state into the returned surface", async () => {
    mediaHarness.permissionState = "granted";
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });

    await act(async () => {});

    expect(result.current.permissions.video).toBe("granted");
    expect(result.current.permissions.audio).toBe("granted");
  });

  it("reflects capture state changes from the media manager", () => {
    const { result } = renderHook(() => useDeviceControls(), { wrapper: Provider });
    const media = lastMediaManager();

    const track = { kind: "video", id: "cam-track", enabled: true } as MediaStreamTrack;
    act(() => {
      media.emitVideoState(2 as never, track);
    });

    expect(result.current.camera.state).toBe(2);
    expect(result.current.camera.track).toBe(track);

    const audioTrack = { kind: "audio", id: "mic-track", enabled: true } as MediaStreamTrack;
    act(() => {
      media.emitAudioState(2 as never, audioTrack);
    });

    expect(result.current.mic.state).toBe(2);
    expect(result.current.mic.track).toBe(audioTrack);
  });
});
