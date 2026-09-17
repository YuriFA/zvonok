import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CaptureState } from "@zvonok/client/media/capture-state";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mockUseRoom = vi.hoisted(() => vi.fn());
const mockUseEndRoom = vi.hoisted(() => vi.fn());
const mockUseAuth = vi.hoisted(() => vi.fn());
const mockUseZvonokCall = vi.hoisted(() => vi.fn());
const mockKickPeer = vi.hoisted(() => vi.fn());
const mockToggleVideo = vi.hoisted(() => vi.fn());
const mockToggleAudio = vi.hoisted(() => vi.fn());
const mockGuestCheck = vi.hoisted(() => vi.fn());
const mockGuestRequest = vi.hoisted(() => vi.fn());
const mockGuestStatus = vi.hoisted(() => vi.fn());
const mockGetRoomMe = vi.hoisted(() => vi.fn());

vi.mock("@/features/room/hooks/use-room", () => ({
  useRoom: mockUseRoom,
}));

vi.mock("@/features/room/hooks/use-end-room", () => ({
  useEndRoom: mockUseEndRoom,
}));

vi.mock("@/features/auth/contexts/auth.context", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("@/features/room/services/room-api", () => ({
  roomApi: {
    guestCheck: mockGuestCheck,
    guestRequest: mockGuestRequest,
    guestStatus: mockGuestStatus,
    guestApprove: vi.fn(),
    guestDeny: vi.fn(),
    getRoomMe: mockGetRoomMe,
  },
}));

const mockJoin = vi.hoisted(() => vi.fn(async () => {}));

const mockSfuManagerValue = {
  getProducerByKind: () => undefined,
  replaceTrack: vi.fn(async () => true),
  onQualityStats: () => () => {},
  onParticipantLeft: () => () => {},
  onStateChange: () => () => {},
  startStatsCollection: vi.fn(),
  stopStatsCollection: vi.fn(),
};

const mockConnection = {
  status: "joined",
  error: null,
  join: mockJoin,
  leave: vi.fn(),
  manager: mockSfuManagerValue,
  isRoomLocked: false,
  wasKicked: false,
  roomEnded: false,
  produceTrack: vi.fn(async () => true),
  pauseProducer: vi.fn(),
  resumeProducer: vi.fn(),
  closeProducer: vi.fn(),
  replaceTrack: vi.fn(async () => true),
  hasProducer: () => false,
};

const mockMediaManager = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  videoCapture: {
    getState: () => CaptureState.ACTIVE,
    getTrack: () => null,
    getStream: () => null,
    onStateChange: vi.fn(() => () => {}),
    start: vi.fn(),
    stop: vi.fn(),
    switchDevice: vi.fn(),
    toggle: vi.fn(),
  },
  audioCapture: {
    getState: () => CaptureState.ACTIVE,
    getTrack: () => null,
    getStream: () => null,
    onStateChange: vi.fn(() => () => {}),
    start: vi.fn(),
    stop: vi.fn(),
    switchDevice: vi.fn(),
    toggle: vi.fn(),
  },
  getDeviceService: () => ({
    getUserMedia: vi.fn(),
    enumerateDevices: vi.fn().mockResolvedValue([]),
    queryPermission: vi.fn(),
  }),
};

vi.mock("@zvonok/react", () => ({
  ZvonokProvider: ({ children }: { children: React.ReactNode }) => children,
  useZvonokSession: () => ({
    manager: mockSfuManagerValue,
    mediaManager: mockMediaManager,
    status: "joined",
    error: null,
    locked: false,
    roomEnded: false,
    update: vi.fn(),
  }),
  useZvonokConnection: () => mockConnection,
  useZvonokCall: () => mockUseZvonokCall(),
  useDeviceControls: () => ({
    devices: [],
    camera: {
      state: 2,
      stream: null,
      toggle: vi.fn(async () => true),
      switchDevice: vi.fn(async () => true),
    },
    mic: {
      state: 2,
      stream: null,
      toggle: vi.fn(async () => true),
      switchDevice: vi.fn(async () => true),
    },
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    isLoading: false,
    selectedDevices: { videoDeviceId: null, audioDeviceId: null, speakerDeviceId: null },
    selectVideoDevice: vi.fn(),
    selectAudioDevice: vi.fn(),
    selectSpeakerDevice: vi.fn(),
    permissions: { video: "granted", audio: "granted" },
  }),
  useParticipants: () => ({ participants: [] }),
  useOwnCapabilities: () => [],
  useEgressState: () => ({ isRecording: false }),
  useEgressControls: () => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }),
  useScreenShare: () => ({
    sharing: false,
    screenStream: null,
    blocked: false,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
  }),
  useGuestJoinRequests: () => ({ pendingRequests: [], removeRequest: vi.fn() }),
  createHostControls: () => ({
    muteAll: vi.fn(async () => {}),
    lockRoom: vi.fn(async () => {}),
    mutePeer: vi.fn(async () => {}),
  }),
  EMPTY_ROOM_STATE: { participants: [], locked: false, mutedByHost: false },
  PeerQualityProvider: ({ children }: { children: React.ReactNode }) => children,
  usePeerQualityStats: () => undefined,
  usePrejoin: (options?: {
    initialName?: string;
    onConfirm: (o: { displayName: string }) => Promise<void> | void;
  }) => ({
    phase: "confirming",
    displayName: options?.initialName ?? "",
    setDisplayName: () => {},
    canConfirm: true,
    confirm: async () => {
      await options?.onConfirm?.({ displayName: options?.initialName ?? "" });
    },
    reset: () => {},
  }),
  deriveMediaControlState: (options: { isEnabled: boolean; isMutedByHost?: boolean }) => ({
    isOn: options.isEnabled && !options.isMutedByHost,
    hasError: false,
    isLoading: false,
    isForcedOff: options.isMutedByHost ?? false,
    display: { tooltip: "toggle", status: "off", statusText: null },
  }),
  hasCapabilities: () => true,
  mapScreenShareError: () => undefined,
  useViewportQuality: () => {},
  useRoomLayout: () => ({
    mode: "grid",
    spotlight: null,
    tiles: [],
  }),
  useStage: () => ({ tiles: [], spotlight: null }),
  useMediaControls: () => ({
    video: {
      isOn: true,
      hasError: false,
      isLoading: false,
      isForcedOff: false,
      display: { tooltip: "Toggle video", status: "on", statusText: null },
    },
    audio: {
      isOn: true,
      hasError: false,
      isLoading: false,
      isForcedOff: false,
      display: { tooltip: "Toggle audio", status: "on", statusText: null },
    },
  }),
  useParticipantsPanel: (options?: {
    call?: ReturnType<typeof mockUseZvonokCall>;
    currentUserId?: string | null;
    isOwner?: boolean;
    pendingRequests?: Array<{ requestId: string; displayName: string }>;
    onApproveRequest?: (requestId: string) => Promise<void>;
    onDenyRequest?: (requestId: string) => Promise<void>;
  }) => {
    const call = options?.call ?? mockUseZvonokCall();
    const currentUserId = options?.currentUserId ?? null;
    const isOwner = options?.isOwner ?? false;
    const participants = (call.participants ?? []).map(
      (participant: {
        userId: string;
        displayName?: string;
        isAudioEnabled: boolean;
        isCameraEnabled: boolean;
        isConnected: boolean;
        mutedByHost?: boolean;
      }) => ({
        id: participant.userId,
        userId: participant.userId,
        username: participant.displayName || participant.userId,
        isMuted: !participant.isAudioEnabled,
        isVideoOff: !participant.isCameraEnabled,
        isConnected: participant.isConnected,
        isMutedByHost: participant.mutedByHost,
      }),
    );
    const sorted = [...participants].sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return a.username.localeCompare(b.username);
    });
    const pendingRequests = options?.pendingRequests ?? [];
    return {
      participants: sorted,
      isRoomLocked: call.isRoomLocked,
      canMuteAll: isOwner,
      canLockRoom: isOwner,
      muteAll: () => call.hostControls.muteAll(),
      toggleLock: () => call.hostControls.lockRoom(!call.isRoomLocked),
      canMuteParticipant: (participant: { id: string; isMutedByHost?: boolean }) =>
        isOwner && participant.id !== currentUserId && !participant.isMutedByHost,
      canKickParticipant: (participant: { id: string }) =>
        isOwner && participant.id !== currentUserId,
      muteParticipant: (userId: string) => call.hostControls.mutePeer(userId),
      kickParticipant: (userId: string) => call.kickPeer(userId),
      pendingRequests,
      hasPendingRequests: isOwner && pendingRequests.length > 0,
      canReviewRequests: isOwner,
      approveRequest: async (requestId: string) => {
        await options?.onApproveRequest?.(requestId);
      },
      denyRequest: async (requestId: string) => {
        await options?.onDenyRequest?.(requestId);
      },
    };
  },
}));

vi.mock("@/components/local-video", () => ({
  LocalVideo: ({ stream }: { stream: MediaStream | null }) => (
    <div data-testid="local-video">{stream ? "local-stream-ready" : "local-stream-missing"}</div>
  ),
}));

vi.mock("@/features/room/contexts/room-audio.context", () => ({
  useRoomAudioContext: () => ({
    setSink: vi.fn(async () => true),
    setVolume: vi.fn(),
    levels: {},
    activeSpeakerId: null,
  }),
  useAudioLevel: () => 0,
  useActiveSpeakerId: () => null,
  RoomAudioContextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/features/media/components/device-selector", () => ({
  DeviceSelector: () => <div data-testid="device-selector">device-selector</div>,
}));

vi.mock("@/features/media/components/device-settings-panel", () => ({
  DeviceSettingsPanel: () => <div data-testid="device-settings-panel">settings</div>,
}));

vi.mock("@/assets/logo.svg?react", () => ({
  default: () => null,
}));

vi.mock("@/lib/utils/display-name", () => ({
  loadGuestDisplayName: () => "Guest",
  saveGuestDisplayName: () => {},
  getAvatarColor: () => "bg-blue-500",
}));

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {
      if (this._callback) {
        this._callback([{ target: { clientWidth: 1280, clientHeight: 720 } }]);
      }
    }
    unobserve() {}
    disconnect() {}
    _callback: ((entries: unknown[]) => void) | null = null;
    constructor(callback: (entries: unknown[]) => void) {
      this._callback = callback;
    }
  },
);

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

import { RoomPage } from "../room";

const room = {
  id: "room-1",
  slug: "alpha",
  name: "Alpha Room",
  ownerId: "user-1",
  maxParticipants: 6,
  status: "active" as const,
  createdAt: "2026-03-12T00:00:00.000Z",
};

describe("RoomPage", () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseRoom.mockReturnValue({
      data: room,
      isLoading: false,
      error: null,
    });
    mockUseEndRoom.mockReturnValue({
      mutate,
      isPending: false,
      error: null,
    });
    mockUseAuth.mockReturnValue({
      user: {
        id: "user-1",
        username: "alice",
      },
    });
    mockUseZvonokCall.mockReturnValue({
      localVideoStream: { id: "local-video-stream", getTracks: () => [] } as unknown as MediaStream,
      localAudioStream: { id: "local-audio-stream", getTracks: () => [] } as unknown as MediaStream,
      camera: {
        isEnabled: true,
        captureState: CaptureState.ACTIVE,
        toggle: mockToggleVideo,
      },
      microphone: {
        isEnabled: true,
        captureState: CaptureState.ACTIVE,
        toggle: mockToggleAudio,
      },
      connectionState: "connected",
      capabilities: [
        "send-audio",
        "send-video",
        "send-screenshare",
        "mute-users",
        "remove-participants",
        "lock-room",
        "start-recording",
        "start-broadcast",
      ],
      participants: [
        {
          userId: "user-1",
          displayName: "alice",
          cameraStream: null,
          screenStream: null,
          audioStream: null,
          isCameraEnabled: true,
          isScreenSharing: false,
          isAudioEnabled: true,
          isConnected: true,
          mutedByHost: false,
        },
        {
          userId: "user-2",
          displayName: "bob",
          cameraStream: { id: "cam-remote" } as unknown as MediaStream,
          screenStream: null,
          audioStream: { id: "mic-remote" } as unknown as MediaStream,
          isCameraEnabled: true,
          isScreenSharing: false,
          isAudioEnabled: true,
          isConnected: true,
          mutedByHost: false,
        },
      ],
      localUserId: "user-1",
      isRoomLocked: false,
      mutedByHost: false,
      wasKicked: false,
      kickPeer: mockKickPeer,
      hostControls: { muteAll: vi.fn(), lockRoom: vi.fn(), mutePeer: vi.fn() },
    });
    mockToggleVideo.mockResolvedValue("published");
    mockToggleAudio.mockResolvedValue("published");
    mockKickPeer.mockResolvedValue(undefined);
    mockGetRoomMe.mockResolvedValue({ userId: "guest-abc" });
  });

  const renderRoomPage = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[`/room/${room.slug}`]}>
            <Routes>
              <Route path="/room/:slug" element={<RoomPage />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  };

  it("renders prejoin view and transitions to active room after joining (authenticated)", async () => {
    renderRoomPage();

    expect(screen.getByRole("button", { name: "Join Room" })).toBeInTheDocument();
    expect(screen.getByTestId("device-selector")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "End Room" })).toBeInTheDocument();
    });

    expect(screen.getByTestId("room-view")).toBeInTheDocument();
  });

  it("allows the room owner to kick a remote participant from the participants list", async () => {
    renderRoomPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Toggle participants"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kick bob" }));
    });

    expect(mockKickPeer).toHaveBeenCalledWith("user-2");
  });

  it("shows the ended state when the room status is ended", () => {
    mockUseRoom.mockReturnValue({
      data: { ...room, status: "ended", endedAt: "2026-03-12T01:00:00.000Z" },
      isLoading: false,
      error: null,
    });

    renderRoomPage();

    expect(screen.getByText("Call Ended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("Join Room")).not.toBeInTheDocument();
    expect(screen.queryByTestId("device-selector")).not.toBeInTheDocument();
  });

  describe("guest flow", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({ user: null, isLoading: false });
    });

    it("guest with valid cookie joins immediately without requesting approval", async () => {
      mockGuestCheck.mockResolvedValue({ valid: true, displayName: "Bob" });

      renderRoomPage();

      await waitFor(() => {
        expect(mockGuestCheck).toHaveBeenCalledWith("alpha");
      });
      // Wait until the pre-approval commits to the UI (the input shows the
      // server-provided name), otherwise the click races the check and takes
      // the request path.
      await waitFor(() => {
        expect(screen.getByDisplayValue("Bob")).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
      });

      await waitFor(
        () => {
          expect(screen.getByTestId("room-view")).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      expect(mockGuestRequest).not.toHaveBeenCalled();
    });

    it("guest without cookie sends request and waits for approval", async () => {
      mockGuestCheck.mockResolvedValue({ valid: false });
      mockGuestRequest.mockResolvedValue({ requestId: "req-123" });
      mockGuestStatus.mockResolvedValue({ status: "pending" });

      renderRoomPage();

      await waitFor(() => {
        expect(mockGuestCheck).toHaveBeenCalledWith("alpha");
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
      });

      await waitFor(() => {
        expect(mockGuestRequest).toHaveBeenCalledWith("alpha", "Guest");
        expect(screen.getByText("Waiting for room owner to approve...")).toBeInTheDocument();
      });
    });

    it("guest transitions to active room after approval", async () => {
      mockGuestCheck.mockResolvedValue({ valid: false });
      mockGuestRequest.mockResolvedValue({ requestId: "req-123" });
      mockGuestStatus.mockResolvedValue({ status: "approved" });

      vi.spyOn(global, "setInterval").mockImplementation((cb) => {
        setTimeout(() => (cb as () => void)(), 0);
        return 1 as unknown as ReturnType<typeof setInterval>;
      });

      renderRoomPage();

      await waitFor(() => expect(mockGuestCheck).toHaveBeenCalled());

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
      });

      await waitFor(
        () => {
          expect(screen.getByTestId("room-view")).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      vi.restoreAllMocks();
    });

    it("guest sees denied state when request is denied", async () => {
      mockGuestCheck.mockResolvedValue({ valid: false });
      mockGuestRequest.mockResolvedValue({ requestId: "req-123" });
      mockGuestStatus.mockResolvedValue({ status: "denied" });

      vi.spyOn(global, "setInterval").mockImplementation((cb) => {
        setTimeout(() => (cb as () => void)(), 0);
        return 1 as unknown as ReturnType<typeof setInterval>;
      });

      renderRoomPage();

      await waitFor(() => expect(mockGuestCheck).toHaveBeenCalled());

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
      });

      await waitFor(() => {
        expect(screen.getByText("Your request to join was denied.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
      });

      vi.restoreAllMocks();
    });

    it("guest can retry after denied", async () => {
      mockGuestCheck.mockResolvedValue({ valid: false });
      mockGuestRequest.mockResolvedValue({ requestId: "req-123" });
      mockGuestStatus.mockResolvedValue({ status: "denied" });

      vi.spyOn(global, "setInterval").mockImplementation((cb) => {
        setTimeout(() => (cb as () => void)(), 0);
        return 1 as unknown as ReturnType<typeof setInterval>;
      });

      renderRoomPage();

      await waitFor(() => expect(mockGuestCheck).toHaveBeenCalled());

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
      });

      expect(screen.getByRole("button", { name: "Join Room" })).toBeInTheDocument();

      vi.restoreAllMocks();
    });
  });

  describe("keyboard shortcuts", () => {
    it("toggles audio and video via m/v after joining", async () => {
      renderRoomPage();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Join Room" }));
      });

      await act(async () => {
        fireEvent.keyDown(window, { key: "m" });
      });
      await act(async () => {
        fireEvent.keyDown(window, { key: "v" });
      });

      expect(mockToggleAudio).toHaveBeenCalledTimes(1);
      expect(mockToggleVideo).toHaveBeenCalledTimes(1);
    });
  });
});
