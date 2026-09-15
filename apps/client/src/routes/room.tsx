import { useQuery } from "@tanstack/react-query";
import { usePrejoin, useZvonokConnection, ZvonokProvider } from "@zvonok/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";

import { LinkButton } from "@/components/ui/link-button";
import { useAuth } from "@/features/auth/contexts/auth.context";
import { MediaStreamProvider } from "@/features/media/contexts/media-stream.context";
import { CallEndedView } from "@/features/room/components/call-ended-view";
import { GuestApprovalDialog } from "@/features/room/components/guest-approval-dialog";
import { PrejoinView } from "@/features/room/components/prejoin-view";
import { RoomView } from "@/features/room/components/room-view";
import { GuestRequestsProvider } from "@/features/room/contexts/guest-requests.context";
import {
  RoomIdentityProvider,
  useRoomIdentity,
} from "@/features/room/contexts/room-identity.context";
import { useGuestJoinRoom } from "@/features/room/hooks/use-guest-join-room";
import { useRoom } from "@/features/room/hooks/use-room";
import { roomApi } from "@/features/room/services/room-api";
import { roomKeys } from "@/lib/react-query/query-keys";
import { loadGuestDisplayName, saveGuestDisplayName } from "@/lib/utils/display-name";

const SOCKET_URL =
  (import.meta.env as { VITE_SOCKET_URL?: string }).VITE_SOCKET_URL ?? "http://localhost:3000";

type RoomViewState = "prejoin" | "active" | "ended";

/** Inside the provider: owns the connection and the join/ended flow. */
function RoomSession({
  room,
  viewState,
  setViewState,
  guestView,
}: {
  room: NonNullable<ReturnType<typeof useRoom>["data"]>;
  viewState: RoomViewState;
  setViewState: (state: RoomViewState) => void;
  guestView: React.ReactNode;
}) {
  const { userId } = useRoomIdentity();
  // Cookie-session join: no token, the server verifies the browser session.
  const connection = useZvonokConnection({ roomId: room.id, roomSlug: room.slug });

  // Entering the room connects and joins; leaving the pre-join stage is the
  // single join trigger, matching the previous orchestration.
  useEffect(() => {
    if (viewState !== "active" || connection.status !== "disconnected") {
      return;
    }
    void connection.join().catch(() => {
      // Typed failure is in session state; the room stays on prejoin.
      setViewState("prejoin");
    });
  }, [viewState, connection, setViewState]);

  // A server-ended room is terminal for the local session.
  useEffect(() => {
    if (connection.roomEnded) {
      setViewState("ended");
    }
  }, [connection.roomEnded, setViewState]);

  const isOwner = userId === room.ownerId;

  return (
    <MediaStreamProvider>
      {viewState === "prejoin" ? (
        guestView
      ) : (
        <>
          {isOwner ? (
            <GuestRequestsProvider roomSlug={room.slug}>
              <GuestApprovalDialog />
              <RoomView room={room} connection={connection} />
            </GuestRequestsProvider>
          ) : (
            <RoomView room={room} connection={connection} />
          )}
        </>
      )}
    </MediaStreamProvider>
  );
}

export const RoomPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [viewState, setViewState] = useState<RoomViewState>("prejoin");
  const { user, isLoading: authLoading } = useAuth();

  const { data: room, isLoading, error } = useRoom(slug || "");

  // Guest pre-approval and identity come from the server as queries; both are
  // derived values, never synced into state by effects.
  const guestCheckQuery = useQuery({
    queryKey: roomKeys.guestCheck(slug || ""),
    queryFn: () => roomApi.guestCheck(slug || ""),
    enabled: !user && !!slug,
  });
  const roomMeQuery = useQuery({
    queryKey: roomKeys.me(slug || ""),
    queryFn: () => roomApi.getRoomMe(slug || ""),
    enabled: !user && !!slug && viewState === "active",
  });

  const guestPreApproved = guestCheckQuery.data?.valid ?? false;
  const currentUserId = user?.id ?? roomMeQuery.data?.userId;
  const resolvedDisplayName =
    user?.username ?? guestCheckQuery.data?.displayName ?? loadGuestDisplayName();

  const handleJoined = useCallback(() => {
    setViewState("active");
  }, []);
  const {
    join,
    retry,
    guestState,
    error: joinError,
  } = useGuestJoinRoom({ onJoinApproved: handleJoined });

  // Prejoin machine: name draft plus the confirm handshake; the guest-vs-
  // member routing inside the confirm action stays app-side.
  const prejoin = usePrejoin({
    initialName: resolvedDisplayName,
    onConfirm: async ({ displayName: name }) => {
      if (!slug) {
        return;
      }
      if (user || guestPreApproved) {
        setViewState("active");
        return;
      }
      saveGuestDisplayName(name);
      await join({ slug, displayName: name });
    },
  });
  const displayName = prejoin.displayName;

  useEffect(() => {
    if (room?.status === "ended") {
      setViewState("ended");
    }
  }, [room?.status]);

  if (isLoading || authLoading) {
    return (
      <div className="flex min-h-dscreen items-center justify-center">
        <p className="text-muted-foreground">Loading room...</p>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="flex min-h-dscreen flex-col items-center justify-center gap-4">
        <p className="text-destructive">{error?.message || "Room not found"}</p>
        <LinkButton to="/">Back to Home</LinkButton>
      </div>
    );
  }

  if (viewState === "ended") {
    return <CallEndedView room={room} />;
  }

  const roomUrl = `${window.location.origin}/room/${room.slug}`;

  return (
    <ZvonokProvider serverUrl={SOCKET_URL}>
      <RoomIdentityProvider userId={currentUserId} displayName={displayName}>
        <RoomSession
          room={room}
          viewState={viewState}
          setViewState={setViewState}
          guestView={
            <PrejoinView
              roomUrl={roomUrl}
              displayName={displayName}
              onDisplayNameChange={prejoin.setDisplayName}
              onJoin={() => void prejoin.confirm()}
              guestState={user ? undefined : guestState}
              errorMessage={joinError}
              onRetry={retry}
            />
          }
        />
      </RoomIdentityProvider>
    </ZvonokProvider>
  );
};
