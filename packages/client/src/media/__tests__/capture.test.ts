import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaCapture } from "../capture";
import { CaptureState } from "../capture-state";
import { clearDevicePreferences, loadDevicePreferences } from "../device-preferences";
import type { IMediaDeviceService } from "../device-service";
import type { IErrorClassifier } from "../error-classifier";

function createMockTrack(kind: string, deviceId = "device-1") {
  return {
    kind,
    stop: vi.fn(),
    getSettings: vi.fn(() => ({ deviceId })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createMockStream(tracks: MediaStreamTrack[]) {
  return {
    getTracks: vi.fn(() => tracks),
  } as unknown as MediaStream;
}

const mockErrorClassifier: IErrorClassifier = {
  classify: (error: unknown) => {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      return { state: CaptureState.DEVICE_NOT_FOUND, recoverable: true, reason: "Blocked" };
    }
    return { state: CaptureState.DEVICE_ERROR, recoverable: false, reason: "Error" };
  },
};

describe("MediaCapture", () => {
  let deviceService: IMediaDeviceService;
  let capture: MediaCapture;

  beforeEach(() => {
    deviceService = {
      getUserMedia: vi.fn(),
      enumerateDevices: vi.fn(),
      queryPermission: vi.fn(),
    };
  });

  describe("video capture", () => {
    beforeEach(() => {
      capture = new MediaCapture(deviceService, "video", mockErrorClassifier);
    });

    it("starts and transitions to ACTIVE", async () => {
      const track = createMockTrack("video");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      const result = await capture.start();

      expect(result).toBe(true);
      expect(capture.getState()).toBe(CaptureState.ACTIVE);
      expect(capture.getTrack()).toBe(track);
    });

    it("transitions through STARTING", async () => {
      const states: CaptureState[] = [];
      capture.onStateChange((state) => states.push(state));

      const track = createMockTrack("video");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.start();

      expect(states).toContain(CaptureState.STARTING);
      expect(states).toContain(CaptureState.ACTIVE);
    });

    it("returns NO_DEVICE when no matching track in stream", async () => {
      const wrongTrack = createMockTrack("audio");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([wrongTrack]),
      );

      const result = await capture.start();

      expect(result).toBe(false);
      expect(capture.getState()).toBe(CaptureState.NO_DEVICE);
    });

    it("transitions to error state on getUserMedia rejection", async () => {
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DOMException("Blocked", "NotAllowedError"),
      );

      const result = await capture.start();

      expect(result).toBe(false);
      expect(capture.getState()).toBe(CaptureState.DEVICE_NOT_FOUND);
    });

    it("stops and transitions to STOPPED", async () => {
      const track = createMockTrack("video");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.start();
      capture.stop();

      expect(capture.getState()).toBe(CaptureState.STOPPED);
      expect(capture.getTrack()).toBeNull();
      expect(track.stop).toHaveBeenCalled();
    });

    it("switches device", async () => {
      const track1 = createMockTrack("video", "device-1");
      const track2 = createMockTrack("video", "device-2");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createMockStream([track1]))
        .mockResolvedValueOnce(createMockStream([track2]));

      await capture.start();
      await capture.switchDevice("device-2");

      expect(capture.getTrack()).toBe(track2);
    });

    it("toggles off and on", async () => {
      const track = createMockTrack("video");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.toggle(false);
      expect(capture.getState()).toBe(CaptureState.STOPPED);

      await capture.toggle(true);
      expect(capture.getState()).toBe(CaptureState.ACTIVE);
    });

    it("notifies state change subscribers", async () => {
      const callback = vi.fn();
      capture.onStateChange(callback);

      const track = createMockTrack("video");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.start();

      expect(callback).toHaveBeenCalledWith(CaptureState.STARTING, null, undefined);
      expect(callback).toHaveBeenCalledWith(CaptureState.ACTIVE, track, undefined);
    });

    it("unsubscribes from state changes", async () => {
      const callback = vi.fn();
      const unsubscribe = capture.onStateChange(callback);
      unsubscribe();

      const track = createMockTrack("video");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.start();

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("audio capture", () => {
    beforeEach(() => {
      capture = new MediaCapture(deviceService, "audio", mockErrorClassifier);
    });

    it("starts audio capture", async () => {
      const track = createMockTrack("audio");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      const result = await capture.start();

      expect(result).toBe(true);
      expect(capture.getState()).toBe(CaptureState.ACTIVE);
    });

    it("uses audio constraints without deviceId", async () => {
      const track = createMockTrack("audio");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.start();

      const constraints = (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as MediaStreamConstraints;
      expect(constraints.audio).toBeDefined();
      expect(constraints.video).toBeUndefined();
    });

    it("uses audio constraints with deviceId", async () => {
      const track = createMockTrack("audio", "device-2");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await capture.start("device-2");

      const constraints = (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as MediaStreamConstraints;
      expect(constraints.audio).toEqual(
        expect.objectContaining({ deviceId: { exact: "device-2" } }),
      );
    });
  });

  describe("device preference integration", () => {
    beforeEach(() => {
      clearDevicePreferences();
    });

    it("falls back to the default device when the requested one is missing", async () => {
      const video = new MediaCapture(deviceService, "video", mockErrorClassifier);
      const gum = deviceService.getUserMedia as ReturnType<typeof vi.fn>;
      const track = createMockTrack("video");
      gum
        .mockRejectedValueOnce(new DOMException("gone", "NotFoundError"))
        .mockResolvedValueOnce(createMockStream([track]));

      const result = await video.start("gone-device");

      expect(result).toBe(true);
      expect(video.getState()).toBe(CaptureState.ACTIVE);
      expect(gum).toHaveBeenCalledTimes(2);
      const retryConstraints = gum.mock.calls[1][0] as MediaStreamConstraints;
      expect((retryConstraints.video as MediaTrackConstraints).deviceId).toBeUndefined();
    });

    it("remembers the device id after a successful start", async () => {
      const video = new MediaCapture(deviceService, "video", mockErrorClassifier);
      const track = createMockTrack("video", "device-9");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await video.start();

      expect(loadDevicePreferences().video).toEqual({ deviceId: "device-9" });
    });

    it("records audio mute intent on explicit toggles", async () => {
      const audio = new MediaCapture(deviceService, "audio", mockErrorClassifier);
      const track = createMockTrack("audio");
      (deviceService.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockStream([track]),
      );

      await audio.toggle(false);
      expect(loadDevicePreferences().audio?.muted).toBe(true);

      await audio.toggle(true);
      expect(loadDevicePreferences().audio?.muted).toBeUndefined();
    });
  });
});
