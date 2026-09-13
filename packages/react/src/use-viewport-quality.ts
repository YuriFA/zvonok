/**
 * Viewport-driven track quality: observes a participant tile and drives the
 * SFU simulcast layer selection for that participant's camera consumer.
 * Visible tiles request the highest spatial layer immediately; tiles that
 * leave the viewport drop to the lowest layer after a short delay, so scroll
 * flaps do not spam the signalling. Requests coalesce: an unchanged layer is
 * never re-requested, and tiles whose camera consumer does not exist yet
 * (or local tiles, which have none) never produce a request. Tiles rendered
 * without this hook keep full quality.
 */

import { useEffect, type RefObject } from "react";

import type { SimulcastSpatialLayer } from "@zvonok/client/sfu/types";

import { useZvonokSession } from "./zvonok-context.js";

/** A tile counts as visible once this fraction of it enters the viewport. */
const INTERSECTION_THRESHOLD = 0.25;

/** Highest simulcast spatial layer (0 = low, 1 = mid, 2 = high). */
const FULL_LAYER: SimulcastSpatialLayer = 2;
/** Lowest simulcast spatial layer. */
const HIDDEN_LAYER: SimulcastSpatialLayer = 0;
/** How long a tile must stay off-screen before its layer is demoted. */
const DEMOTE_DELAY_MS = 400;

export function useViewportQuality(
  ref: RefObject<HTMLElement | null>,
  userId: string | null,
): void {
  const manager = useZvonokSession().manager;

  useEffect(() => {
    const element = ref.current;
    if (!element || !userId || !manager || typeof IntersectionObserver === "undefined") {
      return;
    }

    let lastRequested: SimulcastSpatialLayer | null = null;
    let demoteTimer: ReturnType<typeof setTimeout> | null = null;

    const requestLayer = (layer: SimulcastSpatialLayer) => {
      if (lastRequested === layer) {
        return;
      }
      const consumerId = manager.getVideoConsumerIdForUserId(userId);
      if (!consumerId) {
        // No camera consumer to address yet (not subscribed, or the local
        // participant). The requested-layer memory stays untouched, so a
        // later visibility change still addresses the real layer.
        return;
      }
      lastRequested = layer;
      manager.setPreferredLayers(consumerId, layer);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting);
        if (isVisible) {
          if (demoteTimer !== null) {
            clearTimeout(demoteTimer);
            demoteTimer = null;
          }
          requestLayer(FULL_LAYER);
        } else if (lastRequested !== HIDDEN_LAYER && demoteTimer === null) {
          demoteTimer = setTimeout(() => {
            demoteTimer = null;
            requestLayer(HIDDEN_LAYER);
          }, DEMOTE_DELAY_MS);
        }
      },
      { threshold: [INTERSECTION_THRESHOLD] },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (demoteTimer !== null) {
        clearTimeout(demoteTimer);
      }
    };
  }, [manager, ref, userId]);
}
