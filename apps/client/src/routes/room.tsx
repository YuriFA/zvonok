import { useZvonokConnection, ZvonokProvider } from "@zvonok/react";
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
import { useGuestJoinRoom } from "@/features/room/hooks/use-guest-join-room";
import { useRoom } from "@/features/room/hooks/use-room";
import { roomApi } from "@/features/room/services/room-api";
import { loadGuestDisplayName, saveGuestDisplayName } from "@/lib/utils/display-name";

const SOCKET_URL =
  (import.meta.env as { VITE_SOCKET_URL?: string }).VITE_SOCKET_URL ?? "http://localhost:3000";

type RoomViewState = "prejoin" | "active" | "ended";

/** Inside the provider: owns the connection and the join/ended flow. */
function RoomSession({
  room,
  displayName,
  currentUserId,
  viewState,
  setViewState,
  guestView,
}: {
  room: NonNullable<ReturnType<typeof useRoom>["data"]>;
  displayName: string;
  currentUserId: string | undefined;
  viewState: RoomViewState;
  setViewState: (state: RoomViewState) => void;
  guestView: React.ReactNode;
}) {
  const { user } = useAuth();
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

  const isOwner = user?.id === room.ownerId;

  return (
    <MediaStreamProvider>
      {viewState === "prejoin" ? (
        guestView
      ) : (
        <>
          {isOwner ? (
            <GuestRequestsProvider roomSlug={room.slug}>
              <GuestApprovalDialog />
              <RoomView
                room={room}
                displayName={displayName}
                currentUserId={currentUserId}
                connection={connection}
              />
            </GuestRequestsProvider>
          ) : (
            <RoomView
              room={room}
              displayName={displayName}
              currentUserId={currentUserId}
              connection={connection}
            />
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

  const [displayName, setDisplayName] = useState(() => user?.username ?? loadGuestDisplayName());
  const [guestPreApproved, setGuestPreApproved] = useState(false);

  const [guestUserId, setGuestUserId] = useState<string | undefined>(undefined);

  const currentUserId = user?.id ?? guestUserId;

  const handleJoined = useCallback(() => {
    setViewState("active");
  }, []);
  const {
    join,
    retry,
    guestState,
    error: joinError,
  } = useGuestJoinRoom({ onJoinApproved: handleJoined });

  // On mount: if guest, check for a valid HTTP-only cookie
  useEffect(() => {
    if (user || !slug) return;
    roomApi
      .guestCheck(slug)
      .then((result) => {
        if (result.valid) {
          setGuestPreApproved(true);
          if (result.displayName) {
            setDisplayName(result.displayName);
          }
        }
      })
      .catch(() => {
        // silent fail — treat as no pre-approval
      });
  }, [user, slug]);

  // Resolve guest identity from the server once the guest enters the room
  useEffect(() => {
    if (user || !slug || viewState !== "active") return;
    roomApi
      .getRoomMe(slug)
      .then((result) => setGuestUserId(result.userId))
      .catch(() => {
        // silent fail — identity will be undefined
      });
  }, [user, slug, viewState]);

  useEffect(() => {
    if (room?.status === "ended") {
      setViewState("ended");
    }
  }, [room?.status]);

  const handleJoin = useCallback(async () => {
    if (!slug) return;

    if (user || guestPreApproved) {
      setViewState("active");
      return;
    }

    saveGuestDisplayName(displayName);

    await join({ slug, displayName });
  }, [user, guestPreApproved, slug, displayName, join]);

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
      <RoomSession
        room={room}
        displayName={displayName}
        currentUserId={currentUserId}
        viewState={viewState}
        setViewState={setViewState}
        guestView={
          <PrejoinView
            roomUrl={roomUrl}
            displayName={displayName}
            onDisplayNameChange={setDisplayName}
            onJoin={handleJoin}
            guestState={user ? undefined : guestState}
            errorMessage={joinError}
            onRetry={retry}
          />
        }
      />
    </ZvonokProvider>
  );
};
