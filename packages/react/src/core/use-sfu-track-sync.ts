/**
 * Replace-track sync: when a capture restarts while its producer exists
 * (device switch, lost-and-regained device), swap the published track
 * instead of producing a second one. Runs while mounted; pair it with the
 * room lifecycle the same way as the other session hooks.
 */

import { isActive } from "@zvonok/client/media/capture-state";
import { useEffect } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";

export function useSfuTrackSync(): void {
  const { mediaManager, manager: sfuManager } = useZvonokSession();
  const videoTrackProvider = mediaManager.videoCapture;
  const audioTrackProvider = mediaManager.audioCapture;

  useEffect(() => {
    if (!sfuManager) {
      return;
    }
    return videoTrackProvider.onStateChange(async (state, track) => {
      if (isActive(state) && track && sfuManager.getProducerByKind("video")) {
        await sfuManager.replaceTrack("video", track);
      }
    });
  }, [videoTrackProvider, sfuManager]);

  useEffect(() => {
    if (!sfuManager) {
      return;
    }
    return audioTrackProvider.onStateChange(async (state, track) => {
      if (isActive(state) && track && sfuManager.getProducerByKind("audio")) {
        await sfuManager.replaceTrack("audio", track);
      }
    });
  }, [audioTrackProvider, sfuManager]);
}
