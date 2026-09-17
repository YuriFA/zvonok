/**
 * Screen-share control as one hook: owns the ScreenShareService instance
 * over the session manager and exposes sharing state, including the
 * blocked-by-another-participant condition. Start/stop surface the
 * service's typed failures unchanged.
 */

import {
  ScreenShareService,
  browserDisplayMediaService,
} from "@zvonok/client/screen-share/service";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ZvonokError } from "../errors.js";
import { useZvonokSession } from "../contexts/zvonok-context.js";

export interface UseScreenShareResult {
  /** True while this participant's screen is captured and published. */
  sharing: boolean;
  /** The captured display stream, or null while not sharing. */
  screenStream: MediaStream | null;
  /** True while another participant holds the room's exclusive share. */
  blocked: boolean;
  /**
   * Captures the display and publishes it as the screen producer.
   * Throws the service's typed ScreenShareError values ("blocked", ...)
   * so consumers can render precise copy.
   */
  start(): Promise<void>;
  stop(): void;
}

export function useScreenShare(): UseScreenShareResult {
  const session = useZvonokSession();
  const manager = session.manager;

  const service = useMemo(
    () =>
      manager
        ? new ScreenShareService({ sfu: manager, displayMedia: browserDisplayMediaService })
        : null,
    [manager],
  );

  const [state, setState] = useState(() => service?.getState() ?? {
    isSharing: false,
    screenStream: null,
    isScreenShareBlocked: false,
  });

  useEffect(() => {
    if (!service) {
      setState({ isSharing: false, screenStream: null, isScreenShareBlocked: false });
      return;
    }
    const unsubscribe = service.onStateChange(setState);
    return () => {
      unsubscribe();
      service.destroy();
    };
  }, [service]);

  const start = useCallback((): Promise<void> => {
    if (!service) {
      return Promise.reject(new ZvonokError("DISCONNECTED", "Join the room before sharing your screen"));
    }
    return service.start();
  }, [service]);

  const stop = useCallback(() => {
    service?.stop();
  }, [service]);

  return {
    sharing: state.isSharing,
    screenStream: state.screenStream,
    blocked: state.isScreenShareBlocked,
    start,
    stop,
  };
}
