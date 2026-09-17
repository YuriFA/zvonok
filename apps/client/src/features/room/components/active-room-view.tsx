import {
  mapScreenShareError,
  useParticipantsPanel,
  useScreenShare,
  useStage,
  type PanelNotice,
} from "@zvonok/react";
import { Lock, LockOpen, MessageSquare, MicOff, Users } from "lucide-react";
import { Suspense, useCallback, useState } from "react";
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
import { useRoomSession, useRoomToggles } from "../contexts/room-session.context";
import type { Room } from "../types/room.types";
import { AsidePanel, AsidePanelContainer, AsidePanelHeader } from "./aside-panel";
import { RoomLeftControls } from "./room-left-controls";
import { RoomRightControls } from "./room-right-controls";

export function ActiveRoomView({ room }: { room: Room }) {
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
  const call = useRoomSession();
  const { toggleVideo, toggleAudio } = useRoomToggles();
  const { localVideoStream, localAudioStream, participants, localUserId, isRoomLocked } = call;
  // The call projection lists the local participant first.
  const remotePeers = participants.slice(1);

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
  // the spotlight sharer, and computes rects. Tile styles stay stable
  // across unrelated participant churn, so memoized tiles bail out.
  const { tiles, spotlight } = useStage({
    call,
    screenShare: {
      sharing: isSharing,
      screenStream,
      blocked: isScreenShareBlocked,
      start: startScreenShare,
      stop: stopScreenShare,
    },
    width: dimensions.width,
    height: dimensions.height,
    localName: currentUsername ?? "You",
  });
  const isSpotlightMode = spotlight !== null;

  const activeSpeakerId = useActiveSpeakerId();

  const recorder = useCallRecording({
    roomSlug: room.slug,
    localUserId,
    localDisplayName: currentUsername ?? "You",
    localVideoStream,
    localAudioStream,
    remotePeers,
    activeScreenShare:
      spotlight === null || spotlight.stream === null
        ? null
        : {
            userId: spotlight.isLocal ? localUserId : (spotlight.userId ?? spotlight.key),
            label: spotlight.name,
            stream: spotlight.stream,
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

  const isOwner = currentUserId === room.ownerId;

  // Host actions run through the package panel core: capability gating,
  // outcome notices, and roster ordering are single-sourced there. Chat,
  // guest policy, and whiteboard panels stay app domains.
  const { pendingRequests, approveRequest, denyRequest } = useGuestRequests();
  const onNotice = useCallback((notice: PanelNotice) => toast.error(notice.message), []);
  const panel = useParticipantsPanel({
    call,
    currentUserId,
    isOwner,
    pendingRequests,
    onApproveRequest: approveRequest,
    onDenyRequest: denyRequest,
    onNotice,
  });

  const [asideState, setAsideState] = useState<string | null>(null);
  const overlayPanel = roomPanels.find((panel) => panel.id === asideState) ?? null;

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
              {isSpotlightMode && spotlight !== null && spotlight.stream !== null && (
                <ScreenShareSpotlight
                  key={spotlight.key}
                  stream={spotlight.stream}
                  sharerName={spotlight.name}
                  isLocal={spotlight.isLocal}
                  style={spotlight.style}
                />
              )}

              {/* Local and remote tiles from the shared stage derivation */}
              {tiles.map((tile) => (
                <RoomVideo
                  key={tile.key}
                  userId={tile.isLocal ? localUserId : (tile.userId ?? tile.key)}
                  style={tile.style}
                  stream={tile.stream}
                  username={tile.isLocal ? currentUsername : tile.name}
                  isVideoEnabled={tile.isVideoOn}
                  isAudioEnabled={tile.isAudioOn}
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
                  {panel.participants.length}
                </span>
              </AsidePanelHeader>
              {(panel.canMuteAll || panel.canLockRoom) && (
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Button size="sm" variant="outline" onClick={() => void panel.muteAll()}>
                    <MicOff className="size-3.5" />
                    Mute all
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => void panel.toggleLock()}
                  >
                    {panel.isRoomLocked ? (
                      <LockOpen className="size-3.5" />
                    ) : (
                      <Lock className="size-3.5" />
                    )}
                    {panel.isRoomLocked ? "Unlock room" : "Lock room"}
                  </Button>
                </div>
              )}
              <ParticipantsList panel={panel} currentUserId={currentUserId} />
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
