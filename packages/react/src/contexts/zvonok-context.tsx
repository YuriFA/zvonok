/**
 * ZvonokProvider and the internal session context. The provider carries the
 * server URL, the shared media manager, and the session store; the store is
 * the single owner of the join session fields, driven by the connection
 * hook's named transitions. Manager factories are injectable for tests.
 */

import type { IMediaManager } from "@zvonok/client/media/interfaces";
import { createMediaManager as createDefaultMediaManager } from "@zvonok/client/media/manager-factory";
import { createSfuManager, type SfuManager } from "@zvonok/client/sfu/manager";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { SessionStore, type SessionState } from "../core/session-store.js";

export type ZvonokSessionState = SessionState;

export interface ZvonokSession extends ZvonokSessionState {
  serverUrl: string;
  mediaManager: IMediaManager;
  /** The session store: named transitions are the only writers. */
  store: SessionStore;
  /** The manager factory this provider composes with; injectable per provider. */
  createManager(options: { serverUrl: string }): SfuManager;
}

interface ZvonokSessionContextValue {
  serverUrl: string;
  mediaManager: IMediaManager;
  store: SessionStore;
  /** Manager factory: defaults to the standard client manager; injectable in tests. */
  createManager(options: { serverUrl: string }): SfuManager;
}

const ZvonokSessionContext = createContext<ZvonokSessionContextValue | null>(null);

export interface ZvonokProviderProps {
  /** Base URL of the Zvonok server, e.g. "https://sfu.example.com". */
  serverUrl: string;
  /**
   * Supplies the SfuManager; defaults to the standard client manager.
   * Tests inject doubles here instead of mocking client modules.
   */
  createManager?: (options: { serverUrl: string }) => SfuManager;
  /**
   * Supplies the media manager; defaults to the shared client media manager.
   * Tests inject doubles here instead of mocking client modules.
   */
  createMediaManager?: () => IMediaManager;
  children: ReactNode;
}

export function ZvonokProvider({
  serverUrl,
  createManager,
  createMediaManager,
  children,
}: ZvonokProviderProps) {
  const [store] = useState(() => new SessionStore());
  const [mediaManager] = useState(() => createMediaManager?.() ?? createDefaultMediaManager());
  const defaultCreateManager = useCallback(
    (options: { serverUrl: string }) => createSfuManager(options),
    [],
  );
  const effectiveCreateManager = createManager ?? defaultCreateManager;

  useEffect(() => () => mediaManager.stop(), [mediaManager]);

  const value = useMemo<ZvonokSessionContextValue>(
    () => ({ serverUrl, mediaManager, store, createManager: effectiveCreateManager }),
    [serverUrl, mediaManager, store, effectiveCreateManager],
  );

  return <ZvonokSessionContext.Provider value={value}>{children}</ZvonokSessionContext.Provider>;
}

/**
 * Access the session managed by ZvonokProvider: the server URL, the shared
 * media manager, and the current session state snapshot. Throws when used
 * outside of a provider.
 */
export function useZvonokSession(): ZvonokSession {
  const context = useContext(ZvonokSessionContext);
  if (!context) {
    throw new Error("Zvonok hooks must be used within a ZvonokProvider");
  }
  const state = useSyncExternalStore(context.store.subscribe, context.store.getSnapshot);
  return useMemo(() => ({ ...context, ...state }), [context, state]);
}
