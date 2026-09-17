/**
 * Room status block: derives the room states a surface renders cards from
 * (locked, kicked, join failure, reconnection) from the call and connection
 * inputs, and renders the preset cards. Recovery actions stay with the owner
 * via callbacks.
 */

import { useMemo } from "react";

import type { UseZvonokCallResult, UseZvonokConnectionResult } from "../../index.js";

export interface StatusCardsPresetProps {
  call: UseZvonokCallResult;
  connection: UseZvonokConnectionResult;
  /** From an ended/kicked room back to the prejoin stage. */
  onBack?: () => void;
  className?: string;
}

const COPY = {
  locked: "Room is locked - new participants cannot join",
  kicked: "You were removed from the room by the host",
  connecting: "Connecting...",
  reconnecting: "Connection lost - reconnecting...",
  back: "Back",
} as const;

function joinErrorMessage(error: Error | null): string {
  if (!error) {
    return "Join failed";
  }
  return error.message || "Join failed";
}

/**
 * Preset status surfaces: locked banner, kicked card, join-error card, and
 * connection status line. Derives the room-status projection internally
 * from the call and connection inputs; renders nothing when the room is
 * unremarkable.
 */
export function StatusCardsPreset({ call, connection, onBack, className }: StatusCardsPresetProps) {
  const status = useMemo(
    () => ({
      connectionState: call.connectionState,
      isConnecting: connection.status === "connecting",
      isReconnecting: connection.status === "reconnecting",
      isRoomLocked: call.isRoomLocked,
      wasKicked: call.wasKicked,
      hasJoinError: connection.status === "error",
      joinError: connection.error,
    }),
    [call.connectionState, call.isRoomLocked, call.wasKicked, connection.status, connection.error],
  );

  if (
    !status.isRoomLocked &&
    !status.wasKicked &&
    !status.hasJoinError &&
    !status.isConnecting &&
    !status.isReconnecting
  ) {
    return null;
  }

  return (
    <div className={["zk-status-cards", className].filter(Boolean).join(" ")}>
      {status.isRoomLocked && (
        <p className="zk-banner" role="status">
          {COPY.locked}
        </p>
      )}
      {status.isConnecting && (
        <p className="zk-status" role="status">
          {COPY.connecting}
        </p>
      )}
      {status.isReconnecting && (
        <p className="zk-status" role="status">
          {COPY.reconnecting}
        </p>
      )}
      {status.hasJoinError && (
        <div className="zk-card zk-card-error" role="alert">
          <p>{joinErrorMessage(status.joinError)}</p>
          {onBack && (
            <button type="button" className="zk-button" onClick={onBack}>
              {COPY.back}
            </button>
          )}
        </div>
      )}
      {status.wasKicked && (
        <div className="zk-card zk-card-error" role="alert">
          <p>{COPY.kicked}</p>
          {onBack && !status.hasJoinError && (
            <button type="button" className="zk-button" onClick={onBack}>
              {COPY.back}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
