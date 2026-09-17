import { Loader2, Lock, LockOpen, Redo2, Undo2, X } from "lucide-react";

import { useWhiteboardPanel } from "./use-whiteboard-panel";

export interface WhiteboardPanelProps {
  roomSlug: string;
  /** Origin of the Socket.io server; empty for same-origin deployments. */
  socketUrl?: string;
  isOwner: boolean;
  /** Host-provided credential refresh for rejected handshakes. */
  refreshSession?: () => Promise<boolean>;
  onClose(): void;
}

/**
 * The whiteboard room panel: status and draw-lock header with multiplayer
 * undo/redo, and the engine canvas mounted below. All logic lives in
 * {@link useWhiteboardPanel}; the host room view only provides props.
 */
export function WhiteboardPanel({
  roomSlug,
  socketUrl,
  isOwner,
  refreshSession,
  onClose,
}: WhiteboardPanelProps) {
  const board = useWhiteboardPanel({ roomSlug, socketUrl, enabled: true, isOwner, refreshSession });
  const canDraw = board.canDraw;

  return (
    <div className="absolute inset-2 z-10 flex flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border md:inset-0 md:rounded-none md:ring-0">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <span className="text-sm font-medium">Whiteboard</span>
        <span
          className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          role="status"
          aria-label={board.mode === "open" ? "Drawing open to all" : "Drawing locked to host"}
        >
          {board.mode === "open" ? (
            <>
              <LockOpen className="size-3" /> Drawing open
            </>
          ) : (
            <>
              <Lock className="size-3" /> Host-only drawing
            </>
          )}
        </span>
        {canDraw && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={board.undo}
              disabled={!board.history.canUndo}
              aria-label="Undo my last action"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={board.redo}
              disabled={!board.history.canRedo}
              aria-label="Redo my last undone action"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Redo2 className="size-4" />
            </button>
          </div>
        )}
        {isOwner && (
          <button
            type="button"
            onClick={() => board.setBoardMode(board.mode === "open" ? "owner" : "open")}
            className="flex h-7 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent"
          >
            {board.mode === "open" ? (
              <>
                <Lock className="size-3.5" /> Lock drawing
              </>
            ) : (
              <>
                <LockOpen className="size-3.5" /> Open drawing
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-sm p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close whiteboard"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {board.status === "connecting" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Connecting to board...</span>
          </div>
        )}
        {board.status === "error" ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            The board is unavailable in this room.
          </div>
        ) : (
          <div
            className="size-full"
            data-testid="board-canvas"
            data-readonly={!canDraw}
            ref={board.setContainer}
          />
        )}
      </div>
    </div>
  );
}
