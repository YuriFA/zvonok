/**
 * Local identity inside a room page: the authenticated user id (or the
 * server-resolved guest id once inside) plus the display name shown to
 * other participants. Provided by the room route so components read it at
 * the point of use instead of receiving it through prop chains.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface RoomIdentityValue {
  /** Authenticated user id or resolved guest id; undefined before resolution. */
  userId: string | undefined;
  displayName: string;
}

const RoomIdentityContext = createContext<RoomIdentityValue | null>(null);

interface RoomIdentityProviderProps {
  userId: string | undefined;
  displayName: string;
  children: ReactNode;
}

export function RoomIdentityProvider({ userId, displayName, children }: RoomIdentityProviderProps) {
  const value = useMemo(() => ({ userId, displayName }), [userId, displayName]);
  return <RoomIdentityContext value={value}>{children}</RoomIdentityContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRoomIdentity(): RoomIdentityValue {
  const ctx = useContext(RoomIdentityContext);
  if (!ctx) {
    throw new Error("useRoomIdentity must be used within a RoomIdentityProvider");
  }
  return ctx;
}
