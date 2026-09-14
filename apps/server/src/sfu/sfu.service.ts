import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import type {
  Consumer,
  PlainTransportOptions,
  Producer,
  WebRtcTransport,
} from 'mediasoup/types';
import type { Socket } from 'socket.io';
import { WorkerManager } from './worker-manager';
import type {
  SfuConsumePayload,
  SfuHostActionAck,
  SfuJoinPayload,
  SfuMediaSource,
  SfuProduceAppData,
  SfuProducePayload,
  SfuTransportConnectPayload,
  SfuTransportDirection,
} from './interfaces/sfu.interface';
import type { CapabilityId } from './capabilities';
import { config, getIceServers } from './config/mediasoup.config';
import type {
  RoomMediaSource,
  RoomTapDescriptor,
  RoomTapHandle,
  RoomTapSource,
  RoomTapTarget,
} from './room-media-source.port';
import { ROOM_PRESENCE } from './room-presence.port';
import type { PeerContext, RoomPresence } from './room-presence.port';

/**
 * PlainTransport options for media taps: RTP over UDP to a consumer-side
 * listener (egress FFmpeg binds 127.0.0.1). Stays here, not in egress
 * config - plain transports are an SFU-side mediasoup detail.
 */
const tapPlainTransportOptions = {
  listenIp: config.webRtcTransport.listenIps[0],
  rtcpMux: true,
  comedia: false,
} satisfies PlainTransportOptions;

/** Media attachments of one joined socket. Identity lives in presence. */
interface MediaPeer {
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

/**
 * Media lifecycle over the Room Presence seam: transports, producers,
 * consumers, screen-share lock and the RoomMediaSource tap port. Membership,
 * admission and room lifetime live behind {@link ROOM_PRESENCE}; this module
 * learns about departures through onPeerDetach and room death through
 * onRoomClosed.
 */
@Injectable()
export class SfuService implements OnModuleDestroy, RoomMediaSource {
  private readonly logger = new Logger(SfuService.name);
  private readonly media = new Map<string, MediaPeer>();
  private readonly roomScreenShare: Map<string, string> = new Map();
  private readonly tapHandlers: Map<
    string,
    Set<(descriptor: RoomTapDescriptor) => void>
  > = new Map();
  /** Rooms with a live router-close subscription on presence. */
  private readonly routerRooms = new Set<string>();
  constructor(
    private readonly workerManager: WorkerManager,
    @Inject(ROOM_PRESENCE) private readonly presence: RoomPresence,
  ) {
    // Workers own the routers; when one dies, its rooms keep presence state
    // but their media plane is gone. The reset flow rebuilds it in place.
    this.workerManager.onRoutersLost((roomIds) =>
      this.handleRoutersLost(roomIds),
    );
  }

  onModuleDestroy(): void {
    this.logger.log('Closing SFU Service...');
    for (const media of this.media.values()) {
      media.sendTransport?.close();
      media.recvTransport?.close();
    }
    this.media.clear();
    this.roomScreenShare.clear();
    this.tapHandlers.clear();
    this.logger.log('SFU Service closed');
  }

  /**
   * Media plane of the given rooms died with a worker. Presence, chat and
   * room lifetime are untouched: clear local media state (all transports
   * and producers died with the worker process), drop screen-share locks,
   * and tell participants to rebuild against the replacement router.
   */
  private handleRoutersLost(roomIds: string[]): void {
    for (const roomId of roomIds) {
      for (const socketId of this.presence.listPeerSockets(roomId)) {
        const media = this.media.get(socketId);
        if (!media) continue;
        media.sendTransport?.close();
        media.recvTransport?.close();
        this.media.delete(socketId);
      }
      this.roomScreenShare.delete(roomId);
      const routerRtpCapabilities =
        this.workerManager.getRtpCapabilities(roomId);
      if (!routerRtpCapabilities) continue;
      this.presence.broadcastToRoom(roomId, 'sfu:room-media-reset', {
        roomId,
        routerRtpCapabilities,
      });
      this.logger.warn(`Media reset for room ${roomId} after worker death`);
    }
  }
  async joinRoom(socket: Socket, payload: SfuJoinPayload): Promise<void> {
    const outcome = await this.presence.join(socket, payload);
    if (!outcome) {
      return;
    }

    this.media.set(socket.id, { producers: new Map(), consumers: new Map() });
    // Media detaches when presence announces the departure or holds the
    // disconnect seat - whichever comes first for this socket.
    this.presence.onPeerDetach(socket.id, () => this.detachMedia(socket.id));

    // The router dies with the room: presence notifies room-closed while the
    // room is still resolvable, so member media can be released with it.
    if (!this.routerRooms.has(outcome.roomId)) {
      this.routerRooms.add(outcome.roomId);
      const roomId = outcome.roomId;
      this.presence.onRoomClosed(roomId, () => this.closeRoomMedia(roomId));
    }
    try {
      await this.workerManager.createRouter(outcome.roomId);
    } catch (error) {
      // A worker replacement gap (crash recovery) or router failure: the
      // client sees no join ack and its own join timeout/retry handles it.
      this.logger.error(
        `Router creation failed for room ${outcome.roomId}`,
        error,
      );
      return;
    }
    const routerRtpCapabilities = this.workerManager.getRtpCapabilities(
      outcome.roomId,
    );
    socket.emit('sfu:joined', {
      routerRtpCapabilities,
      participant: {
        id: outcome.userId,
        username: outcome.username,
        externalId: outcome.externalId,
        metadata: outcome.metadata,
      },
      capabilities: outcome.capabilities,
    });
  }
  /**
   * Room teardown on presence's room-closed notification. Member media goes
   * synchronously; the router closes on a microtask so the other room-closed
   * subscribers (egress taps, whiteboard) stop while media is still
   * resolvable - the ordering the room-empty flow always guaranteed.
   */
  private closeRoomMedia(roomId: string): void {
    for (const socketId of this.presence.listPeerSockets(roomId)) {
      const media = this.media.get(socketId);
      media?.sendTransport?.close();
      media?.recvTransport?.close();
      this.media.delete(socketId);
    }
    this.roomScreenShare.delete(roomId);
    this.routerRooms.delete(roomId);
    void Promise.resolve().then(() => this.workerManager.closeRouter(roomId));
  }

  async leaveRoom(socket: Socket): Promise<void> {
    const roomId = this.presence.contextOf(socket.id)?.roomId;
    await this.presence.leave(socket.id, 'leave');
    if (roomId) {
      this.logger.log(`Peer ${socket.id} left SFU room ${roomId}`);
    }
  }

  async createSendTransport(socket: Socket): Promise<void> {
    const peer = this.media.get(socket.id);
    const ctx = this.presence.contextOf(socket.id);
    const router = ctx ? this.workerManager.getRouter(ctx.roomId) : undefined;

    if (!peer || !router) {
      this.logger.error(
        !peer ? `Peer ${socket.id} not found` : 'No router found',
      );
      return;
    }

    let transport: WebRtcTransport;
    try {
      transport = await router.createWebRtcTransport({
        listenIps: config.webRtcTransport.listenIps,
        enableUdp: config.webRtcTransport.enableUdp,
        enableTcp: config.webRtcTransport.enableTcp,
        preferUdp: config.webRtcTransport.preferUdp,
      });
    } catch (error) {
      // Router lost mid-request (worker replacement): client retries on the
      // rebuilt router after sfu:room-media-reset.
      this.logger.error(
        `Send transport creation failed for ${socket.id}`,
        error,
      );
      return;
    }
    peer.sendTransport = transport;

    this.emitTransportCreated(socket, 'send', transport);
  }

  async createRecvTransport(socket: Socket): Promise<void> {
    const peer = this.media.get(socket.id);
    const ctx = this.presence.contextOf(socket.id);
    const router = ctx ? this.workerManager.getRouter(ctx.roomId) : undefined;

    if (!peer || !router || !ctx) {
      this.logger.error(
        !peer ? `Peer ${socket.id} not found` : 'No router found',
      );
      return;
    }

    let transport: WebRtcTransport;
    try {
      transport = await router.createWebRtcTransport({
        listenIps: config.webRtcTransport.listenIps,
        enableUdp: config.webRtcTransport.enableUdp,
        enableTcp: config.webRtcTransport.enableTcp,
        preferUdp: config.webRtcTransport.preferUdp,
      });
    } catch (error) {
      this.logger.error(
        `Recv transport creation failed for ${socket.id}`,
        error,
      );
      return;
    }
    peer.recvTransport = transport;

    this.emitTransportCreated(socket, 'recv', transport);

    // Announce every existing producer so the fresh recv transport can
    // consume the room's current media immediately.
    for (const socketId of this.presence.listPeerSockets(ctx.roomId)) {
      if (socketId === socket.id) continue;
      const roomPeer = this.media.get(socketId);
      const peerCtx = this.presence.contextOf(socketId);
      if (!roomPeer || !peerCtx) continue;
      for (const producer of roomPeer.producers.values()) {
        this.emitNewProducer(socket, producer, peerCtx);
      }
    }
  }

  async connectTransport(
    socket: Socket,
    payload: SfuTransportConnectPayload,
  ): Promise<void> {
    const peer = this.media.get(socket.id);
    if (!peer) {
      this.logger.error(`Peer ${socket.id} not found`);
      return;
    }

    const transport = this.getTransport(peer, payload.transportId);
    if (!transport) {
      this.logger.error(`Transport ${payload.transportId} not found`);
      return;
    }

    await transport.connect({ dtlsParameters: payload.dtlsParameters });
    socket.emit('sfu:transport-connected', {
      transportId: payload.transportId,
    });
  }

  async createProducer(
    socket: Socket,
    payload: SfuProducePayload,
  ): Promise<void> {
    const peer = this.media.get(socket.id);
    const ctx = this.presence.contextOf(socket.id);

    const source: SfuMediaSource =
      (payload.appData?.source as SfuMediaSource) ?? 'camera';

    if (ctx) {
      const required: CapabilityId =
        source === 'screen'
          ? 'send-screenshare'
          : payload.kind === 'audio'
            ? 'send-audio'
            : 'send-video';
      if (!ctx.capabilities.includes(required)) {
        socket.emit('sfu:produce-error', {
          requestId: payload.requestId,
          code: 'PUBLISH_NOT_ALLOWED',
          message: `Missing ${required} capability`,
        });
        return;
      }
    }
    if (!peer?.sendTransport || !ctx) {
      socket.emit('sfu:produce-error', {
        requestId: payload.requestId,
        code: 'SEND_TRANSPORT_NOT_READY',
        message: 'No send transport or room found',
      });
      return;
    }

    const { transportId, kind, rtpParameters, requestId } = payload;
    if (peer.sendTransport.id !== transportId) {
      socket.emit('sfu:produce-error', {
        requestId,
        code: 'TRANSPORT_NOT_FOUND',
        message: `Transport ${transportId} not found`,
      });
      return;
    }

    if (source === 'screen') {
      const existingSharer = this.roomScreenShare.get(ctx.roomId);
      if (existingSharer && existingSharer !== socket.id) {
        socket.emit('sfu:produce-error', {
          requestId,
          code: 'SCREEN_SHARE_ALREADY_ACTIVE',
          message: 'Another participant is already sharing',
        });
        return;
      }
    }

    let producer: Producer;
    try {
      producer = await peer.sendTransport.produce({
        kind,
        rtpParameters,
        appData: { source },
      });
    } catch {
      socket.emit('sfu:produce-error', {
        requestId,
        code: 'PRODUCE_FAILED',
        message: 'Failed to create producer',
      });
      return;
    }

    peer.producers.set(producer.id, producer);

    if (source === 'screen') {
      this.roomScreenShare.set(ctx.roomId, socket.id);
      this.presence.broadcastToRoom(
        ctx.roomId,
        'sfu:screen-share-started',
        { userId: ctx.userId },
        { excludeSocketId: socket.id },
      );
    }

    socket.emit('sfu:producer-created', {
      requestId,
      producerId: producer.id,
      userId: ctx.userId,
      kind,
      appData: { source },
    });

    this.notifyPeersToConsume(socket, producer);

    this.notifyTapHandlers(ctx.roomId, producer);
  }

  closeProducer(socketId: string, producerId: string): void {
    this.closeProducerForPeer(socketId, producerId);
  }

  /** {@inheritdoc RoomMediaSource.listTaps} */
  listTaps(roomId: string): RoomTapDescriptor[] {
    return this.presence.listPeerSockets(roomId).flatMap((socketId) =>
      Array.from(
        this.media.get(socketId)?.producers.values() ?? [],
        (producer) => ({
          producerId: producer.id,
          kind: producer.kind,
          source: this.producerTapSource(producer),
        }),
      ),
    );
  }

  /**
   * {@inheritdoc RoomMediaSource.openTap}
   *
   * Creates the plain transport, points it at the consumer's listener, and
   * consumes the producer unpaused. On any failure the transport is closed
   * again - the adapter owns the whole lifecycle, never a half-open tap.
   */
  async openTap(
    roomId: string,
    producerId: string,
    target: RoomTapTarget,
  ): Promise<RoomTapHandle> {
    const router = this.workerManager.getRouter(roomId);
    if (!router) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    const transport = await router.createPlainTransport(
      tapPlainTransportOptions,
    );
    try {
      await transport.connect({ ip: target.ip, port: target.port });
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
        appData: { tap: true },
      });
      return {
        rtpParameters: consumer.rtpParameters,
        onProducerClosed(cb) {
          consumer.on('producerclose', cb);
          return () => {
            consumer.off('producerclose', cb);
          };
        },
        close() {
          try {
            consumer.close();
          } catch {
            // already closed by its transport or the dead pipeline path
          }
          try {
            transport.close();
          } catch {
            // ditto
          }
        },
      };
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  /** {@inheritdoc RoomMediaSource.onProducerAdded} */
  onProducerAdded(
    roomId: string,
    handler: (descriptor: RoomTapDescriptor) => void,
  ): () => void {
    let handlers = this.tapHandlers.get(roomId);
    if (!handlers) {
      handlers = new Set();
      this.tapHandlers.set(roomId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  async createConsumer(
    socket: Socket,
    payload: SfuConsumePayload,
  ): Promise<void> {
    const peer = this.media.get(socket.id);
    const ctx = this.presence.contextOf(socket.id);
    const router = ctx ? this.workerManager.getRouter(ctx.roomId) : undefined;

    if (!peer?.recvTransport || !router) {
      this.logger.error('Missing peer transport or router');
      return;
    }

    const { producerId, rtpCapabilities } = payload;

    let targetProducer: Producer | undefined;
    for (const media of this.media.values()) {
      const prod = media.producers.get(producerId);
      if (prod) {
        targetProducer = prod;
        break;
      }
    }

    if (!targetProducer) {
      this.logger.error(`Producer ${producerId} not found`);
      return;
    }
    let consumer: Consumer;
    try {
      consumer = await peer.recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });
    } catch (error) {
      // Transport closed mid-request (peer detach or media reset race).
      this.logger.error(`Consumer creation failed for ${socket.id}`, error);
      return;
    }
    peer.consumers.set(consumer.id, consumer);

    socket.emit('sfu:consumer-created', {
      consumerId: consumer.id,
      producerId,
      kind: targetProducer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }

  async resumeConsumer(socket: Socket, consumerId: string): Promise<void> {
    const peer = this.media.get(socket.id);
    if (!peer) {
      this.logger.error(`Peer ${socket.id} not found`);
      return;
    }

    const consumer = this.getConsumer(peer, consumerId);
    if (!consumer) {
      this.logger.error(`Consumer ${consumerId} not found`);
      return;
    }

    await consumer.resume();
    socket.emit('sfu:consumer-resumed', {
      consumerId,
    });
  }

  async pauseProducer(socket: Socket, producerId: string): Promise<void> {
    const peer = this.media.get(socket.id);
    const ctx = this.presence.contextOf(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer || !peer || !ctx) {
      this.logger.error(`Producer ${producerId} not found`);
      return;
    }
    await producer.pause();
    this.notifyProducerStateChanged(socket, producer, ctx, true);
  }

  async resumeProducer(socket: Socket, producerId: string): Promise<void> {
    const peer = this.media.get(socket.id);
    const ctx = this.presence.contextOf(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer || !peer || !ctx) {
      this.logger.error(`Producer ${producerId} not found`);
      return;
    }
    await producer.resume();
    this.notifyProducerStateChanged(socket, producer, ctx, false);
  }

  async mutePeer(
    socket: Socket,
    targetUserId: string,
  ): Promise<SfuHostActionAck> {
    const denial = this.denyHostAction(socket, 'mute-users', 'mute');
    if (denial) return denial;
    const ctx = this.presence.contextOf(socket.id)!;

    const targetSocketId = this.presence.peerSocketInRoom(
      ctx.roomId,
      targetUserId,
    );
    if (!targetSocketId || targetSocketId === socket.id) {
      return {
        ok: false,
        code: 'TARGET_NOT_FOUND',
        message: `Participant ${targetUserId} is not in the room`,
      };
    }

    await this.muteRoomPeer(ctx.roomId, targetSocketId, targetUserId);
    return { ok: true };
  }

  async muteAll(socket: Socket): Promise<SfuHostActionAck> {
    const denial = this.denyHostAction(socket, 'mute-users', 'mute-all');
    if (denial) return denial;
    const ctx = this.presence.contextOf(socket.id)!;
    // Snapshot of the current publishers: peers that start publishing after
    // mute-all stay unmuted, and the requesting host is never muted. Pauses
    // fan out in parallel - each is a worker round-trip.
    const targets = this.presence
      .listPeerSockets(ctx.roomId)
      .filter((socketId) => socketId !== socket.id)
      .map((socketId) => ({
        socketId,
        target: this.media.get(socketId),
        targetUserId: this.presence.contextOf(socketId)?.userId,
      }))
      .filter(
        ({ target, targetUserId }) =>
          target !== undefined &&
          target.producers.size > 0 &&
          targetUserId !== undefined,
      );
    await Promise.all(
      targets.map(({ socketId, targetUserId }) =>
        this.muteRoomPeer(ctx.roomId, socketId, targetUserId as string),
      ),
    );
    return { ok: true };
  }

  /**
   * Socket dropped without an explicit leave: presence holds the peer's seat
   * and identity for the grace window and detaches media through
   * {@link onPeerDetach}. A same-id rejoin inside the window restores
   * silently; expiry runs the normal disconnect leave flow.
   */
  async closePeer(socket: Socket): Promise<void> {
    this.presence.holdSeat(socket.id);
  }

  /**
   * Set preferred simulcast layers for a consumer owned by the requesting peer.
   * Returns false if the consumer is not found or not owned by the socket.
   */
  async setPreferredLayers(
    socket: Socket,
    consumerId: string,
    spatialLayer: number,
  ): Promise<boolean> {
    const peer = this.media.get(socket.id);
    if (!peer) {
      this.logger.warn(`setPreferredLayers: peer ${socket.id} not found`);
      return false;
    }

    const consumer = this.getConsumer(peer, consumerId);
    if (!consumer) {
      this.logger.warn(
        `setPreferredLayers: consumer ${consumerId} not owned by peer ${socket.id}`,
      );
      return false;
    }

    await consumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 });
    return true;
  }

  /**
   * End a room: presence announces `sfu:room-ended`, runs the departure flow
   * for every member, and notifies room-closed - the media layer tears the
   * mediasoup router down on that notification.
   */
  async endRoom(roomId: string): Promise<void> {
    return this.presence.endRoom(roomId);
  }

  /** Guards a host-control action through presence context. */
  private denyHostAction(
    socket: Socket,
    capability: CapabilityId,
    action: string,
  ): SfuHostActionAck | null {
    const ctx = this.presence.contextOf(socket.id);

    if (!ctx) {
      this.logger.warn(`${action} request from unknown peer ${socket.id}`);
      return {
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'Join the room before using host controls',
      };
    }

    if (!ctx.capabilities.includes(capability)) {
      this.logger.warn(
        `Unauthorized ${action} request from ${ctx.userId} in room ${ctx.roomId}`,
      );
      return {
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: `Missing ${capability} capability`,
      };
    }

    return null;
  }

  private emitTransportCreated(
    socket: Socket,
    direction: SfuTransportDirection,
    transport: WebRtcTransport,
  ): void {
    socket.emit('sfu:transport-created', {
      direction,
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      iceServers: getIceServers(),
    });
  }

  private emitNewProducer(
    target: Socket,
    producer: Producer,
    ctx: PeerContext,
  ): void {
    target.emit('sfu:new-producer', this.newProducerPayload(producer, ctx));
  }

  private getTransport(
    peer: MediaPeer,
    transportId: string,
  ): WebRtcTransport | undefined {
    if (peer.sendTransport?.id === transportId) {
      return peer.sendTransport;
    }

    if (peer.recvTransport?.id === transportId) {
      return peer.recvTransport;
    }

    return undefined;
  }

  private getConsumer(
    peer: MediaPeer,
    consumerId: string,
  ): Consumer | undefined {
    return peer.consumers.get(consumerId);
  }

  private closeProducerForPeer(
    socketId: string,
    producerId: string,
  ): { roomId: string; ctx: PeerContext; producer: Producer } | null {
    const peer = this.media.get(socketId);
    const ctx = this.presence.contextOf(socketId);
    if (!peer || !ctx) return null;

    const producer = peer.producers.get(producerId);
    if (!producer) return null;

    const source = (producer.appData as Record<string, unknown> | undefined)
      ?.source as SfuMediaSource | undefined;

    producer.close();
    peer.producers.delete(producerId);

    if (source === 'screen') {
      const currentSharer = this.roomScreenShare.get(ctx.roomId);
      if (currentSharer === socketId) {
        this.roomScreenShare.delete(ctx.roomId);
        for (const otherId of this.presence.listPeerSockets(ctx.roomId)) {
          if (otherId === socketId) continue;
          const other = this.media.get(otherId);
          if (!other) continue;
          // Close the consumer that was consuming this screen-share producer
          // and notify the client so it can clean up its state immediately.
          for (const [consumerId, consumer] of other.consumers) {
            if (consumer.producerId === producerId) {
              consumer.close();
              other.consumers.delete(consumerId);
              this.presence.emitToPeer(otherId, 'sfu:consumer-closed', {
                consumerId,
              });
              break;
            }
          }
          this.presence.emitToPeer(otherId, 'sfu:screen-share-stopped', {
            userId: ctx.userId,
          });
        }
      }
    }

    return { roomId: ctx.roomId, ctx, producer };
  }

  /**
   * Tears a socket's media state down (producers, screen-share lock,
   * transports) when presence announces the departure or holds the
   * disconnect seat. Identity and membership never pass through here.
   */
  private detachMedia(socketId: string): void {
    const peer = this.media.get(socketId);
    const ctx = this.presence.contextOf(socketId);
    if (!peer || !ctx) {
      this.media.delete(socketId);
      return;
    }
    const { roomId } = ctx;

    // Announce the media detach before tearing transports down, so the room
    // can flag the seat as disconnected for the rest of the grace window.
    this.presence.broadcastToRoom(
      roomId,
      'sfu:peer-media-detached',
      { userId: ctx.userId },
      { excludeSocketId: socketId },
    );

    // Close all producers through the shared path so screen-share lock is
    // released and peers are notified consistently.
    for (const producerId of Array.from(peer.producers.keys())) {
      this.closeProducerForPeer(socketId, producerId);
    }

    // Fallback: if the screen-share lock is still held (e.g. producers map was
    // not populated), release it directly so the room state stays consistent.
    const currentSharer = this.roomScreenShare.get(roomId);
    if (currentSharer === socketId) {
      this.roomScreenShare.delete(roomId);
      this.presence.broadcastToRoom(
        roomId,
        'sfu:screen-share-stopped',
        { userId: ctx.userId },
        { excludeSocketId: socketId },
      );
    }

    peer.sendTransport?.close();
    peer.recvTransport?.close();
    this.media.delete(socketId);
  }

  /**
   * Pause every producer owned by the target socket server-side and announce
   * the mute to the whole room, including the target, so it can surface its
   * muted-by-host state.
   */
  private async muteRoomPeer(
    roomId: string,
    targetSocketId: string,
    targetUserId: string,
  ): Promise<void> {
    const target = this.media.get(targetSocketId);
    for (const producer of Array.from(target?.producers.values() ?? [])) {
      if (!producer.paused) {
        await producer.pause();
      }
    }
    this.presence.broadcastToRoom(roomId, 'sfu:peer-muted', {
      userId: targetUserId,
    });
  }

  private notifyProducerStateChanged(
    socket: Socket,
    producer: Producer,
    ctx: PeerContext,
    paused: boolean,
  ): void {
    const source = (producer.appData as Record<string, unknown> | undefined)
      ?.source as SfuMediaSource | undefined;

    this.presence.broadcastToRoom(
      ctx.roomId,
      'sfu:producer-state-changed',
      {
        producerId: producer.id,
        kind: producer.kind,
        userId: ctx.userId,
        paused,
        source,
      },
      { excludeSocketId: socket.id },
    );
  }

  private notifyPeersToConsume(socket: Socket, producer: Producer): void {
    const ctx = this.presence.contextOf(socket.id);
    if (!ctx) return;

    const payload = this.newProducerPayload(producer, ctx);
    for (const socketId of this.presence.listPeerSockets(ctx.roomId)) {
      if (socketId === socket.id) continue;
      // Only peers whose recv transport exists can consume right now.
      if (!this.media.get(socketId)?.recvTransport) continue;
      this.presence.emitToPeer(socketId, 'sfu:new-producer', payload);
    }
  }

  private newProducerPayload(producer: Producer, ctx: PeerContext) {
    return {
      producerId: producer.id,
      userId: ctx.userId,
      username: ctx.username,
      kind: producer.kind,
      paused: producer.paused,
      appData: producer.appData as Record<string, unknown> | undefined,
    };
  }

  private producerTapSource(producer: Producer): RoomTapSource {
    const appData = producer.appData as SfuProduceAppData | undefined;
    return appData?.source ?? 'camera';
  }

  private notifyTapHandlers(roomId: string, producer: Producer): void {
    const handlers = this.tapHandlers.get(roomId);
    if (!handlers) return;

    const descriptor: RoomTapDescriptor = {
      producerId: producer.id,
      kind: producer.kind,
      source: this.producerTapSource(producer),
    };
    for (const handler of handlers) {
      handler(descriptor);
    }
  }
}
