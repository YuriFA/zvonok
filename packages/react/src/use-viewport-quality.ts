/**
 * Viewport-driven track quality: observes a participant tile and reports
 * its visibility to the room's quality engine, which adapts the SFU
 * simulcast layer selection for that participant's camera consumer (see
 * PeerQualityEngine). Tiles rendered without this hook keep full quality;
 * the local participant has no camera consumer and never produces a
 * request.
 */

import { useEffect, type RefObject } from "react";

import { usePeerQualityContext } from "./peer-quality-context.js";

/** A tile counts as visible once this fraction of it enters the viewport. */
const INTERSECTION_THRESHOLD = 0.25;

export function useViewportQuality(
  ref: RefObject<HTMLElement | null>,
  userId: string | null,
): void {
  const engine = usePeerQualityContext();

  useEffect(() => {
    const element = ref.current;
    if (!element || !userId || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        engine.setVisibility(userId, entries.some((entry) => entry.isIntersecting));
      },
      { threshold: [INTERSECTION_THRESHOLD] },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      // An unmounted tile is out of the layout: restore the default so a
      // remount (or the peer's next tile) starts fully visible.
      engine.setVisibility(userId, true);
    };
  }, [engine, ref, userId]);
}
