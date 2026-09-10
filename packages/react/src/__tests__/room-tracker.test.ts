import { describe, expect, it, vi } from "vitest";

import { RoomTracker } from "../room-tracker.js";

type Listener = (...args: unknown[]) => void;

function createManager(parts: { socket: Record<string, unknown> | null }) {
  const noopUnsubscribe = () => () => {};
  const stateListeners = new Set<Listener>();
  const socketListeners = new Map<string, Set<Listener>>();
  const socket = {
    on: vi.fn((event: string, callback: Listener) => {
      if (!socketListeners.has(event)) {
        socketListeners.set(event, new Set());
      }
      socketListeners.get(event)?.add(callback);
    }),
    off: vi.fn(),
  };
  return {
    manager: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      leaveRoom: vi.fn(),
      kickPeer: vi.fn(),
      joinRoom: vi.fn(),
      produce: vi.fn(),
      produceScreen: vi.fn(),
      closeScreenProducer: vi.fn(),
      isScreenShareBlocked: vi.fn(() => false),
      onProduceError: vi.fn(() => () => {}),
      pauseProducer: vi.fn(),
      resumeProducer: vi.fn(),
      replaceTrack: vi.fn(),
      getProducerByKind: vi.fn(),
      getSocket: vi.fn(() => parts.socket),
      getState: vi.fn(() => ({ connectionState: "connecting" })),
      onStateChange: vi.fn((callback: Listener) => {
        stateListeners.add(callback);
        return () => stateListeners.delete(callback);
      }),
      onTrack: vi.fn(() => noopUnsubscribe),
      onParticipantJoined: vi.fn(() => noopUnsubscribe),
      onParticipantLeft: vi.fn(() => noopUnsubscribe),
      onKicked: vi.fn(() => noopUnsubscribe),
      onProducerStateChange: vi.fn(() => noopUnsubscribe),
      onScreenShareStopped: vi.fn(() => noopUnsubscribe),
    },
    emitState(state: unknown) {
      stateListeners.forEach((listener) => listener(state));
    },
    emitSocketEvent(event: string, payload: unknown) {
      socketListeners.get(event)?.forEach((listener) => listener(payload));
    },
    socket,
  };
}

describe("RoomTracker", () => {
  it("binds socket listeners once the manager connects", () => {
    const harness = createManager({ socket: null });
    const tracker = new RoomTracker(harness.manager as never, { localUserId: "u1" });

    // No socket yet: emitting on the (future) socket must be impossible, and
    // the tracker starts with defaults.
    expect(tracker.getSnapshot()).toEqual({
      participants: [],
      locked: false,
      mutedByHost: false,
    });

    // The socket appears and the manager reports connected.
    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });

    harness.emitSocketEvent("sfu:room-locked", { locked: true });
    harness.emitSocketEvent("sfu:peer-muted", { userId: "u1" });

    const snapshot = tracker.getSnapshot();
    expect(snapshot.locked).toBe(true);
    expect(snapshot.mutedByHost).toBe(true);

    tracker.stop();
  });

  it("ignores a duplicate bind after connected", () => {
    const harness = createManager({ socket: null });
    const tracker = new RoomTracker(harness.manager as never);

    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });
    harness.emitState({ connectionState: "connected" });
    harness.emitState({ connectionState: "connected" });

    expect(harness.socket.on).toHaveBeenCalledTimes(2);

    tracker.stop();
  });
});
