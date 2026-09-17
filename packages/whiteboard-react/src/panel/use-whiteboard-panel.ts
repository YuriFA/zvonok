import type { WhiteboardHistoryState, WhiteboardSession } from "@zvonok/whiteboard-core/engine";
import type { WhiteboardDrawMode } from "@zvonok/whiteboard-core/protocol";
import { WHITEBOARD_NAMESPACE } from "@zvonok/whiteboard-core/protocol";
import {
  createWhiteboardTransport,
  type WhiteboardSocketLike,
  type WhiteboardTransport,
} from "@zvonok/whiteboard-core/transport";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type WhiteboardStatus = "idle" | "connecting" | "open" | "error";

export interface UseWhiteboardPanelOptions {
  roomSlug: string;
  /** Origin of the Socket.io server; empty for same-origin deployments. */
  socketUrl?: string;
  enabled: boolean;
  isOwner: boolean;
  /**
   * Refresh the auth credential after a rejected handshake (e.g. an expired
   * access-token cookie). Called at most once per connection episode; the
   * socket's own reconnection retries with the refreshed cookie. Owned by
   * the host - the panel never handles auth itself.
   */
  refreshSession?: () => Promise<boolean>;
  onModeError?: (message: string) => void;
}

export interface WhiteboardPanelController {
  status: WhiteboardStatus;
  mode: WhiteboardDrawMode;
  canDraw: boolean;
  history: WhiteboardHistoryState;
  /** Owner action: ask the server to switch the draw-lock mode. */
  setBoardMode(next: WhiteboardDrawMode): void;
  undo(): void;
  redo(): void;
  /** Ref callback: mounts the engine canvas when the container attaches. */
  setContainer(element: HTMLElement | null): void;
}

/**
 * Owns the `/whiteboard` socket and the engine session for an open panel:
 * joins the room board, tracks the host draw-lock mode, mounts the engine
 * canvas once transport and container are both ready, and exposes
 * multiplayer undo/redo state.
 */
export function useWhiteboardPanel(options: UseWhiteboardPanelOptions): WhiteboardPanelController {
  const { roomSlug, socketUrl = "", enabled, isOwner } = options;

  const [status, setStatus] = useState<WhiteboardStatus>(enabled ? "connecting" : "idle");
  const [mode, setMode] = useState<WhiteboardDrawMode>("owner");
  const [history, setHistory] = useState<WhiteboardHistoryState>({
    canUndo: false,
    canRedo: false,
  });

  const sessionRef = useRef<WhiteboardSession | null>(null);
  const transportRef = useRef<WhiteboardTransport | null>(null);
  const pendingContainerRef = useRef<HTMLElement | null>(null);
  const mountingRef = useRef(false);
  const modeRef = useRef(mode);
  const isOwnerRef = useRef(isOwner);
  const refreshSessionRef = useRef(options.refreshSession);
  const refreshAttemptedRef = useRef(false);
  const onModeErrorRef = useRef(options.onModeError);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    isOwnerRef.current = isOwner;
  }, [isOwner]);
  useEffect(() => {
    refreshSessionRef.current = options.refreshSession;
  }, [options.refreshSession]);
  useEffect(() => {
    onModeErrorRef.current = options.onModeError;
  }, [options.onModeError]);

  const mountEngine = useCallback(async function mountEngine(): Promise<void> {
    if (mountingRef.current) return;
    mountingRef.current = true;
    try {
      // Deliberately dynamic: keeps the 1 MB+ Excalidraw bundle out of the
      // panel chunk; a static import would pull the engine into every build.
      const { excalidrawEngine } = await import("../engine-excalidraw/engine");
      for (;;) {
        const element = pendingContainerRef.current;
        const transport = transportRef.current;
        if (!element || !transport || sessionRef.current !== null) return;
        const session = await excalidrawEngine.mount(element, {
          transport,
          canDraw: modeRef.current === "open" || isOwnerRef.current,
        });
        if (pendingContainerRef.current === element && transportRef.current === transport) {
          sessionRef.current = session;
          setHistory(session.historyState());
          session.onHistoryChange(setHistory);
          return;
        }
        // Refs moved while the engine was mounting (StrictMode remount in
        // dev, a transport swap): the session holds the stale transport -
        // drop it and adopt whatever is current.
        session.dispose();
      }
    } finally {
      mountingRef.current = false;
      // A concurrent mount request may have been skipped while this one was
      // in flight; if there is still a live container and transport with no
      // session, run once more.
      if (
        sessionRef.current === null &&
        pendingContainerRef.current !== null &&
        transportRef.current !== null
      ) {
        void mountEngine();
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || roomSlug.length === 0) return;
    setStatus("connecting");

    const socket: Socket = io(`${socketUrl}${WHITEBOARD_NAMESPACE}`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
    });
    const transport = createWhiteboardTransport(
      socket as unknown as WhiteboardSocketLike,
      roomSlug,
    );
    transportRef.current = transport;

    const applyMode = (nextMode: WhiteboardDrawMode): void => {
      setMode(nextMode);
      sessionRef.current?.setReadonly(!(nextMode === "open" || isOwnerRef.current));
    };
    const offs = [
      transport.onState(() => setStatus("open")),
      transport.onMode(applyMode),
      transport.onError(({ message }) => {
        setStatus("error");
        onModeErrorRef.current?.(message);
      }),
    ];
    const recoverAuth = (): void => {
      // A rejected handshake most often means an expired access-token cookie
      // while the long-lived refresh cookie is still valid: mint a fresh one
      // and reconnect with it. The server rejects an expired cookie with a
      // server-side disconnect, which socket.io will not retry on its own.
      const refreshSession = refreshSessionRef.current;
      if (refreshAttemptedRef.current || !refreshSession) return;
      refreshAttemptedRef.current = true;
      void refreshSession().then((refreshed) => {
        if (!refreshed) {
          setStatus("error");
          return;
        }
        if (!socket.connected) socket.connect();
      });
    };
    socket.on("connect", () => {
      refreshAttemptedRef.current = false;
      transport.join();
    });
    socket.on("connect_error", recoverAuth);
    socket.on("disconnect", (reason: unknown) => {
      if (reason === "io server disconnect") recoverAuth();
    });
    if (socket.connected) transport.join();
    void mountEngine();

    return () => {
      for (const off of offs) off();
      socket.removeAllListeners();
      socket.disconnect();
      transportRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [enabled, roomSlug, socketUrl, mountEngine]);

  const setContainer = useCallback(
    (element: HTMLElement | null): void => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      pendingContainerRef.current = element;
      if (element !== null) void mountEngine();
    },
    [mountEngine],
  );

  const setBoardMode = useCallback((next: WhiteboardDrawMode): void => {
    transportRef.current?.setMode(next);
  }, []);

  const undo = useCallback((): void => {
    sessionRef.current?.undo();
  }, []);

  const redo = useCallback((): void => {
    sessionRef.current?.redo();
  }, []);

  return {
    status,
    mode,
    canDraw: mode === "open" || isOwner,
    history,
    setBoardMode,
    undo,
    redo,
    setContainer,
  };
}
