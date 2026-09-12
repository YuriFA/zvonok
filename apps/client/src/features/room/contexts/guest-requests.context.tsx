import { useGuestJoinRequests } from "@zvonok/react";
import { createContext, useCallback, useContext } from "react";

import { roomApi } from "../services/room-api";

interface GuestRequestsContextValue {
  pendingRequests: { requestId: string; displayName: string }[];
  approveRequest: (requestId: string) => Promise<void>;
  denyRequest: (requestId: string) => Promise<void>;
}

const GuestRequestsContext = createContext<GuestRequestsContextValue | null>(null);

interface GuestRequestsProviderProps {
  roomSlug: string;
  children: React.ReactNode;
}

/**
 * Owner-side guest flow: the request queue comes from the SDK's
 * useGuestJoinRequests hook; approval and denial stay app-side (owner
 * cookie session via the room REST API).
 */
export function GuestRequestsProvider({ roomSlug, children }: GuestRequestsProviderProps) {
  const { pendingRequests, removeRequest } = useGuestJoinRequests();

  const approveRequest = useCallback(
    async (requestId: string) => {
      try {
        await roomApi.guestApprove(roomSlug, requestId);
      } catch {
        // ignore errors
      } finally {
        removeRequest(requestId);
      }
    },
    [roomSlug, removeRequest],
  );

  const denyRequest = useCallback(
    async (requestId: string) => {
      try {
        await roomApi.guestDeny(roomSlug, requestId);
      } catch {
        // ignore errors
      } finally {
        removeRequest(requestId);
      }
    },
    [roomSlug, removeRequest],
  );

  return (
    <GuestRequestsContext value={{ pendingRequests, approveRequest, denyRequest }}>
      {children}
    </GuestRequestsContext>
  );
}

const DEFAULT_VALUE: GuestRequestsContextValue = {
  pendingRequests: [],
  approveRequest: async () => {},
  denyRequest: async () => {},
};

// eslint-disable-next-line react-refresh/only-export-components
export function useGuestRequests(): GuestRequestsContextValue {
  return useContext(GuestRequestsContext) ?? DEFAULT_VALUE;
}
