/**
 * Device controls hook: the single public device surface over the shared
 * @zvonok/client media manager. Start/stop camera and mic, toggle, switch
 * devices (serialized; switching an inactive device records intent without
 * powering the hardware on), reactive enumeration refreshed on devicechange,
 * an explicitly selected device triple persisted across sessions, and folded
 * permission state.
 */

import type { CaptureState } from "@zvonok/client/media/capture-state";
import { isActive } from "@zvonok/client/media/capture-state";
import type { IMediaManager } from "@zvonok/client/media/interfaces";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import { useDevicePermissions, type DevicePermissionState } from "./use-device-permissions.js";

export interface ZvonokCaptureControl {
  state: CaptureState;
  track: MediaStreamTrack | null;
  /** The captured stream, for local previews (prejoin tiles). */
  stream: MediaStream | null;
  toggle(enabled: boolean): Promise<boolean>;
  switchDevice(deviceId: string): Promise<boolean>;
}

/** The user's explicit device picks, persisted across sessions. */
export interface DeviceSelection {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
  speakerDeviceId: string | null;
}

export interface UseDeviceControlsOptions {
  /**
   * localStorage key for the explicit selection. Hosts with pre-existing
   * stored selections pass their legacy key to keep user data continuous.
   */
  storageKey?: string;
}

export interface UseDeviceControlsResult {
  camera: ZvonokCaptureControl;
  mic: ZvonokCaptureControl;
  start(options?: {
    video?: boolean;
    audio?: boolean;
    videoDeviceId?: string;
    audioDeviceId?: string;
  }): Promise<void>;
  stop(): void;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  /** Reactive device list, refreshed whenever the device set changes. */
  devices: MediaDeviceInfo[];
  isLoading: boolean;
  selectedDevices: DeviceSelection;
  selectVideoDevice(deviceId: string | null): void;
  selectAudioDevice(deviceId: string | null): void;
  selectSpeakerDevice(deviceId: string | null): void;
  permissions: { video: DevicePermissionState; audio: DevicePermissionState };
}

const DEFAULT_STORAGE_KEY = "zvonok:device-selection";

function emptySelection(): DeviceSelection {
  return { videoDeviceId: null, audioDeviceId: null, speakerDeviceId: null };
}

/**
 * Reads the persisted selection without a React tree (startup paths that
 * acquire capture before any component mounts).
 */
export function loadDeviceSelection(storageKey: string = DEFAULT_STORAGE_KEY): DeviceSelection {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceSelection>;
      return {
        videoDeviceId: parsed.videoDeviceId ?? null,
        audioDeviceId: parsed.audioDeviceId ?? null,
        speakerDeviceId: parsed.speakerDeviceId ?? null,
      };
    }
  } catch {
    // Corrupt or unavailable storage: defaults are fine.
  }
  return emptySelection();
}

function saveDeviceSelection(selection: DeviceSelection, storageKey: string): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(selection));
  } catch {
    // Private mode or quota exceeded: persistence is a convenience.
  }
}

interface CaptureSnapshot {
  state: CaptureState;
  track: MediaStreamTrack | null;
  stream: MediaStream | null;
}

function snapshot(capture: {
  getState(): CaptureState;
  getTrack(): MediaStreamTrack | null;
  getStream(): MediaStream | null;
}): CaptureSnapshot {
  return {
    state: capture.getState(),
    track: capture.getTrack(),
    stream: capture.getStream(),
  };
}

export function useDeviceControls(options: UseDeviceControlsOptions = {}): UseDeviceControlsResult {
  const session = useZvonokSession();
  const mediaManager: IMediaManager = session.mediaManager;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;

  const [cameraSnapshot, setCameraSnapshot] = useState<CaptureSnapshot>(() =>
    snapshot(mediaManager.videoCapture),
  );
  const [micSnapshot, setMicSnapshot] = useState<CaptureSnapshot>(() =>
    snapshot(mediaManager.audioCapture),
  );

  useEffect(() => {
    const unsubscribeVideo = mediaManager.onVideoStateChange((state, track) =>
      setCameraSnapshot({
        state,
        track: track ?? null,
        stream: mediaManager.videoCapture.getStream(),
      }),
    );
    const unsubscribeAudio = mediaManager.onAudioStateChange((state, track) =>
      setMicSnapshot({
        state,
        track: track ?? null,
        stream: mediaManager.audioCapture.getStream(),
      }),
    );
    return () => {
      unsubscribeVideo();
      unsubscribeAudio();
    };
  }, [mediaManager]);

  // Reactive enumeration: populated on mount and refreshed whenever the
  // browser reports the device set changed (connect, disconnect, permission
  // grant). A failed enumeration keeps the previous list; the next
  // devicechange or remount retries.
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setIsLoading(true);
      try {
        const list = await mediaManager.getDeviceService().enumerateDevices();
        if (!cancelled) {
          setDevices(list);
        }
      } catch {
        // Enumeration can fail before any capture permission; recover on the
        // next devicechange or remount.
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void refresh();
    // jsdom and older embedders may expose the registry without the event API.
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [mediaManager]);

  const [selectedDevices, setSelectedDevices] = useState<DeviceSelection>(() =>
    loadDeviceSelection(storageKey),
  );
  useEffect(() => {
    saveDeviceSelection(selectedDevices, storageKey);
  }, [selectedDevices, storageKey]);

  const selectVideoDevice = useCallback((deviceId: string | null) => {
    setSelectedDevices((prev) => ({ ...prev, videoDeviceId: deviceId }));
  }, []);
  const selectAudioDevice = useCallback((deviceId: string | null) => {
    setSelectedDevices((prev) => ({ ...prev, audioDeviceId: deviceId }));
  }, []);
  const selectSpeakerDevice = useCallback((deviceId: string | null) => {
    setSelectedDevices((prev) => ({ ...prev, speakerDeviceId: deviceId }));
  }, []);

  // One switch at a time across both kinds: overlapping getUserMedia calls
  // interleave state transitions on the same manager.
  const switchingRef = useRef(false);
  const guardedSwitch = useCallback(
    async (
      capture: { getState(): CaptureState; switchDevice(deviceId: string): Promise<boolean> },
      deviceId: string,
    ): Promise<boolean> => {
      if (switchingRef.current) {
        return false;
      }
      switchingRef.current = true;
      try {
        // Switching an inactive device only records intent; it must not
        // power the hardware on.
        if (!isActive(capture.getState())) {
          return true;
        }
        return await capture.switchDevice(deviceId);
      } catch {
        return false;
      } finally {
        switchingRef.current = false;
      }
    },
    [],
  );

  const cameraPermission = useDevicePermissions("video");
  const micPermission = useDevicePermissions("audio");
  const permissions = useMemo(
    () => ({ video: cameraPermission, audio: micPermission }),
    [cameraPermission, micPermission],
  );

  return useMemo(
    () => ({
      camera: {
        ...cameraSnapshot,
        toggle: (enabled: boolean) => mediaManager.videoCapture.toggle(enabled),
        switchDevice: (deviceId: string) => guardedSwitch(mediaManager.videoCapture, deviceId),
      },
      mic: {
        ...micSnapshot,
        toggle: (enabled: boolean) => mediaManager.audioCapture.toggle(enabled),
        switchDevice: (deviceId: string) => guardedSwitch(mediaManager.audioCapture, deviceId),
      },
      start: async (startOptions?: {
        video?: boolean;
        audio?: boolean;
        videoDeviceId?: string;
        audioDeviceId?: string;
      }) => {
        // Explicit ids win; otherwise the persisted selection applies, with
        // a null/empty selection falling through to the browser default.
        const saved = loadDeviceSelection(storageKey);
        await mediaManager.start({
          video: startOptions?.video,
          audio: startOptions?.audio,
          videoDeviceId: startOptions?.videoDeviceId || saved.videoDeviceId || undefined,
          audioDeviceId: startOptions?.audioDeviceId || saved.audioDeviceId || undefined,
        });
      },
      stop: () => mediaManager.stop(),
      enumerateDevices: () => mediaManager.getDeviceService().enumerateDevices(),
      devices,
      isLoading,
      selectedDevices,
      selectVideoDevice,
      selectAudioDevice,
      selectSpeakerDevice,
      permissions,
    }),
    [
      cameraSnapshot,
      micSnapshot,
      mediaManager,
      guardedSwitch,
      storageKey,
      devices,
      isLoading,
      selectedDevices,
      selectVideoDevice,
      selectAudioDevice,
      selectSpeakerDevice,
      permissions,
    ],
  );
}
