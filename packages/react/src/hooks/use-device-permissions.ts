/**
 * Reactive device permission state: wraps the media device service's
 * permissions query with change notifications. Engines differ in how
 * reliably `PermissionStatus.onchange` fires, so the value is also
 * re-queried when the window regains focus. Environments without the
 * permissions API (or without a state for a given kind) surface "unknown"
 * instead of throwing.
 */

import type { IMediaDeviceService } from "@zvonok/client/media/interfaces";
import { useEffect, useState } from "react";

import { useZvonokSession } from "../contexts/zvonok-context.js";

export type DevicePermissionState = "granted" | "denied" | "prompting" | "unknown";

function translate(state: string): DevicePermissionState {
  if (state === "granted" || state === "denied") {
    return state;
  }
  // The platform calls it "prompt": a decision has not been made yet.
  if (state === "prompt") {
    return "prompting";
  }
  return "unknown";
}

export function useDevicePermissions(kind: "video" | "audio"): DevicePermissionState {
  const session = useZvonokSession();
  const mediaManager = session.mediaManager;
  const [state, setState] = useState<DevicePermissionState>("unknown");

  useEffect(() => {
    let cancelled = false;
    let status: PermissionStatus | null = null;
    // Out-of-order guard: a slow older query must never overwrite the
    // result of a newer one (e.g. a fresh focus re-query).
    let querySeq = 0;
    const service: IMediaDeviceService = mediaManager.getDeviceService();

    const sync = (next: DevicePermissionState) => {
      if (!cancelled) {
        setState(next);
      }
    };

    const query = () => {
      const seq = ++querySeq;
      // queryPermission returns a promise in every real environment; the
      // resolve() wrapper keeps partially-mocked or odd services from
      // throwing synchronously.
      Promise.resolve(service.queryPermission(kind))
        .then((result) => {
          if (cancelled || seq !== querySeq) {
            return;
          }
          status = result;
          sync(translate(result.state));
          result.onchange = () => {
            if (seq === querySeq) {
              sync(translate(result.state));
            }
          };
        })
        .catch(() => {
          if (!cancelled && seq === querySeq) {
            sync("unknown");
          }
        });
    };
    query();

    // Fallback for engines with flaky change events.
    window.addEventListener("focus", query);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", query);
      if (status) {
        status.onchange = null;
      }
    };
  }, [kind, mediaManager]);

  return state;
}
