/**
 * Join lifecycle hook: connection, join with room slug + room token, and the
 * session state transitions behind the provider's store.
 */

import { singleFlight } from "@zvonok/client/helpers/concurrency";
import type { SfuManager } from "@zvonok/client/sfu/manager";
import { useCallback, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";

import { useZvonokSession } from "../contexts/zvonok-context.js";
import type { SessionState } from "../core/session-store.js";
import { ZvonokError, ZvonokJoinError } from "../errors.js";
import type { ZvonokStatus } from "../types.js";
import { createDeferred } from "./deferred.js";
import { useStoreSelector } from "./use-store-selector.js";

const CONNECTION_TIMEOUT_MS = 10_000;
const JOIN_TIMEOUT_MS = 10_000;

export interface UseZvonokConnectionOptions {
  /** Room slug to join. Provide the slug, the room id, or both. */
  roomSlug?: string;
  /** Room id to join, for consumers that know the id before the slug. */
  roomId?: string;
  /**
   * Room token minted by the server; the server derives identity from it.
   * Omit it to join on the browser session the server verifies at the
   * handshake (cookie-identity deployments).
   */
  token?: string;
  /**
   * Supplies a fresh room token when a rejoin is denied for expiry. Called
   * at most once per rejoin; the initial join never calls it.
   */
  tokenProvider?: () => Promise<string>;
}

export interface UseZvonokConnectionResult {
  status: ZvonokStatus;
  error: Error | null;
  join(): Promise<void>;
  leave(): void;
  /** True when the room is locked by the host. */
  isRoomLocked: boolean;
  /** True after the server removed this peer from the room. */
  wasKicked: boolean;
  /** True after the server ended the room; the connection was released. */
  roomEnded: boolean;
}

function toZvonokError(error: unknown, fallbackCode: string): ZvonokError {
  if (error instanceof ZvonokError) {
    return error;
  }
  return new ZvonokError(
    fallbackCode,
    error instanceof Error ? error.message : "Failed to join the room",
  );
}

function waitForConnectionState(manager: SfuManager, timeoutMs: number): Promise<void> {
  const { promise, resolve, reject } = createDeferred<void>();
  if (manager.getState().connectionState === "connected") {
    resolve();
    return promise;
  }

  let unsubscribe: () => void;
  const settle = (error: ZvonokError | null) => {
    clearTimeout(timer);
    unsubscribe();
    if (error) {
      reject(error);
    } else {
      resolve();
    }
  };
  const timer = setTimeout(() => {
    settle(new ZvonokError("CONNECTION_FAILED", "Timed out connecting to the Zvonok server"));
  }, timeoutMs);
  unsubscribe = manager.onStateChange((state) => {
    if (state.connectionState === "connected") {
      settle(null);
    } else if (state.connectionState === "failed") {
      settle(new ZvonokError("CONNECTION_FAILED", "Could not connect to the Zvonok server"));
    }
  });
  return promise;
}

/**
 * Subscribes to the join ack immediately, closing any window where an ack
 * could be missed; `send` sends the join request once connected.
 */
function createJoinAckWaiter(
  socket: Socket,
  timeoutMs: number,
  emitJoin: () => void,
): { promise: Promise<void>; send: () => void } {
  const { promise, resolve, reject } = createDeferred<void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    socket.off("sfu:joined", onJoined);
    socket.off("sfu:join-error", onJoinError);
  };
  const onJoined = () => {
    cleanup();
    resolve();
  };
  const onJoinError = (payload: unknown) => {
    const { code, message } = (payload ?? {}) as { code?: string; message?: string };
    cleanup();
    reject(new ZvonokJoinError(code ?? "JOIN_FAILED", message ?? "The server rejected the join"));
  };
  socket.on("sfu:joined", onJoined);
  socket.on("sfu:join-error", onJoinError);
  return {
    promise,
    send: () => {
      timer = setTimeout(() => {
        cleanup();
        reject(new ZvonokJoinError("JOIN_TIMEOUT", "The server did not confirm the join"));
      }, timeoutMs);
      emitJoin();
    },
  };
}

export function useZvonokConnection({
  roomId,
  roomSlug,
  token,
  tokenProvider,
}: UseZvonokConnectionOptions): UseZvonokConnectionResult {
  const session = useZvonokSession();
  const store = session.store;
  const state = useStoreSelector(store, selectSessionState);
  const manager = state.manager;
  const managerRef = useRef<SfuManager | null>(null);
  const joinLocksRef = useRef(new Map<string, Promise<unknown>>());
  const detachRoomListenersRef = useRef<(() => void) | null>(null);
  /** Bumped by every leave(); in-flight joins check it before acting. */
  const leaveGenerationRef = useRef(0);

  const ensureManager = useCallback((): SfuManager => {
    if (managerRef.current) {
      return managerRef.current;
    }
    const manager = session.createManager({ serverUrl: session.serverUrl });
    managerRef.current = manager;
    store.setManager(manager);
    return manager;
  }, [session, store]);

  const leave = useCallback(() => {
    // Supersede any in-flight join first: it observes the generation bump
    // after each await and stops touching the session.
    leaveGenerationRef.current += 1;
    detachRoomListenersRef.current?.();
    detachRoomListenersRef.current = null;
    const manager = managerRef.current;
    if (manager) {
      manager.leaveRoom();
      manager.disconnect();
    }
    managerRef.current = null;
    joinLocksRef.current.delete("join");
    store.disconnected();
  }, [store]);

  const join = useCallback((): Promise<void> => {
    if (!roomId && !roomSlug) {
      return Promise.reject(
        new ZvonokJoinError("INVALID_JOIN_PAYLOAD", "Provide a room id or a room slug to join"),
      );
    }
    return singleFlight(joinLocksRef.current, "join", async () => {
      const generation = leaveGenerationRef.current;
      // A leave() that landed before or during this join supersedes it: the
      // join settles silently instead of fighting the teardown for state.
      const superseded = () => leaveGenerationRef.current !== generation;
      if (superseded()) return;

      const manager = ensureManager();
      store.connecting();
      manager.connect();

      const socket = manager.getSocket();
      if (socket) {
        const onRoomLocked = (payload: unknown) => {
          const { locked } = (payload ?? {}) as { locked?: boolean };
          store.setLocked(locked === true);
        };
        socket.on("sfu:room-locked", onRoomLocked);
        detachRoomListenersRef.current = () => {
          socket.off("sfu:room-locked", onRoomLocked);
        };
      }

      // Subscribe to the ack before awaiting the connection so no ack or
      // denial can slip through unnoticed.
      const ack = createJoinAckWaiter(manager.getSocket() as Socket, JOIN_TIMEOUT_MS, () => {
        void manager.joinRoom(
          {
            ...(roomId ? { roomId } : {}),
            ...(roomSlug ? { roomSlug } : {}),
            ...(token ? { token } : {}),
          },
          { tokenProvider },
        );
      });

      try {
        await waitForConnectionState(manager, CONNECTION_TIMEOUT_MS);
        if (superseded()) return;
        ack.send();
        await ack.promise;
        if (superseded()) return;
        store.joined();
      } catch (error) {
        if (superseded()) return;
        throw error;
      }
    }).catch((error: unknown) => {
      const typedError = toZvonokError(error, "JOIN_FAILED");
      store.failed(typedError);
      throw typedError;
    });
  }, [ensureManager, roomId, roomSlug, store, token, tokenProvider]);

  // Automatic recovery: mirror the manager's reconnecting/connected cycle
  // into the session status. A recovery failure surfaces typed as an error.
  const reconnectingRef = useRef(false);
  useEffect(() => {
    if (!manager) {
      return;
    }
    const offState = manager.onStateChange((state) => {
      if (state.connectionState === "reconnecting") {
        reconnectingRef.current = true;
        store.reconnecting();
        return;
      }
      if (state.connectionState === "connected" && reconnectingRef.current) {
        reconnectingRef.current = false;
        store.joined();
      }
    });
    const offReconnectError = manager.onReconnectError((error) => {
      store.failed(new ZvonokError("RECONNECT_FAILED", error.message));
    });
    return () => {
      offState();
      offReconnectError();
    };
  }, [manager, store]);

  // A kicked peer loses its room membership; reflect it in the status.
  useEffect(() => {
    if (!manager) {
      return;
    }
    const offKicked = manager.onKicked(() => {
      store.kicked();
    });
    return () => {
      offKicked();
    };
  }, [manager, store]);

  // A server-ended room is terminal: surface the state and release the
  // connection (which also stops automatic recovery).
  useEffect(() => {
    if (!manager) {
      return;
    }
    const offRoomEnded = manager.onRoomEnded(() => {
      store.roomEnded();
      leaveRef.current();
    });
    return () => {
      offRoomEnded();
    };
  }, [manager, store]);

  // Disconnect when the owning component unmounts.
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  }, [leave]);
  useEffect(
    () => () => {
      leaveRef.current();
    },
    [],
  );

  return {
    status: state.status,
    error: state.error,
    join,
    leave,
    isRoomLocked: state.locked,
    wasKicked: state.kicked,
    roomEnded: state.roomEnded,
  };
}

const selectSessionState = (state: SessionState) => state;
