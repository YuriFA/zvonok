import { CaptureState } from "@zvonok/client/media/capture-state";
import { useEffect } from "react";

import { useZvonokSession } from "@zvonok/react";

export function useSfuTrackSync(): void {
  const { mediaManager, manager: sfuManager } = useZvonokSession();
  const videoTrackProvider = mediaManager.videoCapture;
  const audioTrackProvider = mediaManager.audioCapture;

  useEffect(() => {
    if (!sfuManager) {
      return;
    }
    return videoTrackProvider.onStateChange(async (state, track) => {
      if (state === CaptureState.ACTIVE && track && sfuManager.getProducerByKind("video")) {
        await sfuManager.replaceTrack("video", track);
      }
    });
  }, [videoTrackProvider, sfuManager]);

  useEffect(() => {
    if (!sfuManager) {
      return;
    }
    return audioTrackProvider.onStateChange(async (state, track) => {
      if (state === CaptureState.ACTIVE && track && sfuManager.getProducerByKind("audio")) {
        await sfuManager.replaceTrack("audio", track);
      }
    });
  }, [audioTrackProvider, sfuManager]);
}
