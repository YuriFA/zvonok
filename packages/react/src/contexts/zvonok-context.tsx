/**
 * ZvonokProvider and the internal session context.
 * The provider carries the server URL, the shared media manager, and the
 * room session state that the SDK hooks orchestrate.
 */

import type { IMediaManager } from "@zvonok/client/media/interfaces";
import { createMediaManager } from "@zvonok/client/media/manager-factory";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { ZvonokStatus } from "../types.js";

export interface ZvonokSessionState {
  manager: SfuManager | null;
  status: ZvonokStatus;
  error: Error | null;
  /** Latest sfu:room-locked value; false until the server reports a lock. */
  locked: boolean;
  /** True after the server ended the room; terminal for the session. */
  roomEnded: boolean;
}

export interface ZvonokSession extends ZvonokSessionState {
  serverUrl: string;
  mediaManager: IMediaManager;
  update(patch: Partial<ZvonokSessionState>): void;
}

const ZvonokSessionContext = createContext<ZvonokSession | null>(null);

export interface ZvonokProviderProps {
  /** Base URL of the Zvonok server, e.g. "https://sfu.example.com". */
  serverUrl: string;
  children: ReactNode;
}

export function ZvonokProvider({ serverUrl, children }: ZvonokProviderProps) {
  const [state, setState] = useState<ZvonokSessionState>({
    manager: null,
    status: "disconnected",
    error: null,
    locked: false,
    roomEnded: false,
  });
  const [mediaManager] = useState(() => createMediaManager());

  useEffect(() => () => mediaManager.stop(), [mediaManager]);

  const value = useMemo<ZvonokSession>(
    () => ({
      serverUrl,
      ...state,
      mediaManager,
      update: (patch) => setState((prev) => ({ ...prev, ...patch })),
    }),
    [serverUrl, state, mediaManager],
  );

  return <ZvonokSessionContext.Provider value={value}>{children}</ZvonokSessionContext.Provider>;
}

/**
 * Access the session managed by ZvonokProvider.
 * Throws when used outside of a provider.
 */
export function useZvonokSession(): ZvonokSession {
  const session = useContext(ZvonokSessionContext);
  if (!session) {
    throw new Error("Zvonok hooks must be used within a ZvonokProvider");
  }
  return session;
}
