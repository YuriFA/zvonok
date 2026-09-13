import { useCallback, useEffect, useRef, useState } from "react";

import type { GuestState } from "../components/prejoin-view";
import { roomApi } from "../services/room-api";

const POLL_INTERVAL_MS = 2000;

export const useGuestJoinRoom = ({ onJoinApproved }: { onJoinApproved?: () => void } = {}) => {
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [guestState, setGuestState] = useState<GuestState>("idle");
  const [error, setError] = useState<string>("");

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startPolling = useCallback(
    (currentSlug: string, requestId: string) => {
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        // A hidden tab does not need the answer yet; skip the network
        // round trip until the tab is visible again.
        if (document.hidden) {
          return;
        }
        try {
          const result = await roomApi.guestStatus(currentSlug, requestId);
          if (result.status === "approved") {
            stopPolling();
            onJoinApproved?.();
          } else if (result.status === "denied") {
            stopPolling();
            setGuestState("denied");
          }
        } catch {
          stopPolling();
          setGuestState("error");
          setError("Your request expired or something went wrong.");
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, onJoinApproved],
  );

  const join = useCallback(
    async ({ slug, displayName }: { slug: string; displayName: string }) => {
      try {
        const { requestId } = await roomApi.guestRequest(slug, displayName);
        if (!requestId) {
          setGuestState("error");
          setError("Room owner is not online. Please try again later.");
          return;
        }
        setGuestState("waiting");
        startPolling(slug, requestId);
      } catch {
        setGuestState("error");
        setError("Failed to send join request. Please try again.");
      }
    },
    [startPolling],
  );

  const retry = useCallback(() => {
    stopPolling();
    setGuestState("idle");
    setError("");
  }, [stopPolling]);

  return { join, retry, error, guestState };
};
