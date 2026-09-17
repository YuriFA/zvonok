/**
 * Video element binding: assigns a MediaStream to a <video> element and
 * re-asserts playback. Assigning unconditionally (null clears) stops the
 * decoder from working on a stale stream, and a bounded play() retry
 * recovers from engines that do not start decoding on assignment alone
 * (Safari/Firefox) or from a transiently blocked autoplay.
 */

import { useEffect, type RefObject } from "react";

const PLAY_RETRY_DELAY_MS = 250;
const MAX_PLAY_ATTEMPTS = 3;

export function useVideoStream(
  ref: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || element.srcObject === stream) {
      return;
    }
    element.srcObject = stream;

    if (!stream) {
      return;
    }

    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const attemptPlay = () => {
      if (cancelled) {
        return;
      }
      // play() returns a promise in every real browser; wrapping keeps
      // environments without one (jsdom) a silent no-op instead of crashing.
      void Promise.resolve(element.play()).catch(() => {
        if (cancelled || attempts >= MAX_PLAY_ATTEMPTS - 1) {
          return;
        }
        attempts += 1;
        retryTimer = setTimeout(attemptPlay, PLAY_RETRY_DELAY_MS);
      });
    };
    attemptPlay();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
  }, [ref, stream]);
}
