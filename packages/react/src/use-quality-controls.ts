/**
 * Manual quality selection: request a simulcast preference for a remote
 * participant's subscribed video. Affects only the caller's subscription;
 * audio and other subscribers are untouched.
 */

import { useMemo } from "react";

import type { SimulcastSpatialLayer } from "@zvonok/client/sfu/types";

import { ZvonokError } from "./errors.js";
import { useZvonokSession } from "./zvonok-context.js";

/** Quality levels mapped onto simulcast spatial layers (0 = low, 2 = high). */
export type ParticipantQualityLevel = "low" | "medium" | "high";

const SPATIAL_LAYER_BY_LEVEL: Record<
  ParticipantQualityLevel,
  SimulcastSpatialLayer
> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface UseQualityControlsResult {
  /**
   * Request a quality preference for a remote participant's camera video.
   * Rejects with a typed error when the participant is unknown or has no
   * subscribed video to tune.
   */
  setParticipantQuality(
    userId: string,
    level: ParticipantQualityLevel,
  ): Promise<void>;
}

export function useQualityControls(): UseQualityControlsResult {
  const session = useZvonokSession();

  return useMemo(() => {
    const setParticipantQuality = async (
      userId: string,
      level: ParticipantQualityLevel,
    ): Promise<void> => {
      const manager = session.manager;
      if (!manager) {
        throw new ZvonokError(
          "DISCONNECTED",
          "Join the room before adjusting quality",
        );
      }
      const consumerId = manager.getVideoConsumerIdForUserId(userId);
      if (!consumerId) {
        throw new ZvonokError(
          "PARTICIPANT_VIDEO_NOT_FOUND",
          `No subscribed video for participant ${userId}`,
        );
      }
      manager.setPreferredLayers(
        consumerId,
        SPATIAL_LAYER_BY_LEVEL[level],
      );
    };

    return { setParticipantQuality };
  }, [session.manager]);
}
