import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SfuEventHandlers } from "../event-router";
import { SfuEventRouter } from "../event-router";

describe("SfuEventRouter", () => {
  let handlers: SfuEventHandlers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let socket: any;
  let getSocket: () => typeof socket | null;
  let router: SfuEventRouter;

  beforeEach(() => {
    handlers = {
      onConnected: vi.fn(),
      onBroadcast: vi.fn(),
      onDisconnected: vi.fn(),
      onJoined: vi.fn().mockResolvedValue(undefined),
      onTransportCreated: vi.fn().mockResolvedValue(undefined),
      onTransportConnected: vi.fn(),
      onKicked: vi.fn(),
      onProducerCreated: vi.fn(),
      onProduceError: vi.fn(),
      onParticipantJoined: vi.fn(),
      onExistingParticipants: vi.fn(),
      onNewProducer: vi.fn(),
      onConsumerCreated: vi.fn().mockResolvedValue(undefined),
      onConsumerClosed: vi.fn(),
      onProducerStateChanged: vi.fn(),
      onParticipantLeft: vi.fn(),
      onPeerMediaDetached: vi.fn(),
      onRoomEnded: vi.fn(),
      onRoomMediaReset: vi.fn().mockResolvedValue(undefined),
      onJoinError: vi.fn(),
      onReconnectFailed: vi.fn(),
      onScreenShareStarted: vi.fn(),
      onScreenShareStopped: vi.fn(),
      onEgressStatus: vi.fn(),
      onGuestJoinRequest: vi.fn(),
    };

    socket = {
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    getSocket = () => socket;
    router = new SfuEventRouter(getSocket, handlers);
  });

  it("does nothing if socket is null on setup", () => {
    getSocket = () => null;
    router = new SfuEventRouter(getSocket, handlers);
    router.setup();
    expect(socket.on).not.toHaveBeenCalled();
  });

  it("registers all event listeners on setup", () => {
    router.setup();

    const events = socket.on.mock.calls.map((call: [string, ...unknown[]]) => call[0]);
    expect(events).toContain("connect");
    expect(events).toContain("disconnect");
    expect(events).toContain("sfu:joined");
    expect(events).toContain("sfu:transport-created");
    expect(events).toContain("sfu:transport-connected");
    expect(events).toContain("sfu:producer-created");
    expect(events).toContain("sfu:peer-joined");
    expect(events).toContain("sfu:existing-peers");
    expect(events).toContain("sfu:new-producer");
    expect(events).toContain("sfu:consumer-created");
    expect(events).toContain("sfu:consumer-closed");
    expect(events).toContain("sfu:peer-left");
    expect(events).toContain("sfu:peer-media-detached");
    expect(events).toContain("sfu:producer-state-changed");
    expect(events).toContain("sfu:kicked");
    expect(events).toContain("sfu:room-ended");
    expect(events).toContain("reconnect_failed");
    expect(events).toContain("sfu:produce-error");
    expect(events).toContain("sfu:room-media-reset");
    expect(events).toContain("sfu:screen-share-stopped");
    expect(events).toContain("sfu:guest-join-request");
    expect(events).toContain("sfu:join-error");
    expect(events).toContain("egress:status");
    expect(events).toHaveLength(25);
  });

  it("routes connect event to onConnected", () => {
    router.setup();
    const connectHandler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "connect",
    )?.[1] as () => void;
    connectHandler();
    expect(handlers.onConnected).toHaveBeenCalled();
  });

  it("routes disconnect event to onDisconnected", () => {
    router.setup();
    const disconnectHandler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "disconnect",
    )?.[1] as () => void;
    disconnectHandler();
    expect(handlers.onDisconnected).toHaveBeenCalled();
  });

  it("routes sfu:joined event to onJoined with payload", () => {
    router.setup();
    const payload = { routerRtpCapabilities: { codecs: [] } };
    const handler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "sfu:joined",
    )?.[1] as (p: unknown) => void;
    handler(payload);
    expect(handlers.onJoined).toHaveBeenCalledWith(payload);
  });

  it("routes sfu:room-media-reset event to onRoomMediaReset", () => {
    router.setup();
    const payload = { roomId: "room-1", routerRtpCapabilities: { codecs: [] } };
    const handler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "sfu:room-media-reset",
    )?.[1] as (p: unknown) => void;
    handler(payload);
    expect(handlers.onRoomMediaReset).toHaveBeenCalledWith(payload);
  });

  it("routes sfu:peer-left event to onParticipantLeft", () => {
    router.setup();
    const handler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "sfu:peer-left",
    )?.[1] as (p: unknown) => void;
    handler({ userId: "user-1" });
    expect(handlers.onParticipantLeft).toHaveBeenCalledWith({
      userId: "user-1",
    });
  });

  it("does nothing on teardown if socket is null", () => {
    getSocket = () => null;
    router = new SfuEventRouter(getSocket, handlers);
    router.teardown();
    expect(socket.off).not.toHaveBeenCalled();
    expect(socket.removeAllListeners).not.toHaveBeenCalled();
  });

  it("routes sfu:broadcast to onBroadcast with payload", () => {
    router.setup();

    const handler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "sfu:broadcast",
    )?.[1] as (p: unknown) => void;
    handler({ senderId: "u2", topic: "t", payload: 1, timestamp: "now" });

    expect(handlers.onBroadcast).toHaveBeenCalledWith({
      senderId: "u2",
      topic: "t",
      payload: 1,
      timestamp: "now",
    });
  });

  it("routes reconnect_failed event to onReconnectFailed", () => {
    router.setup();
    const handler = socket.on.mock.calls.find(
      (call: [string, ...unknown[]]) => call[0] === "reconnect_failed",
    )?.[1] as () => void;
    handler();
    expect(handlers.onReconnectFailed).toHaveBeenCalled();
  });

  it("removes only registered listeners on teardown without touching other listeners", () => {
    router.setup();

    const registeredEvents = socket.on.mock.calls.map((call: [string, ...unknown[]]) => call[0]);
    router.teardown();

    // off() called once per registered listener
    expect(socket.off).toHaveBeenCalledTimes(registeredEvents.length);
    // removeAllListeners never called
    expect(socket.removeAllListeners).not.toHaveBeenCalled();

    // Each off() call matches a registered event+handler pair
    const offEvents = socket.off.mock.calls.map((call: [string, ...unknown[]]) => call[0]);
    expect(offEvents.sort()).toEqual(registeredEvents.sort());
  });

  it("clears registered listeners so a second teardown is a no-op", () => {
    router.setup();
    router.teardown();
    socket.off.mockClear();

    router.teardown();
    expect(socket.off).not.toHaveBeenCalled();
  });
});
