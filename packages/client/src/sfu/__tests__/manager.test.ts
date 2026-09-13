import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testContext = vi.hoisted(() => {
  type EventHandler = (...args: unknown[]) => unknown;

  const socketHandlers = new Map<string, Set<EventHandler>>();
  const sendTransportHandlers = new Map<string, EventHandler>();
  const recvTransportHandlers = new Map<string, EventHandler>();

  const mockProducer = {
    id: "producer-1",
    kind: "video" as const,
    track: undefined as unknown as MediaStreamTrack,
    on: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    replaceTrack: vi.fn().mockResolvedValue(undefined),
  };

  const mockConsumerTrack = {
    id: "track-1",
    kind: "video" as const,
  } as MediaStreamTrack;

  const mockConsumer = {
    id: "consumer-1",
    producerId: "producer-remote",
    kind: "video" as const,
    track: mockConsumerTrack,
    on: vi.fn(),
    close: vi.fn(),
  };

  const mockSendTransport = {
    id: "send-transport",
    on: vi.fn((event: string, handler: EventHandler) => {
      sendTransportHandlers.set(event, handler);
    }),
    produce: vi.fn().mockResolvedValue(mockProducer),
    close: vi.fn(),
  };

  const mockRecvTransport = {
    id: "recv-transport",
    on: vi.fn((event: string, handler: EventHandler) => {
      recvTransportHandlers.set(event, handler);
    }),
    consume: vi.fn().mockResolvedValue(mockConsumer),
    close: vi.fn(),
  };

  const mockDeviceLoad = vi.fn().mockResolvedValue(undefined);
  const mockCreateSendTransport = vi.fn(() => mockSendTransport);
  const mockCreateRecvTransport = vi.fn(() => mockRecvTransport);

  const latestDevice = {
    current: null as null | {
      load: typeof mockDeviceLoad;
      createSendTransport: typeof mockCreateSendTransport;
      createRecvTransport: typeof mockCreateRecvTransport;
      rtpCapabilities: { codecs: string[] };
    },
  };

  const mockSocket = {
    connected: false,
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!socketHandlers.has(event)) {
        socketHandlers.set(event, new Set());
      }
      socketHandlers.get(event)?.add(handler);
      return mockSocket;
    }),
    off: vi.fn((event: string, handler?: EventHandler) => {
      if (!handler) {
        socketHandlers.delete(event);
        return mockSocket;
      }

      socketHandlers.get(event)?.delete(handler);
      return mockSocket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => {
      socketHandlers.clear();
      return mockSocket;
    }),
  };

  const reset = () => {
    socketHandlers.clear();
    sendTransportHandlers.clear();
    recvTransportHandlers.clear();
    mockSocket.connected = false;
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.disconnect.mockClear();
    mockSocket.removeAllListeners.mockClear();
    mockProducer.on.mockClear();
    mockProducer.close.mockClear();
    mockProducer.pause.mockClear();
    mockProducer.resume.mockClear();
    mockProducer.replaceTrack.mockClear();
    mockProducer.track = undefined as unknown as MediaStreamTrack;
    mockConsumer.on.mockClear();
    mockConsumer.close.mockClear();
    mockSendTransport.on.mockClear();
    mockSendTransport.produce.mockClear();
    mockSendTransport.close.mockClear();
    mockRecvTransport.on.mockClear();
    mockRecvTransport.consume.mockClear();
    mockRecvTransport.close.mockClear();
    mockDeviceLoad.mockClear();
    mockCreateSendTransport.mockClear();
    mockCreateRecvTransport.mockClear();
    latestDevice.current = null;
  };

  const emitSocketEvent = async (event: string, payload?: unknown) => {
    const handlers = Array.from(socketHandlers.get(event) ?? []);
    await Promise.all(handlers.map((handler) => handler(payload)));
  };

  return {
    latestDevice,
    mockConsumer,
    mockConsumerTrack,
    mockCreateRecvTransport,
    mockCreateSendTransport,
    mockDeviceLoad,
    mockProducer,
    mockRecvTransport,
    mockSendTransport,
    mockSocket,
    emitSocketEvent,
    reset,
  };
});

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => testContext.mockSocket),
}));

vi.mock("mediasoup-client", () => ({
  Device: class MockDevice {
    load = testContext.mockDeviceLoad;
    createSendTransport = testContext.mockCreateSendTransport;
    createRecvTransport = testContext.mockCreateRecvTransport;
    rtpCapabilities = { codecs: ["vp8"] };
    recvRtpCapabilities = { codecs: ["vp8"] };

    constructor() {
      testContext.latestDevice.current = this;
    }
  },
}));

import { SfuManager } from "../manager";

const transportPayload = {
  transportId: "transport-1",
  iceParameters: { usernameFragment: "user", password: "pass" },
  iceCandidates: [],
  dtlsParameters: { fingerprints: [], role: "auto" as const },
};

describe("SfuManager", () => {
  let manager: SfuManager;

  beforeEach(() => {
    testContext.reset();
    manager = new SfuManager();
  });

  afterEach(() => {
    manager.disconnect();
  });

  it("loads the device and requests transports after joining the SFU room", async () => {
    const stateCallback = vi.fn();
    manager.onStateChange(stateCallback);

    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });

    await waitFor(() => {
      expect(testContext.mockDeviceLoad).toHaveBeenCalledWith({
        routerRtpCapabilities: { codecs: [] },
      });
    });

    expect(testContext.mockSocket.emit).toHaveBeenCalledWith(
      "sfu:create-send-transport",
    );
    expect(testContext.mockSocket.emit).toHaveBeenCalledWith(
      "sfu:create-recv-transport",
    );
    expect(stateCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionState: "connected",
      }),
    );
  });

  it("consumes a remote producer and notifies track subscribers", async () => {
    const onParticipantJoined = vi.fn();
    const onTrack = vi.fn();

    manager.onParticipantJoined(onParticipantJoined);
    manager.onTrack(onTrack);
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });
    await testContext.emitSocketEvent("sfu:transport-created", {
      ...transportPayload,
      direction: "recv",
      transportId: "recv-transport",
    });

    await testContext.emitSocketEvent("sfu:new-producer", {
      producerId: "producer-remote",
      userId: "user-2",
      username: "bob",
      kind: "video",
    });

    expect(onParticipantJoined).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        username: "bob",
      }),
    );
    expect(testContext.mockSocket.emit).toHaveBeenCalledWith("sfu:consume", {
      producerId: "producer-remote",
      rtpCapabilities: { codecs: ["vp8"] },
    });

    await testContext.emitSocketEvent("sfu:consumer-created", {
      consumerId: "consumer-1",
      producerId: "producer-remote",
      kind: "video",
      rtpParameters: { codecs: [] },
    });

    expect(testContext.mockRecvTransport.consume).toHaveBeenCalledWith({
      id: "consumer-1",
      producerId: "producer-remote",
      kind: "video",
      rtpParameters: { codecs: [] },
    });
    expect(testContext.mockSocket.emit).toHaveBeenCalledWith(
      "sfu:resume-consumer",
      {
        consumerId: "consumer-1",
      },
    );
    expect(onTrack).toHaveBeenCalledWith(
      testContext.mockConsumerTrack,
      "video",
      "user-2",
      undefined,
    );
  });

  it("marks a peer media-detached and restores it on rejoin", async () => {
    const onMediaDetached = vi.fn();
    manager.onPeerMediaDetached(onMediaDetached);
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });
    await testContext.emitSocketEvent("sfu:peer-joined", {
      userId: "user-2",
      username: "bob",
    });
    expect(manager.getParticipant("user-2")?.mediaConnected).toBeUndefined();

    await testContext.emitSocketEvent("sfu:peer-media-detached", {
      userId: "user-2",
    });
    expect(manager.getParticipant("user-2")?.mediaConnected).toBe(false);
    expect(onMediaDetached).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-2", mediaConnected: false }),
    );

    // A second detach while already detached must not re-notify.
    await testContext.emitSocketEvent("sfu:peer-media-detached", {
      userId: "user-2",
    });
    expect(onMediaDetached).toHaveBeenCalledTimes(1);

    // Silent rejoin restore: the same peer joins again.
    await testContext.emitSocketEvent("sfu:peer-joined", {
      userId: "user-2",
      username: "bob",
    });
    expect(manager.getParticipant("user-2")?.mediaConnected).toBe(true);
  });

  it("clears the detached flag when a detached peer's producer reappears", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });
    await testContext.emitSocketEvent("sfu:transport-created", {
      ...transportPayload,
      direction: "recv",
      transportId: "recv-transport",
    });
    await testContext.emitSocketEvent("sfu:peer-joined", {
      userId: "user-2",
      username: "bob",
    });
    await testContext.emitSocketEvent("sfu:peer-media-detached", {
      userId: "user-2",
    });
    expect(manager.getParticipant("user-2")?.mediaConnected).toBe(false);

    await testContext.emitSocketEvent("sfu:new-producer", {
      producerId: "producer-remote",
      userId: "user-2",
      username: "bob",
      kind: "video",
    });

    expect(manager.getParticipant("user-2")?.mediaConnected).toBe(true);
  });

  it("produces a local track and replaces it through the matching producer", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });
    await testContext.emitSocketEvent("sfu:transport-created", {
      ...transportPayload,
      direction: "send",
      transportId: "send-transport",
    });

    const originalTrack = { kind: "video" } as MediaStreamTrack;
    const nextTrack = { kind: "video" } as MediaStreamTrack;

    await manager.produce(originalTrack);
    const replaced = await manager.replaceTrack("video", nextTrack);

    expect(testContext.mockSendTransport.produce).toHaveBeenCalledWith(
      expect.objectContaining({ track: originalTrack }),
    );
    expect(replaced).toBe(true);
    expect(testContext.mockProducer.replaceTrack).toHaveBeenCalledWith({
      track: nextTrack,
    });
  });

  it("adapts video encodings to the capped mobile set under the mobile hint", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });
    await testContext.emitSocketEvent("sfu:transport-created", {
      ...transportPayload,
      direction: "send",
      transportId: "send-transport",
    });

    const track = { kind: "video", readyState: "live" } as MediaStreamTrack;
    await manager.produce(track, { isMobile: true });

    expect(testContext.mockSendTransport.produce).toHaveBeenCalledWith(
      expect.objectContaining({
        encodings: [
          expect.objectContaining({ rid: "low", maxFramerate: 15 }),
          expect.objectContaining({ rid: "mid", maxBitrate: 400_000, maxFramerate: 15 }),
          expect.objectContaining({ rid: "high", maxBitrate: 900_000, maxFramerate: 15 }),
        ],
      }),
    );
  });

  it("serializes concurrent replaceTrack calls per kind", async () => {
    manager.connect();
    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });
    await testContext.emitSocketEvent("sfu:transport-created", {
      ...transportPayload,
      direction: "send",
      transportId: "send-transport",
    });
    await manager.produce({ kind: "video" } as MediaStreamTrack);

    const { promise: firstSwap, resolve: releaseFirst } =
      Promise.withResolvers<void>();
    testContext.mockProducer.replaceTrack.mockImplementationOnce(
      () => firstSwap,
    );

    const firstTrack = { kind: "video" } as MediaStreamTrack;
    const secondTrack = { kind: "video" } as MediaStreamTrack;
    const first = manager.replaceTrack("video", firstTrack);
    const second = manager.replaceTrack("video", secondTrack);

    // One microtask: the first swap starts, the second is still queued
    // behind the pending firstSwap promise.
    await Promise.resolve();
    expect(testContext.mockProducer.replaceTrack).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(testContext.mockProducer.replaceTrack).toHaveBeenCalledTimes(2);
    expect(testContext.mockProducer.replaceTrack).toHaveBeenNthCalledWith(1, {
      track: firstTrack,
    });
    expect(testContext.mockProducer.replaceTrack).toHaveBeenNthCalledWith(2, {
      track: secondTrack,
    });
  });

  it("buffers a produce call that arrives before the send transport and flushes it once created", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });

    const earlyTrack = {
      kind: "video",
      readyState: "live",
    } as MediaStreamTrack;
    const producePromise = manager.produce(earlyTrack);

    // Device/transport creation is still in flight: nothing produced yet.
    expect(testContext.mockSendTransport.produce).not.toHaveBeenCalled();

    await testContext.emitSocketEvent("sfu:transport-created", {
      ...transportPayload,
      direction: "send",
      transportId: "send-transport",
    });

    const producer = await producePromise;
    expect(producer).toBe(testContext.mockProducer);
    expect(testContext.mockSendTransport.produce).toHaveBeenCalledWith(
      expect.objectContaining({ track: earlyTrack }),
    );
  });

  it("rejects buffered produce calls when the session is torn down", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");
    await testContext.emitSocketEvent("sfu:joined", {
      routerRtpCapabilities: { codecs: [] },
    });

    const producePromise = manager.produce({
      kind: "audio",
      readyState: "live",
    } as MediaStreamTrack);
    manager.disconnect();

    await expect(producePromise).rejects.toThrow("Transport closed");
  });

  it("derives the join roomId from the token's sub claim, not from the slug-named field", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");

    const token = `header.${btoa(JSON.stringify({ sub: "room-id-123" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.sig`;
    await manager.joinRoom({
      roomId: "i-was-slug",
      roomSlug: "i-was-slug",
      token,
    });

    expect(testContext.mockSocket.emit).toHaveBeenCalledWith(
      "sfu:join",
      expect.objectContaining({
        roomId: "room-id-123",
        roomSlug: "i-was-slug",
      }),
    );
  });

  it("keeps the caller's roomId when the token carries no readable sub", async () => {
    manager.connect();

    testContext.mockSocket.connected = true;
    await testContext.emitSocketEvent("connect");

    await manager.joinRoom({
      roomId: "room-from-caller",
      token: "not-a-jwt",
    });

    expect(testContext.mockSocket.emit).toHaveBeenCalledWith(
      "sfu:join",
      expect.objectContaining({ roomId: "room-from-caller" }),
    );
  });

  describe("handleDisconnected", () => {
    it("transitions connectionState to 'connecting' (not 'disconnected') on socket disconnect", async () => {
      const stateCallback = vi.fn();
      manager.onStateChange(stateCallback);
      manager.connect();

      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");

      stateCallback.mockClear();
      testContext.mockSocket.connected = false;
      await testContext.emitSocketEvent("disconnect");

      expect(stateCallback).toHaveBeenCalledWith(
        expect.objectContaining({ connectionState: "connecting" }),
      );
      expect(stateCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ connectionState: "disconnected" }),
      );
    });

    it("sets connectionState to 'failed' when reconnect_failed fires", async () => {
      const stateCallback = vi.fn();
      manager.onStateChange(stateCallback);
      manager.connect();

      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");

      stateCallback.mockClear();
      await testContext.emitSocketEvent("reconnect_failed");

      expect(stateCallback).toHaveBeenCalledWith(
        expect.objectContaining({ connectionState: "failed" }),
      );
    });
  });

  it("connect() is a no-op while already in connecting state", async () => {
    manager.connect();
    const onCallCount = testContext.mockSocket.on.mock.calls.length;

    // Call connect() again while still in connecting state (not yet connected)
    manager.connect();

    // No additional listeners should have been registered
    expect(testContext.mockSocket.on.mock.calls.length).toBe(onCallCount);
  });

  describe("screen share blocked state for late joiners", () => {
    it("sets isScreenShareBlocked when sfu:new-producer arrives with source=screen from another peer", async () => {
      const stateCallback = vi.fn();
      manager.onStateChange(stateCallback);
      manager.connect();

      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
      });
      await testContext.emitSocketEvent("sfu:transport-created", {
        ...transportPayload,
        direction: "recv",
        transportId: "recv-transport",
      });

      // Simulate joining while someone is already sharing — server replays producers.
      stateCallback.mockClear();
      await testContext.emitSocketEvent("sfu:new-producer", {
        producerId: "screen-producer-remote",
        userId: "user-2",
        username: "bob",
        kind: "video",
        paused: false,
        appData: { source: "screen" },
      });

      expect(stateCallback).toHaveBeenCalledWith(
        expect.objectContaining({ isScreenShareBlocked: true }),
      );
    });

    it("does not set isScreenShareBlocked when sfu:new-producer with source=screen is from local user", async () => {
      const stateCallback = vi.fn();

      manager.connect();
      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
        participant: { id: "user-1", username: "alice" },
      });

      // The manager knows the local user id from the server-verified join.

      await testContext.emitSocketEvent("sfu:transport-created", {
        ...transportPayload,
        direction: "recv",
        transportId: "recv-transport",
      });

      manager.onStateChange(stateCallback);
      stateCallback.mockClear();

      // A screen producer from the local user should NOT set blocked.
      await testContext.emitSocketEvent("sfu:new-producer", {
        producerId: "screen-producer-local",
        userId: "user-1",
        username: "alice",
        kind: "video",
        paused: false,
        appData: { source: "screen" },
      });

      expect(stateCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ isScreenShareBlocked: true }),
      );
    });

    it("does not set isScreenShareBlocked when sfu:new-producer is a camera producer", async () => {
      const stateCallback = vi.fn();
      manager.onStateChange(stateCallback);
      manager.connect();

      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
      });
      await testContext.emitSocketEvent("sfu:transport-created", {
        ...transportPayload,
        direction: "recv",
        transportId: "recv-transport",
      });

      stateCallback.mockClear();
      await testContext.emitSocketEvent("sfu:new-producer", {
        producerId: "camera-producer-remote",
        userId: "user-2",
        username: "bob",
        kind: "video",
        paused: false,
        appData: { source: "camera" },
      });

      expect(stateCallback).not.toHaveBeenCalledWith(
        expect.objectContaining({ isScreenShareBlocked: true }),
      );
    });
  });

  describe("getVideoConsumerIdForUserId", () => {
    async function setupWithRecvTransport() {
      manager.connect();
      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
      });
      await testContext.emitSocketEvent("sfu:transport-created", {
        ...transportPayload,
        direction: "recv",
        transportId: "recv-transport",
      });
    }

    it("returns the camera consumer id and skips screen consumer", async () => {
      await setupWithRecvTransport();

      // Register camera producer for user-2.
      await testContext.emitSocketEvent("sfu:new-producer", {
        producerId: "cam-producer",
        userId: "user-2",
        username: "bob",
        kind: "video",
        paused: false,
        appData: { source: "camera" },
      });

      // Camera consumer created.
      testContext.mockConsumer.producerId = "cam-producer";
      testContext.mockConsumer.id = "cam-consumer";
      await testContext.emitSocketEvent("sfu:consumer-created", {
        consumerId: "cam-consumer",
        producerId: "cam-producer",
        kind: "video",
        rtpParameters: { codecs: [] },
      });

      // Register screen producer for user-2 (second video consumer).
      const screenConsumer = {
        ...testContext.mockConsumer,
        id: "screen-consumer",
        producerId: "screen-producer",
      };
      testContext.mockRecvTransport.consume.mockResolvedValueOnce(
        screenConsumer,
      );

      await testContext.emitSocketEvent("sfu:new-producer", {
        producerId: "screen-producer",
        userId: "user-2",
        username: "bob",
        kind: "video",
        paused: false,
        appData: { source: "screen" },
      });
      await testContext.emitSocketEvent("sfu:consumer-created", {
        consumerId: "screen-consumer",
        producerId: "screen-producer",
        kind: "video",
        rtpParameters: { codecs: [] },
      });

      // Should return camera consumer, not screen consumer.
      const consumerId = manager.getVideoConsumerIdForUserId("user-2");
      expect(consumerId).toBe("cam-consumer");
    });

    it("returns undefined when the only video consumer is a screen consumer", async () => {
      await setupWithRecvTransport();

      await testContext.emitSocketEvent("sfu:new-producer", {
        producerId: "screen-only-producer",
        userId: "user-2",
        username: "bob",
        kind: "video",
        paused: false,
        appData: { source: "screen" },
      });
      await testContext.emitSocketEvent("sfu:consumer-created", {
        consumerId: "screen-only-consumer",
        producerId: "screen-only-producer",
        kind: "video",
        rtpParameters: { codecs: [] },
      });

      expect(manager.getVideoConsumerIdForUserId("user-2")).toBeUndefined();
    });

    it("returns undefined when no video consumer exists for the peer", async () => {
      await setupWithRecvTransport();

      expect(
        manager.getVideoConsumerIdForUserId("user-unknown"),
      ).toBeUndefined();
    });
  });

  describe("egress state and actions", () => {
    it("mirrors egress:status broadcasts into state", async () => {
      manager.connect();

      await testContext.emitSocketEvent("egress:status", {
        sessionId: "egress-1",
        outputs: { record: true, hls: false },
        status: "starting",
      });
      expect(manager.getState().egress).toEqual({
        sessionId: "egress-1",
        outputs: { record: true, hls: false },
        status: "starting",
      });

      await testContext.emitSocketEvent("egress:status", {
        sessionId: "egress-1",
        outputs: { record: true, hls: false },
        status: "live",
      });
      expect(manager.getState().egress?.status).toBe("live");
    });

    it("resolves startEgress on the server acknowledgement", async () => {
      manager.connect();

      const promise = manager.startEgress({ record: true });
      const call = testContext.mockSocket.emit.mock.calls.find(
        (args) => args[0] === "egress:start",
      );
      expect(call?.[1]).toEqual({ record: true, hls: false });
      (call?.[2] as (ack: unknown) => void)({ ok: true });

      await expect(promise).resolves.toBeUndefined();
    });

    it("rejects startEgress with the server's coded denial", async () => {
      manager.connect();

      const promise = manager.startEgress({ hls: true });
      const call = testContext.mockSocket.emit.mock.calls.find(
        (args) => args[0] === "egress:start",
      );
      (call?.[2] as (ack: unknown) => void)({
        ok: false,
        code: "MISSING_CAPABILITY",
        message: "Missing start-broadcast capability",
      });

      await expect(promise).rejects.toMatchObject({
        name: "SfuEgressActionError",
        code: "MISSING_CAPABILITY",
      });
    });

    it("rejects when the acknowledgement never arrives", async () => {
      manager.connect();

      const promise = manager.startEgress({ record: true }, { timeoutMs: 5 });
      await expect(promise).rejects.toMatchObject({
        code: "EGRESS_ACTION_TIMEOUT",
      });
    });

    it("resolves stopEgress on the server acknowledgement", async () => {
      manager.connect();

      const promise = manager.stopEgress();
      const call = testContext.mockSocket.emit.mock.calls.find(
        (args) => args[0] === "egress:stop",
      );
      (call?.[2] as (ack: unknown) => void)({ ok: true });

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("reconnection recovery", () => {
    async function establishSession() {
      manager.connect();
      testContext.mockSocket.connected = true;
      await testContext.emitSocketEvent("connect");
      await manager.joinRoom({ roomId: "room-1", token: "stale-token" });
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
        participant: { id: "user-1" },
        capabilities: [],
      });
    }

    it("enters reconnecting after a post-join disconnect and replays the join on reconnect", async () => {
      await establishSession();
      await testContext.emitSocketEvent("disconnect");

      expect(manager.getState().connectionState).toBe("reconnecting");

      await testContext.emitSocketEvent("connect");
      const joinCall = testContext.mockSocket.emit.mock.calls.find(
        (args) => args[0] === "sfu:join",
      );
      expect(joinCall).toBeDefined();

      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
        participant: { id: "user-1" },
        capabilities: [],
      });
      expect(manager.getState().connectionState).toBe("connected");
    });

    it("keeps the connecting status for a disconnect before any join", async () => {
      manager.connect();
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("disconnect");

      expect(manager.getState().connectionState).toBe("connecting");
    });

    it("reproduces retained local tracks after recovery, without re-acquiring them", async () => {
      await establishSession();
      const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;
      await testContext.emitSocketEvent("disconnect");

      // Producing while reconnecting buffers the intent; the same track
      // reference must be replayed after the rejoin, never a new capture.
      void manager.produce(track);
      const produced: MediaStreamTrack[] = [];
      testContext.mockSendTransport.produce.mockImplementation(
        async (params: { track: MediaStreamTrack }) => {
          produced.push(params.track);
          return testContext.mockProducer;
        },
      );

      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
        participant: { id: "user-1" },
        capabilities: [],
      });
      await testContext.emitSocketEvent("sfu:transport-created", {
        direction: "send",
        transportId: "send-transport",
        iceParameters: {},
        iceCandidates: [],
        dtlsParameters: {},
      });

      expect(produced).toEqual([track]);
    });

    it("retains live producer tracks across the blip and replays them", async () => {
      await establishSession();
      await testContext.emitSocketEvent("sfu:transport-created", {
        direction: "send",
        transportId: "send-transport",
        iceParameters: {},
        iceCandidates: [],
        dtlsParameters: {},
      });
      const liveTrack = {
        kind: "video",
        readyState: "live",
      } as MediaStreamTrack;
      await manager.produce(liveTrack);
      // The mock producer always returns the shared instance; hand it the
      // live track it is supposed to be carrying.
      testContext.mockProducer.track = liveTrack;
      const produced: MediaStreamTrack[] = [];
      testContext.mockSendTransport.produce.mockImplementation(
        async (params: { track: MediaStreamTrack }) => {
          produced.push(params.track);
          return testContext.mockProducer;
        },
      );

      await testContext.emitSocketEvent("disconnect");
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:joined", {
        routerRtpCapabilities: { codecs: [] },
        participant: { id: "user-1" },
        capabilities: [],
      });
      await testContext.emitSocketEvent("sfu:transport-created", {
        direction: "send",
        transportId: "send-transport",
        iceParameters: {},
        iceCandidates: [],
        dtlsParameters: {},
      });

      expect(produced).toEqual([liveTrack]);
    });

    it("surfaces reconnect exhaustion typed and stops", async () => {
      await establishSession();
      const failures: string[] = [];
      manager.onReconnectError((error) => failures.push(error.code));

      await testContext.emitSocketEvent("disconnect");
      await testContext.emitSocketEvent("reconnect_failed");

      expect(manager.getState().connectionState).toBe("failed");
      expect(failures).toEqual(["RECONNECT_EXHAUSTED"]);

      // No further recovery: a late connect must not replay a join.
      testContext.mockSocket.emit.mockClear();
      await testContext.emitSocketEvent("connect");
      expect(
        testContext.mockSocket.emit.mock.calls.some(
          (args) => args[0] === "sfu:join",
        ),
      ).toBe(false);
    });

    it("gives up recovery when rejoins exceed the sliding-window limit", async () => {
      await establishSession();
      const failures: string[] = [];
      manager.onReconnectError((error) => failures.push(error.code));

      // Six rapid reconnect cycles: five replays pass, the sixth trips the
      // sliding-window limiter and recovery fails typed.
      for (let cycle = 0; cycle < 6; cycle++) {
        await testContext.emitSocketEvent("disconnect");
        await testContext.emitSocketEvent("connect");
      }

      expect(manager.getState().connectionState).toBe("failed");
      expect(failures).toContain("RECONNECT_EXHAUSTED");
    });

    it("refreshes an expired token once through the provider and rejoins", async () => {
      await establishSession();
      const provider = vi.fn(async () => "fresh-token");
      await manager.joinRoom(
        { roomId: "room-1", token: "stale-token" },
        { tokenProvider: provider },
      );

      await testContext.emitSocketEvent("disconnect");
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:join-error", {
        code: "ROOM_TOKEN_EXPIRED",
        message: "Room token is not valid",
      });
      await waitFor(() => expect(provider).toHaveBeenCalledTimes(1));

      const joinCalls = testContext.mockSocket.emit.mock.calls.filter(
        (args) => args[0] === "sfu:join",
      );
      expect(joinCalls.at(-1)?.[1]).toMatchObject({ token: "fresh-token" });
    });

    it("fails typed on expired token without a provider", async () => {
      await establishSession();
      const errors: string[] = [];
      manager.onJoinError((error) => errors.push(error.code));

      await testContext.emitSocketEvent("disconnect");
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:join-error", {
        code: "ROOM_TOKEN_EXPIRED",
        message: "Room token is not valid",
      });

      expect(manager.getState().connectionState).toBe("failed");
      expect(errors).toEqual(["ROOM_TOKEN_EXPIRED"]);
    });

    it("treats a kicked rejoin denial as terminal and fires kicked callbacks", async () => {
      await establishSession();
      const kicks: string[] = [];
      manager.onKicked(() => kicks.push("kicked"));

      await testContext.emitSocketEvent("disconnect");
      await testContext.emitSocketEvent("connect");
      await testContext.emitSocketEvent("sfu:join-error", {
        code: "KICKED_FROM_ROOM",
        message: "Removed from the room by the host",
      });

      expect(kicks).toEqual(["kicked"]);
      expect(manager.getState().connectionState).toBe("disconnected");
      expect(testContext.mockSocket.disconnect).toHaveBeenCalled();
    });

    it("does not recover after an explicit leave", async () => {
      await establishSession();
      manager.leaveRoom();

      await testContext.emitSocketEvent("disconnect");
      testContext.mockSocket.emit.mockClear();
      await testContext.emitSocketEvent("connect");

      expect(
        testContext.mockSocket.emit.mock.calls.some(
          (args) => args[0] === "sfu:join",
        ),
      ).toBe(false);
      expect(manager.getState().connectionState).toBe("connected");
    });
  });

  describe("data channel", () => {
    it("mirrors received broadcasts into state and callbacks", async () => {
      manager.connect();
      const received: unknown[] = [];
      manager.onBroadcast((message) => received.push(message));

      const message = {
        senderId: "user-2",
        topic: "reactions",
        payload: { emoji: "wave" },
        timestamp: "2026-09-11T10:00:00.000Z",
      };
      await testContext.emitSocketEvent("sfu:broadcast", message);

      expect(manager.getState().lastBroadcast).toEqual(message);
      expect(received).toEqual([message]);
    });

    it("resolves sendBroadcast on the server acknowledgement", async () => {
      manager.connect();

      const promise = manager.sendBroadcast("reactions", { emoji: "wave" });
      const call = testContext.mockSocket.emit.mock.calls.find(
        (args) => args[0] === "sfu:broadcast",
      );
      expect(call?.[1]).toEqual({
        topic: "reactions",
        payload: { emoji: "wave" },
      });
      (call?.[2] as (ack: unknown) => void)({ ok: true });

      await expect(promise).resolves.toBeUndefined();
    });

    it("rejects sendBroadcast with the server's coded denial", async () => {
      manager.connect();

      const promise = manager.sendBroadcast("reactions", 1);
      const call = testContext.mockSocket.emit.mock.calls.find(
        (args) => args[0] === "sfu:broadcast",
      );
      (call?.[2] as (ack: unknown) => void)({
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        message: "payload must serialize to at most 8192 bytes",
      });

      await expect(promise).rejects.toMatchObject({
        name: "SfuBroadcastError",
        code: "PAYLOAD_TOO_LARGE",
      });
    });

    it("rejects when the acknowledgement never arrives", async () => {
      manager.connect();

      const promise = manager.sendBroadcast("reactions", 1, { timeoutMs: 5 });
      await expect(promise).rejects.toMatchObject({
        code: "BROADCAST_TIMEOUT",
      });
    });

    it("rejects immediately when disconnected", async () => {
      await expect(manager.sendBroadcast("reactions", 1)).rejects.toMatchObject(
        {
          name: "SfuBroadcastError",
          code: "DISCONNECTED",
        },
      );
    });
  });
});
