/**
 * Publish-toggle orchestration: the pause / produce / replace / resume
 * sequence behind every camera and microphone button. Disabling pauses
 * the producer and lets the consumer release capture hardware; enabling
 * publishes a live track (re-acquiring it first when the lobby or a
 * device loss left none), swapping it into an existing producer before
 * resuming - resuming first would stream silence until the swap lands.
 *
 * The result names the outcome so consumers can roll back their own UI
 * state and present failures where they want to.
 */

import type { SfuManager } from "@zvonok/client/sfu/manager";
import { useCallback, useMemo } from "react";

import { ZvonokError } from "./../errors.js";
import type { CapturePort } from "./capture-port.js";

export type PublishKind = "audio" | "video";

/**
 * Why a toggle ended. `published` / `paused` succeeded; the rest are
 * failure points in order: no live track could be re-acquired, the
 * producer could not be created, the track swap into an existing
 * producer failed.
 */
export type PublishToggleResult =
  | "published"
  | "paused"
  | "no-track"
  | "produce-failed"
  | "replace-failed";

export interface UsePublishControlsOptions {
  /** Slower publish errored-retry pacing on phones; forwarded to produce. */
  isMobile?: boolean;
}

export interface UsePublishControlsResult {
  toggle(kind: PublishKind, enabled: boolean, port: CapturePort): Promise<PublishToggleResult>;
}

export function usePublishControls(
  manager: SfuManager | null,
  options: UsePublishControlsOptions = {},
): UsePublishControlsResult {
  const isMobile = options.isMobile;

  const toggle = useCallback(
    async (
      kind: PublishKind,
      enabled: boolean,
      { getTrack, ensureTrack, release }: CapturePort,
    ): Promise<PublishToggleResult> => {
      if (!manager) {
        throw new ZvonokError("DISCONNECTED", "Join the room before using publish controls");
      }

      const getProducer = () => manager.getProducerByKind(kind);

      if (!enabled) {
        const producer = getProducer();
        if (producer) {
          manager.pauseProducer(producer.id);
        }
        await release?.(kind);
        return "paused";
      }

      let track = getTrack(kind);
      // A camera or mic disabled in the lobby (or a lost device) leaves no
      // live track; re-acquire capture before publishing.
      if (!track || track.readyState !== "live") {
        const stream = await ensureTrack?.(kind);
        track = stream?.getTracks().find((candidate) => candidate.kind === kind) ?? null;
        if (!track || track.readyState !== "live") {
          return "no-track";
        }
      }

      if (!getProducer()) {
        const producer = await manager.produce(
          track,
          isMobile === undefined ? undefined : { isMobile },
        );
        if (producer === null) {
          return "produce-failed";
        }
        manager.resumeProducer(producer.id);
        return "published";
      }

      // The producer still references the track that "off" ended. Swap it
      // in first: resuming first would stream silence until the swap lands.
      const replaced = await manager.replaceTrack(kind, track);
      if (!replaced) {
        return "replace-failed";
      }
      const producer = getProducer();
      if (producer) {
        manager.resumeProducer(producer.id);
      }
      return "published";
    },
    [manager, isMobile],
  );

  return useMemo(() => ({ toggle }), [toggle]);
}
