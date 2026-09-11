import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WorkerManager } from './worker-manager';
import { capabilitiesForRole, type CapabilityId } from './capabilities';
import type {
  Peer,
  SfuJoinPayload,
  SfuTransportDirection,
  SfuTransportConnectPayload,
  SfuProducePayload,
  SfuConsumePayload,
  SfuExistingPeerPayload,
  SfuMediaSource,
  SfuJoinErrorCode,
  SfuHostActionAck,
  SfuProduceAppData,
} from './interfaces/sfu.interface';
import type {
  Consumer,
  PlainTransport,
  Producer,
  RtpParameters,
  WebRtcTransport,
} from 'mediasoup/types';
import { config, getIceServers } from './config/mediasoup.config';
import { RoomTokenHelper } from '../platform/room-token.helper';
import { resolveRoomSocketIdentity } from '../auth/helpers/room-socket-auth.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.service';
import type { WebhookLeaveReason } from '../webhooks/webhook-dispatcher.service';
import { egressPlainTransportOptions } from '../egress/egress.config';
import type {
  EgressTapDescriptor,
  EgressTapSource,
} from '../egress/egress.types';

@Injectable()
export class SfuService implements OnModuleDestroy {
  private readonly logger = new Logger(SfuService.name);
  private peers: Map<string, Peer> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private roomOwners: Map<string, string> = new Map();
  private roomScreenShare: Map<string, string> = new Map();
  private roomLocks: Map<string, boolean> = new Map();
  private slugToRoomId: Map<string, string> = new Map();
  private egressTapHandlers: Map<
    string,
    Set<(descriptor: EgressTapDescriptor) => void>
  > = new Map();
  private roomClosedHandlers: Map<string, Set<() => void>> = new Map();

  registerSlug(slug: string, roomId: string): void {
    this.slugToRoomId.set(slug, roomId);
  }

  getOwnerSocketId(roomSlug: string): string | null {
    const roomId = this.slugToRoomId.get(roomSlug);
    if (!roomId) return null;
    const ownerId = this.roomOwners.get(roomId);
    if (!ownerId) return null;
    for (const peer of this.getRoomPeers(roomId)) {
      if (peer.userId === ownerId) return peer.id;
    }
    return null;
  }

  /**
   * Room context of a connected socket for cross-module signalling guards
   * (egress control): room id, verified user id, and effective capabilities.
   */
  describeSocket(
    socketId: string,
  ): { roomId: string; userId: string; capabilities: CapabilityId[] } | null {
    const peer = this.getPeer(socketId);
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!peer || !roomId) return null;
    return {
      roomId,
      userId: peer.userId,
      capabilities: peer.capabilities,
    };
  }

  /** Broadcast an event to every connected participant of a room. */
  broadcastToRoom(roomId: string, event: string, payload: unknown): void {
    for (const peer of this.getRoomPeers(roomId)) {
      peer.socket.emit(event, payload);
    }
  }

  hasPeerInSlug(roomSlug: string, userId: string): boolean {
    const roomId = this.slugToRoomId.get(roomSlug);
    if (!roomId) return false;
    return this.getRoomPeers(roomId).some((peer) => peer.userId === userId);
  }

  constructor(
    private readonly workerManager: WorkerManager,
    private readonly roomTokenHelper: RoomTokenHelper,
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatcher,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing SFU Service...');
    for (const [, peers] of this.rooms) {
      for (const peerId of peers) {
        const peer = this.peers.get(peerId);
        if (!peer) continue;
        peer.sendTransport?.close();
        peer.recvTransport?.close();
      }
    }
    this.peers.clear();
    this.rooms.clear();
    this.roomOwners.clear();
    this.roomLocks.clear();
    this.egressTapHandlers.clear();
    this.roomClosedHandlers.clear();
    this.slugToRoomId.clear();
    this.logger.log('SFU Service closed');
  }

  private getPeer(socketId: string): Peer | undefined {
    return this.peers.get(socketId);
  }

  private getRoomIdBySocketId(socketId: string): string | undefined {
    for (const [roomId, peers] of this.rooms) {
      if (peers.has(socketId)) return roomId;
    }
    return undefined;
  }

  private getRoomId(socket: Socket): string | undefined {
    return this.getRoomIdBySocketId(socket.id);
  }

  private getRoomPeers(roomId: string): Peer[] {
    const roomPeerIds = this.rooms.get(roomId);
    if (!roomPeerIds) return [];
    return Array.from(roomPeerIds)
      .map((id) => this.peers.get(id))
      .filter((p): p is Peer => p !== undefined);
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
    peer: Peer,
  ): void {
    target.emit('sfu:new-producer', {
      producerId: producer.id,
      userId: peer.userId,
      username: peer.username,
      kind: producer.kind,
      paused: producer.paused,
      appData: producer.appData as Record<string, unknown> | undefined,
    });
  }

  private notifyPeerLeft(
    roomId: string,
    userId: string,
    excludedSocketId: string,
  ): void {
    for (const roomPeer of this.getRoomPeers(roomId)) {
      if (roomPeer.id !== excludedSocketId) {
        roomPeer.socket.emit('sfu:peer-left', { userId });
      }
    }
  }

  private getTransport(
    peer: Peer,
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

  private getConsumer(peer: Peer, consumerId: string): Consumer | undefined {
    return peer.consumers.get(consumerId);
  }

  private closeProducerForPeer(
    socketId: string,
    producerId: string,
  ): { roomId: string; peer: Peer; producer: Producer } | null {
    const peer = this.getPeer(socketId);
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!peer || !roomId) return null;

    const producer = peer.producers.get(producerId);
    if (!producer) return null;

    const source = (producer.appData as Record<string, unknown> | undefined)
      ?.source as SfuMediaSource | undefined;

    producer.close();
    peer.producers.delete(producerId);

    if (source === 'screen') {
      const currentSharer = this.roomScreenShare.get(roomId);
      if (currentSharer === socketId) {
        this.roomScreenShare.delete(roomId);
        for (const roomPeer of this.getRoomPeers(roomId)) {
          if (roomPeer.id !== socketId) {
            // Close the consumer that was consuming this screen-share producer
            // and notify the client so it can clean up its state immediately.
            for (const [consumerId, consumer] of roomPeer.consumers) {
              if (consumer.producerId === producerId) {
                consumer.close();
                roomPeer.consumers.delete(consumerId);
                roomPeer.socket.emit('sfu:consumer-closed', { consumerId });
                break;
              }
            }
            roomPeer.socket.emit('sfu:screen-share-stopped', {
              userId: peer.userId,
            });
          }
        }
      }
    }

    return { roomId, peer, producer };
  }

  private async removePeer(
    socketId: string,
    reason?: WebhookLeaveReason,
  ): Promise<{ roomId: string; userId: string } | null> {
    const peer = this.getPeer(socketId);
    const roomId = this.getRoomIdBySocketId(socketId);

    if (!peer || !roomId) {
      return null;
    }

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
      for (const roomPeer of this.getRoomPeers(roomId)) {
        if (roomPeer.id !== socketId) {
          roomPeer.socket.emit('sfu:screen-share-stopped', {
            userId: peer.userId,
          });
        }
      }
    }

    this.rooms.get(roomId)?.delete(socketId);
    peer.sendTransport?.close();
    peer.recvTransport?.close();
    this.peers.delete(socketId);
    this.notifyPeerLeft(roomId, peer.userId, socketId);
    if (reason) {
      this.webhooks.participantLeft(
        roomId,
        this.findRoomSlug(roomId),
        {
          id: peer.userId,
          displayName: peer.username,
          externalId: peer.externalId,
          metadata: peer.metadata,
        },
        reason,
      );
    }

    if (this.rooms.get(roomId)?.size === 0) {
      // Stop egress taps while the room is still resolvable.
      this.notifyRoomClosed(roomId);
      await this.workerManager.closeRouter(roomId);
      this.rooms.delete(roomId);
      this.roomOwners.delete(roomId);
      this.roomLocks.delete(roomId);
      for (const [slug, rid] of this.slugToRoomId) {
        if (rid === roomId) this.slugToRoomId.delete(slug);
      }
    }

    return {
      roomId,
      userId: peer.userId,
    };
  }

  private findRoomSlug(roomId: string): string | undefined {
    for (const [slug, rid] of this.slugToRoomId) {
      if (rid === roomId) return slug;
    }
    return undefined;
  }

  async joinRoom(socket: Socket, payload: SfuJoinPayload): Promise<void> {
    // A locked room refuses every new join before any peer state is created.
    if (this.roomLocks.get(payload.roomId)) {
      this.emitJoinError(socket, 'ROOM_LOCKED', 'Room is locked by the host');
      return;
    }
    const { roomId, roomSlug } = payload;
    const peerId = socket.id;

    const peer = payload.token
      ? await this.resolveTokenPeer(socket, payload)
      : await this.resolveHandshakePeer(socket, payload);
    if (!peer) {
      return;
    }
    this.peers.set(peerId, peer);

    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    const roomPeers = this.rooms.get(roomId);
    if (!roomPeers) {
      this.logger.error(`Failed to initialize room ${roomId}`);
      return;
    }

    const firstPeer = roomPeers.size === 0;
    roomPeers.add(peerId);
    if (peer.ownsRoom) {
      this.roomOwners.set(roomId, peer.userId);
    }
    if (roomSlug) {
      this.slugToRoomId.set(roomSlug, roomId);
    }
    this.logger.log(`Peer ${peerId} joined SFU room ${roomId}`);

    // Notify existing peers about the new peer
    for (const roomPeer of this.getRoomPeers(roomId)) {
      if (roomPeer.id !== socket.id) {
        roomPeer.socket.emit('sfu:peer-joined', {
          userId: peer.userId,
          username: peer.username,
          externalId: peer.externalId,
          metadata: peer.metadata,
        });
      }
    }

    // Notify new peer about existing peers (even those without producers)
    const existingPeers: SfuExistingPeerPayload[] = this.getRoomPeers(roomId)
      .filter((p) => p.id !== socket.id)
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        externalId: p.externalId,
        metadata: p.metadata,
      }));

    if (existingPeers.length > 0) {
      socket.emit('sfu:existing-peers', existingPeers);
    }

    await this.workerManager.createRouter(roomId);
    const routerRtpCapabilities = this.workerManager.getRtpCapabilities(roomId);
    socket.emit('sfu:joined', {
      routerRtpCapabilities,
      participant: {
        id: peer.userId,
        username: peer.username,
        externalId: peer.externalId,
        metadata: peer.metadata,
      },
      capabilities: peer.capabilities,
    });

    // Webhook emission is fire-and-forget and must never delay or break the
    // join path; ordering (room.started before participant.joined) is kept by
    // the dispatcher's per-project FIFO queue.
    if (firstPeer) {
      this.webhooks.roomStarted(roomId, roomSlug);
    }
    this.webhooks.participantJoined(roomId, roomSlug, {
      id: peer.userId,
      displayName: peer.username,
      externalId: peer.externalId,
      metadata: peer.metadata,
    });
  }

  async leaveRoom(socket: Socket): Promise<void> {
    const removedPeer = await this.removePeer(socket.id, 'leave');
    if (removedPeer) {
      this.logger.log(`Peer ${socket.id} left SFU room ${removedPeer.roomId}`);
    }
  }

  /**
   * Resolves a join that presents a room token: verifies signature, expiry,
   * room match and minting-key state, then builds the peer solely from the
   * verified claims. Returns null (after emitting a coded join error) on any
   * failure.
   */
  private async resolveTokenPeer(
    socket: Socket,
    payload: SfuJoinPayload,
  ): Promise<Peer | null> {
    const result = this.roomTokenHelper.verify(payload.token as string);

    if (!result.ok) {
      this.emitJoinError(socket, result.code, 'Room token is not valid');
      return null;
    }

    const claims = result.claims;
    if (claims.roomId !== payload.roomId) {
      this.emitJoinError(
        socket,
        'ROOM_TOKEN_ROOM_MISMATCH',
        'Room token was minted for a different room',
      );
      return null;
    }

    const key = await this.prisma.apiKey.findUnique({
      where: { id: claims.keyId },
      select: { revokedAt: true },
    });
    if (!key || key.revokedAt) {
      this.emitJoinError(socket, 'ROOM_TOKEN_INVALID', 'API key is not active');
      return null;
    }
    return {
      id: socket.id,
      userId: claims.participantId,
      username: claims.name,
      externalId: claims.externalId,
      metadata: claims.metadata,
      socket,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole(claims.role),
    };
  }

  /**
   * Resolves a join without a room token: derives the participant identity
   * from verified handshake credentials - a registered-user access JWT or an
   * approved-guest JWT - and grounds ownership in the room row. Client
   * payload identity fields are never trusted. Returns null (after emitting
   * a coded join error) when no credential verifies.
   */
  private async resolveHandshakePeer(
    socket: Socket,
    payload: SfuJoinPayload,
  ): Promise<Peer | null> {
    // Cookie identity is honored only from the app UI origin; the
    // room-token path stays origin-free for third-party SDK embeds.
    const clientUrl =
      this.config.get<string>('CLIENT_URL') || 'http://localhost:5173';
    const identity = resolveRoomSocketIdentity(
      socket,
      this.jwtService,
      this.config,
      { allowedOrigins: [clientUrl] },
    );
    if (!identity) {
      this.emitJoinError(
        socket,
        'SFU_JOIN_UNAUTHORIZED',
        'Join requires an authenticated session or a room token',
      );
      return null;
    }

    const room = await this.prisma.room.findUnique({
      where: { id: payload.roomId },
      select: { slug: true, ownerId: true },
    });
    if (!room) {
      this.emitJoinError(socket, 'SFU_JOIN_FORBIDDEN', 'Room not found');
      return null;
    }

    if (identity.type === 'guest') {
      if (identity.roomSlug !== room.slug) {
        this.emitJoinError(
          socket,
          'SFU_JOIN_FORBIDDEN',
          'Guest token was issued for a different room',
        );
        return null;
      }
      this.logger.log(
        `Guest peer ${identity.guestId} joining room ${payload.roomId}`,
      );
      return {
        id: socket.id,
        userId: identity.guestId,
        username: identity.displayName,
        socket,
        producers: new Map(),
        consumers: new Map(),
        capabilities: capabilitiesForRole('participant'),
      };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: identity.userId },
      select: { username: true },
    });
    if (!user) {
      this.emitJoinError(socket, 'SFU_JOIN_UNAUTHORIZED', 'Account not found');
      return null;
    }
    this.logger.log(
      `User peer ${identity.userId} joining room ${payload.roomId}`,
    );
    return {
      id: socket.id,
      userId: identity.userId,
      username: user.username,
      socket,
      producers: new Map(),
      consumers: new Map(),
      ownsRoom: room.ownerId === identity.userId,
      capabilities: capabilitiesForRole(
        room.ownerId === identity.userId ? 'host' : 'participant',
      ),
    };
  }

  private emitJoinError(
    socket: Socket,
    code: SfuJoinErrorCode,
    message: string,
  ): void {
    this.logger.warn(`SFU join rejected (${code}): ${message}`);
    socket.emit('sfu:join-error', { code, message });
  }

  async createSendTransport(socket: Socket): Promise<void> {
    const peer = this.getPeer(socket.id);
    const roomId = this.getRoomId(socket);
    const router = roomId ? this.workerManager.getRouter(roomId) : undefined;

    if (!peer || !router) {
      this.logger.error(
        !peer ? `Peer ${socket.id} not found` : 'No router found',
      );
      return;
    }

    const transport = await router.createWebRtcTransport({
      listenIps: config.webRtcTransport.listenIps,
      enableUdp: config.webRtcTransport.enableUdp,
      enableTcp: config.webRtcTransport.enableTcp,
      preferUdp: config.webRtcTransport.preferUdp,
    });
    peer.sendTransport = transport;

    this.emitTransportCreated(socket, 'send', transport);
  }

  async createRecvTransport(socket: Socket): Promise<void> {
    const peer = this.getPeer(socket.id);
    const roomId = this.getRoomId(socket);
    const router = roomId ? this.workerManager.getRouter(roomId) : undefined;

    if (!peer || !router) {
      this.logger.error(
        !peer ? `Peer ${socket.id} not found` : 'No router found',
      );
      return;
    }

    const transport = await router.createWebRtcTransport({
      listenIps: config.webRtcTransport.listenIps,
      enableUdp: config.webRtcTransport.enableUdp,
      enableTcp: config.webRtcTransport.enableTcp,
      preferUdp: config.webRtcTransport.preferUdp,
    });
    peer.recvTransport = transport;

    this.emitTransportCreated(socket, 'recv', transport);

    if (!roomId) {
      return;
    }

    for (const roomPeer of this.getRoomPeers(roomId)) {
      if (roomPeer.id === socket.id) {
        continue;
      }

      for (const producer of roomPeer.producers.values()) {
        this.emitNewProducer(socket, producer, roomPeer);
      }
    }
  }

  async connectTransport(
    socket: Socket,
    payload: SfuTransportConnectPayload,
  ): Promise<void> {
    const peer = this.getPeer(socket.id);
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
    const peer = this.getPeer(socket.id);
    const roomId = this.getRoomId(socket);

    const source: SfuMediaSource =
      (payload.appData?.source as SfuMediaSource) ?? 'camera';

    if (peer) {
      const required: CapabilityId =
        source === 'screen'
          ? 'send-screenshare'
          : payload.kind === 'audio'
            ? 'send-audio'
            : 'send-video';
      if (!peer.capabilities.includes(required)) {
        socket.emit('sfu:produce-error', {
          requestId: payload.requestId,
          code: 'PUBLISH_NOT_ALLOWED',
          message: `Missing ${required} capability`,
        });
        return;
      }
    }
    if (!peer?.sendTransport || !roomId) {
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
      const existingSharer = this.roomScreenShare.get(roomId);
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
      this.roomScreenShare.set(roomId, socket.id);
      for (const roomPeer of this.getRoomPeers(roomId)) {
        if (roomPeer.id !== socket.id) {
          roomPeer.socket.emit('sfu:screen-share-started', {
            userId: peer.userId,
          });
        }
      }
    }

    socket.emit('sfu:producer-created', {
      requestId,
      producerId: producer.id,
      userId: peer.userId,
      kind,
      appData: { source },
    });

    this.notifyPeersToConsume(socket, producer);

    this.notifyEgressTapHandlers(roomId, producer);
  }

  closeProducer(socketId: string, producerId: string): void {
    this.closeProducerForPeer(socketId, producerId);
  }

  listRoomProducers(roomId: string): EgressTapDescriptor[] {
    return this.getRoomPeers(roomId).flatMap((peer) =>
      Array.from(peer.producers.values(), (producer) => ({
        producerId: producer.id,
        kind: producer.kind,
        source: this.producerTapSource(producer),
      })),
    );
  }

  async createEgressTransport(roomId: string): Promise<PlainTransport> {
    const router = this.workerManager.getRouter(roomId);
    if (!router) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    return router.createPlainTransport(egressPlainTransportOptions);
  }

  async createEgressConsumer(
    roomId: string,
    transport: PlainTransport,
    producerId: string,
  ): Promise<{ consumer: Consumer; rtpParameters: RtpParameters }> {
    const router = this.workerManager.getRouter(roomId);
    if (!router) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
      appData: { egress: true },
    });
    return { consumer, rtpParameters: consumer.rtpParameters };
  }

  onRoomProducerAdded(
    roomId: string,
    handler: (descriptor: EgressTapDescriptor) => void,
  ): () => void {
    let handlers = this.egressTapHandlers.get(roomId);
    if (!handlers) {
      handlers = new Set();
      this.egressTapHandlers.set(roomId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  onRoomClosed(roomId: string, handler: () => void): () => void {
    let handlers = this.roomClosedHandlers.get(roomId);
    if (!handlers) {
      handlers = new Set();
      this.roomClosedHandlers.set(roomId, handlers);
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
    const peer = this.getPeer(socket.id);
    const roomId = this.getRoomId(socket);
    const router = roomId ? this.workerManager.getRouter(roomId) : undefined;

    if (!peer?.recvTransport || !router) {
      this.logger.error('Missing peer transport or router');
      return;
    }

    const { producerId, rtpCapabilities } = payload;

    let targetProducer: Producer | undefined;
    for (const [, p] of this.peers) {
      const prod = p.producers.get(producerId);
      if (prod) {
        targetProducer = prod;
        break;
      }
    }

    if (!targetProducer) {
      this.logger.error(`Producer ${producerId} not found`);
      return;
    }

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      this.logger.error('Cannot consume: RTP capabilities mismatch');
      return;
    }

    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);

    socket.emit('sfu:consumer-created', {
      consumerId: consumer.id,
      producerId,
      kind: targetProducer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }

  async resumeConsumer(socket: Socket, consumerId: string): Promise<void> {
    const peer = this.getPeer(socket.id);
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
    const peer = this.getPeer(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer || !peer) {
      this.logger.error(`Producer ${producerId} not found`);
      return;
    }
    await producer.pause();
    this.notifyProducerStateChanged(socket, producer, peer, true);
  }

  async resumeProducer(socket: Socket, producerId: string): Promise<void> {
    const peer = this.getPeer(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer || !peer) {
      this.logger.error(`Producer ${producerId} not found`);
      return;
    }
    await producer.resume();
    this.notifyProducerStateChanged(socket, producer, peer, false);
  }

  async kickPeer(
    socket: Socket,
    targetUserId: string,
  ): Promise<SfuHostActionAck> {
    const requester = this.getPeer(socket.id);
    const roomId = this.getRoomId(socket);

    if (!requester || !roomId) {
      this.logger.warn(`Kick request from unknown peer ${socket.id}`);
      return {
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'Join the room before using host controls',
      };
    }

    if (!requester.capabilities.includes('remove-participants')) {
      this.logger.warn(
        `Unauthorized kick request from ${requester.userId} in room ${roomId}`,
      );
      return {
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: 'Missing remove-participants capability',
      };
    }

    const targetPeer = this.getRoomPeers(roomId).find(
      (peer) => peer.userId === targetUserId,
    );
    if (!targetPeer || targetPeer.id === socket.id) {
      return {
        ok: false,
        code: 'TARGET_NOT_FOUND',
        message: `Participant ${targetUserId} is not in the room`,
      };
    }

    targetPeer.socket.emit('sfu:kicked', { roomId });
    // The acknowledgement lands only after teardown completes, so a resolved
    // kick promise is a usable ordering guarantee for consumer UIs.
    await this.removePeer(targetPeer.id, 'kick');
    targetPeer.socket.disconnect();
    return { ok: true };
  }

  /**
   * Guards a host-control action: the requester must hold a peer state in a
   * room and carry the capability the action enforces. Returns the
   * acknowledgement for denial, or null to proceed.
   */
  private denyHostAction(
    socket: Socket,
    capability: CapabilityId,
    action: string,
  ): SfuHostActionAck | null {
    const requester = this.getPeer(socket.id);
    const roomId = this.getRoomId(socket);

    if (!requester || !roomId) {
      this.logger.warn(`${action} request from unknown peer ${socket.id}`);
      return {
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'Join the room before using host controls',
      };
    }

    if (!requester.capabilities.includes(capability)) {
      this.logger.warn(
        `Unauthorized ${action} request from ${requester.userId} in room ${roomId}`,
      );
      return {
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: `Missing ${capability} capability`,
      };
    }

    return null;
  }

  async mutePeer(
    socket: Socket,
    targetUserId: string,
  ): Promise<SfuHostActionAck> {
    const denial = this.denyHostAction(socket, 'mute-users', 'mute');
    if (denial) return denial;
    const roomId = this.getRoomId(socket) as string;

    const targetPeer = this.getRoomPeers(roomId).find(
      (peer) => peer.userId === targetUserId,
    );
    if (!targetPeer || targetPeer.id === socket.id) {
      return {
        ok: false,
        code: 'TARGET_NOT_FOUND',
        message: `Participant ${targetUserId} is not in the room`,
      };
    }

    await this.muteRoomPeer(roomId, targetPeer);
    return { ok: true };
  }

  async muteAll(socket: Socket): Promise<SfuHostActionAck> {
    const denial = this.denyHostAction(socket, 'mute-users', 'mute-all');
    if (denial) return denial;
    const roomId = this.getRoomId(socket) as string;

    // Snapshot of the current publishers: peers that start publishing after
    // mute-all stay unmuted, and the requesting host is never muted.
    for (const peer of this.getRoomPeers(roomId)) {
      if (peer.id === socket.id || peer.producers.size === 0) {
        continue;
      }
      await this.muteRoomPeer(roomId, peer);
    }
    return { ok: true };
  }

  async lockRoom(socket: Socket, locked: boolean): Promise<SfuHostActionAck> {
    const denial = this.denyHostAction(socket, 'lock-room', 'lock');
    if (denial) return denial;
    const roomId = this.getRoomId(socket) as string;

    const nextLocked = Boolean(locked);
    if ((this.roomLocks.get(roomId) ?? false) === nextLocked) {
      // Idempotent: re-locking a locked room (or the reverse) is a success.
      return { ok: true };
    }
    this.roomLocks.set(roomId, nextLocked);
    for (const roomPeer of this.getRoomPeers(roomId)) {
      roomPeer.socket.emit('sfu:room-locked', { locked: nextLocked });
    }
    return { ok: true };
  }

  /**
   * Pause every producer owned by the target peer server-side and announce
   * the mute to the whole room, including the target, so it can surface its
   * muted-by-host state.
   */
  private async muteRoomPeer(roomId: string, target: Peer): Promise<void> {
    for (const producer of Array.from(target.producers.values())) {
      if (!producer.paused) {
        await producer.pause();
      }
    }
    for (const roomPeer of this.getRoomPeers(roomId)) {
      roomPeer.socket.emit('sfu:peer-muted', { userId: target.userId });
    }
  }

  async closePeer(socket: Socket): Promise<void> {
    await this.removePeer(socket.id, 'disconnect');
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
    const peer = this.getPeer(socket.id);
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
   * End a room: notify all peers with `sfu:room-ended`, clean up their
   * transports, and tear down the mediasoup Router.
   */
  async endRoom(roomId: string): Promise<void> {
    // A /v1 DELETE teardown must clear a lock even when the room has no SFU
    // peers left, so a recreated room can be joined again.
    this.roomLocks.delete(roomId);
    // Fire room-closed handlers up front so egress pipelines stop before any
    // teardown; removePeer's empty branch is a no-op afterwards.
    this.notifyRoomClosed(roomId);
    const roomSlug = this.findRoomSlug(roomId);
    const roomPeerIds = this.rooms.get(roomId);
    if (!roomPeerIds || roomPeerIds.size === 0) {
      this.logger.log(`No SFU peers in room ${roomId}, nothing to clean up`);
      this.webhooks.roomEnded(roomId, roomSlug);
      return;
    }

    // Notify every peer that the room has ended before tearing peers down.
    for (const peerId of Array.from(roomPeerIds)) {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.socket.emit('sfu:room-ended', { roomId });
      }
    }

    // Tear each peer down through the shared removePeer funnel so producers,
    // transports and screen-share state stay consistent with departures, and
    // webhook participant.left(room-end) events keep their emission order.
    for (const peerId of Array.from(roomPeerIds)) {
      await this.removePeer(peerId, 'room-end');
    }

    this.roomScreenShare.delete(roomId);
    this.webhooks.roomEnded(roomId, roomSlug);
    this.logger.log(`Room ${roomId} ended - all peers notified and cleaned up`);
  }

  private notifyProducerStateChanged(
    socket: Socket,
    producer: Producer,
    peer: Peer,
    paused: boolean,
  ): void {
    const roomId = this.getRoomId(socket);
    if (!roomId) return;

    const source = (producer.appData as Record<string, unknown> | undefined)
      ?.source as SfuMediaSource | undefined;

    for (const roomPeer of this.getRoomPeers(roomId)) {
      if (roomPeer.id !== socket.id) {
        roomPeer.socket.emit('sfu:producer-state-changed', {
          producerId: producer.id,
          kind: producer.kind,
          userId: peer.userId,
          paused,
          source,
        });
      }
    }
  }

  private notifyPeersToConsume(socket: Socket, producer: Producer): void {
    const roomId = this.getRoomId(socket);
    const peer = this.getPeer(socket.id);
    if (!roomId || !peer) return;

    for (const roomPeer of this.getRoomPeers(roomId)) {
      if (roomPeer.id !== socket.id && roomPeer.recvTransport) {
        this.emitNewProducer(roomPeer.socket, producer, peer);
      }
    }
  }

  private producerTapSource(producer: Producer): EgressTapSource {
    const appData = producer.appData as SfuProduceAppData | undefined;
    return appData?.source ?? 'camera';
  }

  private notifyEgressTapHandlers(roomId: string, producer: Producer): void {
    const handlers = this.egressTapHandlers.get(roomId);
    if (!handlers) return;

    const descriptor: EgressTapDescriptor = {
      producerId: producer.id,
      kind: producer.kind,
      source: this.producerTapSource(producer),
    };
    for (const handler of handlers) {
      handler(descriptor);
    }
  }

  private notifyRoomClosed(roomId: string): void {
    const handlers = this.roomClosedHandlers.get(roomId);
    if (!handlers) return;

    // Clear before firing: endRoom funnels through removePeer, so the
    // natural-empty branch must not notify a second time.
    this.roomClosedHandlers.delete(roomId);
    for (const handler of handlers) {
      handler();
    }
  }
}
