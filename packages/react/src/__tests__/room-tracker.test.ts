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
      getLocalUserId: vi.fn(() => null),
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
      onPeerMediaDetached: vi.fn(() => noopUnsubscribe),
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

  it("marks the local user muted via the manager identity, not the caller hint", () => {
    const harness = createManager({ socket: null });
    // Mimics the guest flow: the app passes a client-generated id that can
    // never match the server-issued identity in the event payload.
    (harness.manager.getLocalUserId as ReturnType<typeof vi.fn>).mockReturnValue("guest-server-1");
    const tracker = new RoomTracker(harness.manager as never, {
      localUserId: "guest-client-1",
    });

    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });
    harness.emitSocketEvent("sfu:peer-muted", { userId: "guest-server-1" });

    const snapshot = tracker.getSnapshot();
    expect(snapshot.mutedByHost).toBe(true);
    // No phantom participant for the local user's own id.
    expect(snapshot.participants).toEqual([]);

    tracker.stop();
  });

  it("does not upsert a phantom participant for an unknown muted user", () => {
    const harness = createManager({ socket: null });
    const tracker = new RoomTracker(harness.manager as never, { localUserId: "u1" });

    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });
    harness.emitSocketEvent("sfu:peer-muted", { userId: "never-seen-peer" });

    const snapshot = tracker.getSnapshot();
    expect(snapshot.participants).toEqual([]);
    expect(snapshot.mutedByHost).toBe(false);

    tracker.stop();
  });

  it("still flags an existing remote participant as muted by host", () => {
    const harness = createManager({ socket: null });
    const tracker = new RoomTracker(harness.manager as never, { localUserId: "u1" });

    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });
    const joined = (
      harness.manager.onParticipantJoined as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as (peer: unknown) => void;
    joined({ userId: "peer-2", username: "Peer" });
    harness.emitSocketEvent("sfu:peer-muted", { userId: "peer-2" });
    const snapshot = tracker.getSnapshot();
    expect(snapshot.participants).toHaveLength(1);
    expect(snapshot.participants[0]).toMatchObject({
      userId: "peer-2",
      mutedByHost: true,
      // The server paused the peer's producers; their media has stopped.
      isAudioEnabled: false,
      isCameraEnabled: false,
    });

    tracker.stop();
  });

  it("flags a participant disconnected on media detach and restores on join", () => {
    const harness = createManager({ socket: null });
    const tracker = new RoomTracker(harness.manager as never, { localUserId: "u1" });

    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });
    const joined = (
      harness.manager.onParticipantJoined as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as (peer: unknown) => void;
    const detached = (
      harness.manager.onPeerMediaDetached as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as (payload: unknown) => void;

    joined({ userId: "peer-2", username: "Peer" });
    detached({ userId: "peer-2" });
    expect(tracker.getSnapshot().participants[0]).toMatchObject({
      userId: "peer-2",
      isConnected: false,
    });

    // Silent rejoin restore: the peer's membership is announced again.
    joined({ userId: "peer-2", username: "Peer" });
    expect(tracker.getSnapshot().participants[0]).toMatchObject({
      isConnected: true,
    });

    tracker.stop();
  });

  it("does not fabricate a participant for an unknown detached user", () => {
    const harness = createManager({ socket: null });
    const tracker = new RoomTracker(harness.manager as never, { localUserId: "u1" });

    (harness.manager.getSocket as ReturnType<typeof vi.fn>).mockReturnValue(harness.socket);
    harness.emitState({ connectionState: "connected" });
    const detached = (
      harness.manager.onPeerMediaDetached as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as (payload: unknown) => void;
    detached({ userId: "never-seen-peer" });

    expect(tracker.getSnapshot().participants).toEqual([]);

    tracker.stop();
  });
});
