import { isActive } from "@zvonok/client/media/capture-state";
import { useZvonokSession } from "@zvonok/react";
import { useCallback, useRef } from "react";

export interface UseDeviceSwitchingReturn {
  switchVideoDevice: (deviceId: string) => Promise<boolean>;
  switchAudioDevice: (deviceId: string) => Promise<boolean>;
}

export function useDeviceSwitching(): UseDeviceSwitchingReturn {
  const mediaManager = useZvonokSession().mediaManager;
  const videoController = mediaManager.videoCapture;
  const audioController = mediaManager.audioCapture;
  const videoStateReader = mediaManager.videoCapture;
  const audioStateReader = mediaManager.audioCapture;
  const isSwitchingRef = useRef(false);

  const switchVideoDevice = useCallback(
    async (deviceId: string): Promise<boolean> => {
      if (isSwitchingRef.current) {
        console.log("[DeviceSwitching] Already switching, skipping");
        return false;
      }

      isSwitchingRef.current = true;

      try {
        if (!isActive(videoStateReader.getState())) {
          return true;
        }

        return await videoController.switchDevice(deviceId);
      } catch (error) {
        console.error("[DeviceSwitching] Failed to switch video device:", error);
        return false;
      } finally {
        isSwitchingRef.current = false;
      }
    },
    [videoController, videoStateReader],
  );

  const switchAudioDevice = useCallback(
    async (deviceId: string): Promise<boolean> => {
      if (isSwitchingRef.current) {
        console.log("[DeviceSwitching] Already switching, skipping");
        return false;
      }

      isSwitchingRef.current = true;

      try {
        if (!isActive(audioStateReader.getState())) {
          return true;
        }

        return await audioController.switchDevice(deviceId);
      } catch (error) {
        console.error("[DeviceSwitching] Failed to switch audio device:", error);
        return false;
      } finally {
        isSwitchingRef.current = false;
      }
    },
    [audioController, audioStateReader],
  );

  return {
    switchVideoDevice,
    switchAudioDevice,
  };
}
