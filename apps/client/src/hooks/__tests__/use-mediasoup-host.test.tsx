import { act, renderHook } from "@testing-library/react";
import { SfuHostActionError } from "@zvonok/client/sfu/types";
import { ZvonokHostError } from "@zvonok/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

vi.stubGlobal("MediaStream", MockMediaStream);

const mockUseAuth = vi.hoisted(() => vi.fn());

const sfuMock = vi.hoisted(() => {
  const socketListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (!socketListeners.has(event)) {
        socketListeners.set(event, new Set());
      }
      socketListeners.get(event)?.add(callback);
    }),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      socketListeners.get(event)?.delete(callback);
    }),
    emit: vi.fn(),
  };
  const noopUnsubscribe = () => () => {};
  const manager = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    leaveRoom: vi.fn(),
    kickPeer: vi.fn().mockResolvedValue(undefined),
    mutePeer: vi.fn().mockResolvedValue(undefined),
    muteAll: vi.fn().mockResolvedValue(undefined),
    lockRoom: vi.fn().mockResolvedValue(undefined),
    joinRoom: vi.fn().mockResolvedValue(undefined),
    produce: vi.fn().mockResolvedValue({ id: "p", kind: "audio" }),
    produceScreen: vi.fn(),
    closeScreenProducer: vi.fn(),
    isScreenShareBlocked: vi.fn(() => false),
    onProduceError: vi.fn(() => () => {}),
    onJoinError: vi.fn(() => () => {}),
    pauseProducer: vi.fn(),
    resumeProducer: vi.fn(),
    replaceTrack: vi.fn().mockResolvedValue(true),
    getProducerByKind: vi.fn(),
    getSocket: vi.fn(() => socket),
    getState: vi.fn(() => ({
      connectionState: "connected",
      isSendTransportCreated: false,
    })),
    onStateChange: vi.fn(() => noopUnsubscribe),
    onTrack: vi.fn(() => noopUnsubscribe),
    onParticipantJoined: vi.fn(() => noopUnsubscribe),
    onParticipantLeft: vi.fn(() => noopUnsubscribe),
    onKicked: vi.fn(() => noopUnsubscribe),
    onProducerStateChange: vi.fn(() => noopUnsubscribe),
    onScreenShareStopped: vi.fn(() => noopUnsubscribe),
    emitSocketEvent(event: string, payload: unknown) {
      socketListeners.get(event)?.forEach((callback) => callback(payload));
    },
  };
  return { manager, socket };
});

vi.mock("@/features/auth/contexts/auth.context", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("@/features/sfu/contexts/sfu-manager.context", () => ({
  useSfuManager: () => sfuMock.manager,
}));

vi.mock("./use-is-mobile", () => ({
  useIsMobile: () => false,
}));

import { useMediasoup } from "../use-mediasoup";

describe("useMediasoup host features", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1", username: "alice" } });
  });

  const renderMediasoup = () =>
    renderHook(() =>
      useMediasoup({
        roomId: "room-1",
        localVideoStream: null,
        localAudioStream: null,
        enabled: true,
        displayName: "alice",
      }),
    );

  it("tracks the room lock from sfu:room-locked events", () => {
    const { result } = renderMediasoup();

    expect(result.current.isRoomLocked).toBe(false);

    act(() => {
      sfuMock.manager.emitSocketEvent("sfu:room-locked", { locked: true });
    });
    expect(result.current.isRoomLocked).toBe(true);

    act(() => {
      sfuMock.manager.emitSocketEvent("sfu:room-locked", { locked: false });
    });
    expect(result.current.isRoomLocked).toBe(false);
  });

  it("flags mutedByHost only when the local user is muted", () => {
    const { result } = renderMediasoup();

    act(() => {
      sfuMock.manager.emitSocketEvent("sfu:peer-muted", { userId: "user-2" });
    });
    expect(result.current.mutedByHost).toBe(false);

    act(() => {
      sfuMock.manager.emitSocketEvent("sfu:peer-muted", { userId: "user-1" });
    });
    expect(result.current.mutedByHost).toBe(true);
  });

  it("marks the remote participant as muted by host", () => {
    const { result } = renderMediasoup();

    act(() => {
      sfuMock.manager.emitSocketEvent("sfu:peer-muted", { userId: "user-2" });
    });

    const peer = result.current.remotePeers.find((p) => p.userId === "user-2");
    expect(peer?.mutedByHost).toBe(true);
    expect(result.current.mutedByHost).toBe(false);
  });

  it("delegates mute-peer to the manager and rejects with the server denial", async () => {
    const { result } = renderMediasoup();

    sfuMock.manager.mutePeer.mockRejectedValueOnce(
      new SfuHostActionError("MISSING_CAPABILITY", "Missing mute-users capability"),
    );

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.hostControls.mutePeer("user-2");
      } catch (error) {
        caught = error;
      }
    });

    expect(sfuMock.manager.mutePeer).toHaveBeenCalledWith("user-2");
    expect(caught).toBeInstanceOf(ZvonokHostError);
    expect((caught as ZvonokHostError).code).toBe("MISSING_CAPABILITY");
  });

  it("resolves lock-room on the server acknowledgement", async () => {
    const { result } = renderMediasoup();

    await act(async () => {
      await result.current.hostControls.lockRoom(true);
    });

    expect(sfuMock.manager.lockRoom).toHaveBeenCalledWith(true);
  });
});
