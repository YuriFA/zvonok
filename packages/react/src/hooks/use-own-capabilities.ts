/**
 * Own capabilities: the server-delivered capability list for the local
 * participant, mirrored from the connection state. Empty until the join
 * acknowledgement arrives; consumers gate UI on membership instead of
 * decoding roles client-side.
 */

import { useEffect, useState } from "react";

import type { CapabilityId } from "@zvonok/client/sfu/types";

import { useZvonokSession } from "../contexts/zvonok-context.js";

export function useOwnCapabilities(): CapabilityId[] {
  const session = useZvonokSession();
  const [capabilities, setCapabilities] = useState<CapabilityId[]>(() => {
    if (typeof window === "undefined") return [];
    return session.manager?.getState().capabilities ?? [];
  });

  useEffect(() => {
    const manager = session.manager;
    if (!manager) {
      setCapabilities([]);
      return;
    }
    setCapabilities(manager.getState().capabilities);
    return manager.onStateChange((state) => setCapabilities(state.capabilities));
  }, [session.manager]);

  return capabilities;
}
