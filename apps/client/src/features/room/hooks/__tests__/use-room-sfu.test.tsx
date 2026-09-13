import { act, renderHook, waitFor } from "@testing-library/react";
import { CaptureState } from "@zvonok/client/media/capture-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRoomSfu } from "../use-room-sfu";

vi.mock("@/features/auth/contexts/auth.context", () => ({
  useAuth: () => ({ user: undefined }),
}));

const mediaManager = createMediaManager();

vi.mock("@zvonok/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zvonok/react")>();
  return {
    ...actual,
    useZvonokSession: () => ({ mediaManager }),
    createHostControls: () => ({
      mutePeer: vi.fn(),
      muteAll: vi.fn(),
      lockRoom: vi.fn(),
      kickPeer: vi.fn(),
    }),
  };
});

function createLiveTrack(id: string): MediaStreamTrack {
  return {
    kind: "audio",
    id,
    enabled: true,
    readyState: "live",
  } as unknown as MediaStreamTrack;
}

function createStreamWithTrack(track: MediaStreamTrack): MediaStream {
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
}

function createMediaManager() {
  return {
    videoCapture: {
      getState: () => CaptureState.ACTIVE,
      onStateChange: () => () => {},
    },
    audioCapture: {
      getState: () => CaptureState.STOPPED,
      onStateChange: () => () => {},
    },
  };
}

function createManagerDouble() {
  const noopUnsubscribe = () => () => {};
  const socket = { on: vi.fn(), off: vi.fn() };
  return {
    getSocket: vi.fn(() => socket),
    getState: vi.fn(() => ({ connectionState: "connected", capabilities: [] })),
    onStateChange: vi.fn(() => noopUnsubscribe),
    onTrack: vi.fn(() => noopUnsubscribe),
    onParticipantJoined: vi.fn(() => noopUnsubscribe),
    onParticipantLeft: vi.fn(() => noopUnsubscribe),
    onKicked: vi.fn(() => noopUnsubscribe),
    onProducerStateChange: vi.fn(() => noopUnsubscribe),
    onScreenShareStopped: vi.fn(() => noopUnsubscribe),
    onPeerMediaDetached: vi.fn(() => noopUnsubscribe),
    getLocalUserId: vi.fn(() => null),
  };
}

function createConnection(overrides: Record<string, unknown> = {}) {
  return {
    status: "joined",
    wasKicked: false,
    isRoomLocked: false,
    roomEnded: false,
    hasProducer: vi.fn(() => false),
    produceTrack: vi.fn(async () => true),
    resumeProducer: vi.fn(),
    pauseProducer: vi.fn(),
    replaceTrack: vi.fn(async () => true),
    manager: createManagerDouble(),
    ...overrides,
  };
}

function renderUseRoomSfu(options: {
  connection?: ReturnType<typeof createConnection>;
  localAudioStream?: MediaStream | null;
  ensureAudio?: () => Promise<MediaStream | null>;
}) {
  return renderHook(() =>
    useRoomSfu({
      localVideoStream: null,
      localAudioStream: options.localAudioStream ?? null,
      onKicked: vi.fn(),
      connection: (options.connection ?? createConnection()) as never,
      ensureAudio: options.ensureAudio ?? vi.fn(async () => null),
      ensureVideo: vi.fn(async () => null),
    }),
  );
}

describe("useRoomSfu toggleAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-acquires capture and produces when the lobby left the mic off", async () => {
    const track = createLiveTrack("mic-after-reacquire");
    const ensureAudio = vi.fn(async () => createStreamWithTrack(track));
    const connection = createConnection();
    const { result } = renderUseRoomSfu({ connection, ensureAudio });

    await act(async () => {
      await result.current.toggleAudio();
    });

    expect(ensureAudio).toHaveBeenCalledTimes(1);
    expect(connection.produceTrack).toHaveBeenCalledWith(track, expect.anything());
    expect(connection.resumeProducer).toHaveBeenCalledWith("audio");
    await waitFor(() => expect(result.current.mediaControls.isAudioEnabled).toBe(true));
  });

  it("stays muted and skips producing when re-acquiring the mic fails", async () => {
    const ensureAudio = vi.fn(async () => null);
    const connection = createConnection();
    const { result } = renderUseRoomSfu({ connection, ensureAudio });

    await act(async () => {
      await result.current.toggleAudio();
    });

    expect(connection.produceTrack).not.toHaveBeenCalled();
    expect(connection.resumeProducer).not.toHaveBeenCalled();
    expect(result.current.mediaControls.isAudioEnabled).toBe(false);
  });

  it("replaces the paused producer track when capture is still live", async () => {
    const track = createLiveTrack("mic-live");
    const localAudioStream = createStreamWithTrack(track);
    const connection = createConnection({
      hasProducer: vi.fn(() => true),
    });
    const ensureAudio = vi.fn(async () => null);
    const { result } = renderUseRoomSfu({ connection, localAudioStream, ensureAudio });

    await act(async () => {
      await result.current.toggleAudio();
    });

    expect(ensureAudio).not.toHaveBeenCalled();
    expect(connection.replaceTrack).toHaveBeenCalledWith("audio", track);
    expect(connection.resumeProducer).toHaveBeenCalledWith("audio");
  });
});
