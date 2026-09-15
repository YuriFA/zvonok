import { hasCapabilities, mapScreenShareError, useRoomLayout, useScreenShare } from "@zvonok/react";
import { Lock, LockOpen, MessageSquare, MicOff, Users } from "lucide-react";
import { Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ParticipantsList } from "@/components/room/participants-list";
import { Button } from "@/components/ui/button";
import { VideoGrid } from "@/components/video-grid";
import { ChatPanel } from "@/features/chat/components/chat-panel";
import { ChatProvider, useChatContext } from "@/features/chat/contexts/chat.context";
import { useCallRecording } from "@/features/media/hooks/use-call-recording";
import { RoomCenterControls } from "@/features/room/components/room-center-controls";
import { RoomVideo } from "@/features/room/components/room-video";
import { ScreenShareSpotlight } from "@/features/room/components/screen-share-spotlight";
import { useKeyboardShortcuts } from "@/features/room/hooks/use-keyboard-shortcuts";
import { roomPanels } from "@/features/room/room-panels";
import { useElementSize } from "@/hooks/use-element-size";

import { useGuestRequests } from "../contexts/guest-requests.context";
import { useActiveSpeakerId } from "../contexts/room-audio.context";
import { useRoomIdentity } from "../contexts/room-identity.context";
import { useRoomSessionActions, useRoomSessionState } from "../contexts/room-session.context";
import type { Room } from "../types/room.types";
import { AsidePanel, AsidePanelContainer, AsidePanelHeader } from "./aside-panel";
import { RoomLeftControls } from "./room-left-controls";
import { RoomRightControls } from "./room-right-controls";

interface ActiveScreenShare {
  userId: string;
  sharerName: string;
  stream: MediaStream;
  isLocal: boolean;
}

interface ActiveRoomViewProps {
  room: Room;
}

export function ActiveRoomView({ room }: ActiveRoomViewProps) {
  const { userId: currentUserId } = useRoomIdentity();

  return (
    <ChatProvider roomId={room.id} currentUserId={currentUserId}>
      <ActiveRoomViewContent room={room} />
    </ChatProvider>
  );
}

function ActiveRoomViewContent({ room }: { room: Room }) {
  const { userId: currentUserId, displayName: currentUsername } = useRoomIdentity();
  const chat = useChatContext();
  const {
    localVideoStream,
    localAudioStream,
    mediaControls,
    remotePeers,
    localUserId,
    participants,
    isRoomLocked,
    capabilities,
  } = useRoomSessionState();
  const { toggleVideo, toggleAudio, kickPeer, hostControls } = useRoomSessionActions();

  const { ref: containerRef, size: dimensions } = useElementSize<HTMLDivElement>();

  const {
    sharing: isSharing,
    screenStream,
    blocked: isScreenShareBlocked,
    start: startScreenShare,
    stop: stopScreenShare,
  } = useScreenShare();
  const [isStartingScreenShare, setIsStartingScreenShare] = useState(false);
  const screenShareState = isSharing ? "sharing" : isStartingScreenShare ? "starting" : "idle";

  const isScreenShareSupported =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function";

  // Stage arrangement: the package derivation orders local-first, picks
  // the spotlight sharer, and computes rects. It memoizes on arrangement
  // semantics, so unrelated participant churn keeps tile references stable.
  const layout = useRoomLayout({
    participants: useMemo(
      () => [
        {
          userId: localUserId,
          isLocal: true,
          isScreenSharing: isSharing && screenStream !== null,
        },
        ...remotePeers.map((peer) => ({
          userId: peer.userId,
          isScreenSharing: peer.isScreenSharing && peer.screenStream !== null,
        })),
      ],
      [localUserId, isSharing, screenStream, remotePeers],
    ),
    containerWidth: dimensions.width,
    containerHeight: dimensions.height,
  });
  const isSpotlightMode = layout.spotlight !== null;

  // Active screen share payload for the spotlight selected above.
  const activeScreenShare = useMemo((): ActiveScreenShare | null => {
    if (layout.spotlight === null) {
      return null;
    }
    if (layout.spotlight.userId === localUserId) {
      if (!screenStream) {
        return null;
      }
      return {
        userId: localUserId,
        sharerName: currentUsername ?? "You",
        stream: screenStream,
        isLocal: true,
      };
    }
    const remotePeer = remotePeers.find((peer) => peer.userId === layout.spotlight?.userId);
    if (remotePeer?.screenStream) {
      return {
        userId: remotePeer.userId,
        sharerName: remotePeer.username,
        stream: remotePeer.screenStream,
        isLocal: false,
      };
    }
    return null;
  }, [layout.spotlight, localUserId, currentUsername, screenStream, remotePeers]);
  const activeSpeakerId = useActiveSpeakerId();

  const recorder = useCallRecording({
    roomSlug: room.slug,
    localUserId,
    localDisplayName: currentUsername ?? "You",
    localVideoStream,
    localAudioStream,
    remotePeers,
    activeScreenShare:
      activeScreenShare === null
        ? null
        : {
            userId: activeScreenShare.userId,
            label: activeScreenShare.sharerName,
            stream: activeScreenShare.stream,
          },
    activeSpeakerId,
  });

  // Recording is possible as long as anyone in the room publishes media.
  const isRecordingEnabled =
    (localVideoStream?.getTracks() ?? []).some((track) => track.readyState === "live") ||
    (localAudioStream?.getTracks() ?? []).some((track) => track.readyState === "live") ||
    remotePeers.some((peer) => peer.isCameraEnabled || peer.isAudioEnabled || peer.isScreenSharing);

  const handleToggleRecord = () => {
    if (recorder.state === "recording") {
      recorder.stop();
    } else {
      recorder.start();
    }
  };

  // Stable per-tile style objects: RoomVideo is memoized, so rebuilding
  // styles on every participant event would defeat the bailout.
  const tileStyles = useMemo(
    () =>
      layout.tiles.map(
        (tile): React.CSSProperties => ({
          position: "absolute",
          top: 0,
          left: 0,
          width: tile.rect.width,
          height: tile.rect.height,
          transform: `translateX(${tile.rect.x}px) translateY(${tile.rect.y}px)`,
        }),
      ),
    [layout.tiles],
  );

  const isOwner = currentUserId === room.ownerId;

  // Server-delivered capabilities gate the host affordances; role and
  // owner knowledge never lives in the client.
  const canMuteUsers = hasCapabilities(capabilities, "mute-users");
  const canLockRoom = hasCapabilities(capabilities, "lock-room");
  const canRemoveParticipants = hasCapabilities(capabilities, "remove-participants");

  const [asideState, setAsideState] = useState<string | null>(null);

  const overlayPanel = roomPanels.find((panel) => panel.id === asideState) ?? null;

  const handleMuteAll = useCallback(async () => {
    try {
      await hostControls.muteAll();
    } catch {
      toast.error("Could not mute everyone");
    }
  }, [hostControls]);

  const handleToggleLock = useCallback(async () => {
    try {
      await hostControls.lockRoom(!isRoomLocked);
    } catch {
      toast.error("Could not change the room lock");
    }
  }, [hostControls, isRoomLocked]);

  const handleMuteParticipant = useCallback(
    async (userId: string) => {
      try {
        await hostControls.mutePeer(userId);
      } catch {
        toast.error("Could not mute the participant");
      }
    },
    [hostControls],
  );
  const { pendingRequests, approveRequest, denyRequest } = useGuestRequests();

  const handleToggleScreenShare = useCallback(async () => {
    if (isSharing) {
      stopScreenShare();
      return;
    }

    setIsStartingScreenShare(true);
    try {
      await startScreenShare();
    } catch (error) {
      const message = mapScreenShareError(error, {
        blocked: "Another participant is already sharing",
        fallback: "Screen share was not started",
      });
      if (message !== undefined) {
        toast.error(message);
      }
    } finally {
      setIsStartingScreenShare(false);
    }
  }, [isSharing, startScreenShare, stopScreenShare]);
  useKeyboardShortcuts({
    onToggleAudio: toggleAudio,
    onToggleVideo: toggleVideo,
    onToggleScreenShare: handleToggleScreenShare,
  });

  const hasValidDimensions = dimensions.width > 0 && dimensions.height > 0;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {isRoomLocked && (
        <div
          className="flex items-center justify-center gap-2 bg-amber-500/15 py-1.5 text-xs font-medium text-amber-600"
          role="status"
        >
          <Lock className="size-3.5" />
          Room is locked - new participants cannot join
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 p-4">
        <VideoGrid ref={containerRef}>
          {hasValidDimensions && (
            <>
              {/* Screen share spotlight - rendered only in spotlight mode */}
              {isSpotlightMode && activeScreenShare && layout.spotlight && (
                <ScreenShareSpotlight
                  key={activeScreenShare.userId}
                  stream={activeScreenShare.stream}
                  sharerName={activeScreenShare.sharerName}
                  isLocal={activeScreenShare.isLocal}
                  style={{
                    position: "absolute",
                    top: layout.spotlight.rect.y,
                    left: layout.spotlight.rect.x,
                    width: layout.spotlight.rect.width,
                    height: layout.spotlight.rect.height,
                  }}
                />
              )}

              {/* Local participant tile */}
              <RoomVideo
                userId={localUserId}
                style={tileStyles[0]}
                stream={localVideoStream}
                username={currentUsername}
                isVideoEnabled={mediaControls.isVideoEnabled}
                isAudioEnabled={mediaControls.isAudioEnabled}
              />

              {/* Remote participant tiles */}
              {remotePeers.map((peer, index) => (
                <RoomVideo
                  key={peer.userId}
                  userId={peer.userId}
                  style={tileStyles[index + 1]}
                  stream={peer.cameraStream}
                  username={peer.username}
                  isVideoEnabled={peer.isCameraEnabled}
                  isAudioEnabled={peer.isAudioEnabled}
                />
              ))}
            </>
          )}
        </VideoGrid>

        {overlayPanel && (
          <Suspense fallback={null}>
            <overlayPanel.component
              roomSlug={room.slug}
              isOwner={isOwner}
              onClose={() => setAsideState(null)}
            />
          </Suspense>
        )}

        <AsidePanelContainer data-state={asideState ? "open" : "closed"}>
          {asideState === "participants" && (
            <AsidePanel>
              <AsidePanelHeader onClose={() => setAsideState(null)}>
                <Users className="size-4" />
                <span>Participants</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {participants.length}
                </span>
              </AsidePanelHeader>
              {(canMuteUsers || canLockRoom) && (
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Button size="sm" variant="outline" onClick={handleMuteAll}>
                    <MicOff className="size-3.5" />
                    Mute all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={handleToggleLock}
                  >
                    {isRoomLocked ? (
                      <LockOpen className="size-3.5" />
                    ) : (
                      <Lock className="size-3.5" />
                    )}
                    {isRoomLocked ? "Unlock room" : "Lock room"}
                  </Button>
                </div>
              )}
              <ParticipantsList
                participants={participants}
                currentUserId={currentUserId}
                roomOwnerId={room.ownerId}
                onKickParticipant={canRemoveParticipants ? kickPeer : undefined}
                onMuteParticipant={canMuteUsers ? handleMuteParticipant : undefined}
                onApproveRequest={isOwner ? approveRequest : undefined}
                onDenyRequest={isOwner ? denyRequest : undefined}
              />
            </AsidePanel>
          )}

          {asideState === "chat" && (
            <AsidePanel>
              <AsidePanelHeader onClose={() => setAsideState(null)}>
                <MessageSquare className="size-4" />
                Chat
              </AsidePanelHeader>
              <ChatPanel />
            </AsidePanel>
          )}
        </AsidePanelContainer>
      </div>

      <div className="flex items-center justify-between border-t p-4">
        <RoomLeftControls />

        <RoomCenterControls
          className="mx-auto"
          isScreenSharing={isSharing}
          isScreenShareSupported={isScreenShareSupported}
          isScreenShareBlocked={isScreenShareBlocked}
          screenShareState={screenShareState}
          onToggleScreenShare={handleToggleScreenShare}
          recordingState={recorder.state}
          elapsedSeconds={recorder.elapsedSeconds}
          isRecordingSupported={recorder.isSupported}
          isRecordingEnabled={isRecordingEnabled}
          onToggleRecord={handleToggleRecord}
        />
        <RoomRightControls
          pendingRequestsCount={isOwner ? pendingRequests.length : undefined}
          isParticipantsVisible={asideState === "participants"}
          onToggleParticipants={() =>
            setAsideState((v) => (v === "participants" ? null : "participants"))
          }
          isChatOpen={asideState === "chat"}
          panels={roomPanels}
          openPanelId={overlayPanel?.id ?? null}
          onTogglePanel={(id) => setAsideState((v) => (v === id ? null : id))}
          onToggleChat={() => {
            setAsideState((v) => {
              const next = v === "chat" ? null : "chat";
              if (next === "chat") chat.resetUnreadCount();
              return next;
            });
          }}
          unreadCount={chat.unreadCount}
        />
      </div>
    </main>
  );
}
