import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.service';
import { RoomTokenHelper } from '../platform/room-token.helper';
import { resolveRoomSocketIdentity } from '../auth/helpers/room-socket-auth.helper';
import { capabilitiesForRole } from './capabilities';
import type {
  SfuHostActionAck,
  SfuJoinErrorCode,
  SfuJoinPayload,
} from './interfaces/sfu.interface';
import type {
  PeerContext,
  PresenceJoinOutcome,
  PresenceLeaveReason,
  RoomPresence,
} from './room-presence.port';

/** Presence-side record of a joined participant. Media-blind by design. */
interface PresenceRecord {
  socketId: string;
  roomId: string;
  userId: string;
  username: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  capabilities: PeerContext['capabilities'];
  ownsRoom?: boolean;
  socket: Socket;
}

/** Disconnect grace seat: identity held for the rejoin window. */
interface HeldSeat {
  roomId: string;
  socketId: string;
  participant: {
    id: string;
    displayName: string;
    externalId?: string;
    metadata?: Record<string, unknown>;
  };
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class RoomPresenceService implements OnModuleDestroy, RoomPresence {
  private readonly logger = new Logger(RoomPresenceService.name);
  private readonly records = new Map<string, PresenceRecord>();
  private readonly rooms = new Map<string, Set<string>>();
  private readonly roomOwners = new Map<string, string>();
  private readonly roomLocks = new Map<string, boolean>();
  private readonly slugToRoomId = new Map<string, string>();
  /** Reverse index of slugToRoomId: roomId -> its slugs. */
  private readonly roomIdToSlugs = new Map<string, Set<string>>();
  /** Reverse index of heldSeats: roomId -> seat keys held for it. */
  private readonly heldSeatsByRoom = new Map<string, Set<string>>();
  private readonly heldSeats = new Map<string, HeldSeat>();
  /** Gateway namespace, when attached: enables adapter-based fan-out. */
  private io: Server | null = null;
  private readonly kickedUsers = new Map<string, Set<string>>();
  private readonly roomClosedHandlers = new Map<string, Set<() => void>>();
  private readonly peerDetachHandlers = new Map<string, Set<() => void>>();

  /**
   * Grace window before a dropped peer's leave flow runs. Production
   * default 30s; mutable so tests can shrink it.
   */
  rejoinGraceMs = 30_000;

  constructor(
    private readonly roomTokenHelper: RoomTokenHelper,
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookDispatcher,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleDestroy(): void {
    for (const seat of this.heldSeats.values()) clearTimeout(seat.timer);
    this.heldSeats.clear();
    this.records.clear();
    this.rooms.clear();
    this.roomOwners.clear();
    this.slugToRoomId.clear();
    this.roomIdToSlugs.clear();
    this.heldSeatsByRoom.clear();
    this.io = null;
    this.kickedUsers.clear();
    this.roomClosedHandlers.clear();
    this.peerDetachHandlers.clear();
  }

  /** Observability seam: peers currently tracked across all rooms. */
  peerCount(): number {
    return this.records.size;
  }

  async join(
    socket: Socket,
    payload: SfuJoinPayload,
  ): Promise<PresenceJoinOutcome | null> {
    // A locked room refuses every new join before any peer state is created.
    if (this.roomLocks.get(payload.roomId)) {
      this.emitJoinError(socket, 'ROOM_LOCKED', 'Room is locked by the host');
      return null;
    }

    const { roomId, roomSlug } = payload;
    const record = payload.token
      ? await this.resolveTokenRecord(socket, payload)
      : await this.resolveHandshakeRecord(socket, payload);
    if (!record) {
      return null;
    }

    // A kicked participant is unrestorable for the room's lifetime: the
    // rejoin is refused with the kick denial regardless of the grace window.
    if (this.kickedUsers.get(roomId)?.has(record.userId)) {
      this.emitJoinError(
        socket,
        'KICKED_FROM_ROOM',
        'Removed from the room by the host',
      );
      return null;
    }

    // A same-id rejoin inside the grace window restores the held seat
    // silently: the room saw no departure, so it gets no arrival either.
    const restoredSeat = this.heldSeats.get(`${roomId}:${record.userId}`);
    if (restoredSeat) {
      clearTimeout(restoredSeat.timer);
      this.heldSeats.delete(`${roomId}:${record.userId}`);
      this.unindexHeldSeat(roomId, `${roomId}:${record.userId}`);
    }

    this.records.set(record.socketId, record);
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    const roomPeers = this.rooms.get(roomId);
    if (!roomPeers) {
      this.logger.error(`Failed to initialize room ${roomId}`);
      return null;
    }

    // A grace seat (the rejoiner's own or anyone else's) means the room never
    // emptied, so room.started must not fire again.
    const firstPeer = roomPeers.size === 0 && !this.roomHasHeldSeat(roomId);
    roomPeers.add(record.socketId);
    if (record.ownsRoom) {
      this.roomOwners.set(roomId, record.userId);
    }
    if (roomSlug) {
      this.slugToRoomId.set(roomSlug, roomId);
      const slugs = this.roomIdToSlugs.get(roomId);
      if (slugs) {
        slugs.add(roomSlug);
      } else {
        this.roomIdToSlugs.set(roomId, new Set([roomSlug]));
      }
    }
    this.logger.log(`Peer ${record.socketId} joined SFU room ${roomId}`);
    // Adapter rooms drive room fan-out (see broadcastToRoom); per-namespace,
    // so the /sfu and /chat rooms with the same id never collide.
    void socket.join(roomId);
    // Notify existing peers about the new peer - never for a silent restore
    if (!restoredSeat) {
      this.broadcastToRoom(
        roomId,
        'sfu:peer-joined',
        {
          userId: record.userId,
          username: record.username,
          externalId: record.externalId,
          metadata: record.metadata,
        },
        { excludeSocketId: socket.id },
      );
    }

    // Notify new peer about existing peers (even those without producers)
    const existingPeers = this.listPeerSockets(roomId)
      .filter((id) => id !== socket.id)
      .map((id) => this.records.get(id))
      .filter((p): p is PresenceRecord => p !== undefined)
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        externalId: p.externalId,
        metadata: p.metadata,
      }));

    if (existingPeers.length > 0) {
      socket.emit('sfu:existing-peers', existingPeers);
    }

    // Webhook emission is fire-and-forget and must never delay or break the
    // join path; ordering (room.started before participant.joined) is kept by
    // the dispatcher's per-project FIFO queue.
    if (firstPeer) {
      this.webhooks.roomStarted(roomId, roomSlug);
    }
    if (!restoredSeat) {
      this.webhooks.participantJoined(roomId, roomSlug, {
        id: record.userId,
        displayName: record.username,
        externalId: record.externalId,
        metadata: record.metadata,
      });
    }

    return {
      socketId: record.socketId,
      roomId,
      userId: record.userId,
      username: record.username,
      externalId: record.externalId,
      metadata: record.metadata,
      capabilities: record.capabilities,
      restoredSeat: restoredSeat !== undefined,
    };
  }

  async leave(socketId: string, reason: PresenceLeaveReason): Promise<void> {
    await this.depart(socketId, reason);
  }

  holdSeat(socketId: string): void {
    const record = this.records.get(socketId);
    const roomId = this.roomIdOf(socketId);
    if (!record || !roomId) {
      return;
    }

    const key = `${roomId}:${record.userId}`;
    const previous = this.heldSeats.get(key);
    if (previous) {
      clearTimeout(previous.timer);
    }
    const timer = setTimeout(() => {
      void this.expireHeldSeat(key);
    }, this.rejoinGraceMs);
    this.heldSeats.set(key, {
      roomId,
      socketId,
      participant: {
        id: record.userId,
        displayName: record.username,
        externalId: record.externalId,
        metadata: record.metadata,
      },
      timer,
    });

    this.detachPeer(socketId);
    this.logger.log(
      `Peer ${socketId} disconnected from room ${roomId}; seat held for ${this.rejoinGraceMs}ms`,
    );
    this.indexHeldSeat(roomId, key);
  }

  async kick(
    requesterSocketId: string,
    targetUserId: string,
  ): Promise<SfuHostActionAck> {
    const requester = this.records.get(requesterSocketId);
    const roomId = this.roomIdOf(requesterSocketId);

    if (!requester || !roomId) {
      this.logger.warn(`Kick request from unknown peer ${requesterSocketId}`);
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

    const target = this.listPeerSockets(roomId)
      .map((id) => this.records.get(id))
      .filter((r): r is PresenceRecord => r !== undefined)
      .find((r) => r.userId === targetUserId);
    if (!target || target.socketId === requesterSocketId) {
      return {
        ok: false,
        code: 'TARGET_NOT_FOUND',
        message: `Participant ${targetUserId} is not in the room`,
      };
    }

    const kicked = this.kickedUsers.get(roomId) ?? new Set<string>();
    kicked.add(target.userId);
    this.kickedUsers.set(roomId, kicked);

    target.socket.emit('sfu:kicked', { roomId });
    // The acknowledgement lands only after teardown completes, so a resolved
    // kick promise is a usable ordering guarantee for consumer UIs.
    await this.depart(target.socketId, 'kick');
    target.socket.disconnect();
    return { ok: true };
  }

  async lockRoom(
    requesterSocketId: string,
    locked: boolean,
  ): Promise<SfuHostActionAck> {
    const requester = this.records.get(requesterSocketId);
    const roomId = this.roomIdOf(requesterSocketId);

    if (!requester || !roomId) {
      return {
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'Join the room before using host controls',
      };
    }
    if (!requester.capabilities.includes('lock-room')) {
      this.logger.warn(
        `Unauthorized lock request from ${requester.userId} in room ${roomId}`,
      );
      return {
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: 'Missing lock-room capability',
      };
    }

    const nextLocked = Boolean(locked);
    if ((this.roomLocks.get(roomId) ?? false) === nextLocked) {
      // Idempotent: re-locking a locked room (or the reverse) is a success.
      return { ok: true };
    }
    this.roomLocks.set(roomId, nextLocked);
    this.broadcastToRoom(roomId, 'sfu:room-locked', { locked: nextLocked });
    return { ok: true };
  }

  async endRoom(roomId: string): Promise<void> {
    // A /v1 DELETE teardown must clear a lock even when the room has no SFU
    // peers left, so a recreated room can be joined again.
    this.roomLocks.delete(roomId);
    // The room's lifetime ends: grace seats lapse immediately and kicked
    // users stop being terminal (a recreated room is a fresh lifetime).
    for (const key of this.heldSeatsByRoom.get(roomId) ?? []) {
      const seat = this.heldSeats.get(key);
      if (seat) clearTimeout(seat.timer);
      this.heldSeats.delete(key);
    }
    this.heldSeatsByRoom.delete(roomId);
    this.kickedUsers.delete(roomId);
    // Fire room-closed handlers up front so egress pipelines stop before any
    // teardown; depart()'s empty branch is a no-op afterwards.
    this.notifyRoomClosed(roomId);
    const roomSlug = this.findRoomSlug(roomId);
    const roomPeerIds = this.rooms.get(roomId);
    if (!roomPeerIds || roomPeerIds.size === 0) {
      this.logger.log(`No SFU peers in room ${roomId}, nothing to clean up`);
      this.webhooks.roomEnded(roomId, roomSlug);
      return;
    }

    // Notify every peer that the room has ended before tearing peers down.
    this.broadcastToRoom(roomId, 'sfu:room-ended', { roomId });
    // Tear each peer down through the shared depart funnel so detach
    // handlers stay consistent with departures, and webhook
    // participant.left(room-end) events keep their emission order.
    for (const socketId of Array.from(roomPeerIds)) {
      await this.depart(socketId, 'room-end');
    }

    this.webhooks.roomEnded(roomId, roomSlug);
    this.logger.log(`Room ${roomId} ended - all peers notified and cleaned up`);
  }

  contextOf(socketId: string): PeerContext | null {
    const record = this.records.get(socketId);
    if (!record) return null;
    return {
      roomId: record.roomId,
      userId: record.userId,
      username: record.username,
      externalId: record.externalId,
      metadata: record.metadata,
      capabilities: record.capabilities,
    };
  }

  hasPeerInSlug(roomSlug: string, userId: string): boolean {
    const roomId = this.slugToRoomId.get(roomSlug);
    if (!roomId) return false;
    return this.listPeerSockets(roomId).some(
      (id) => this.records.get(id)?.userId === userId,
    );
  }

  ownerSocketId(roomSlug: string): string | null {
    const roomId = this.slugToRoomId.get(roomSlug);
    if (!roomId) return null;
    const ownerId = this.roomOwners.get(roomId);
    if (!ownerId) return null;
    for (const socketId of this.listPeerSockets(roomId)) {
      const record = this.records.get(socketId);
      if (record?.userId === ownerId) return socketId;
    }
    return null;
  }

  peerSocketInRoom(roomId: string, userId: string): string | null {
    for (const socketId of this.listPeerSockets(roomId)) {
      if (this.records.get(socketId)?.userId === userId) return socketId;
    }
    return null;
  }

  listPeerSockets(roomId: string): string[] {
    return Array.from(this.rooms.get(roomId) ?? []);
  }

  broadcastToRoom(
    roomId: string,
    event: string,
    payload: unknown,
    opts?: { excludeSocketId?: string },
  ): void {
    // Adapter fan-out when the namespace is attached (socket.io rooms are
    // joined at admission and left at detach); per-record loop otherwise.
    if (this.io) {
      const channel = this.io.to(roomId);
      if (opts?.excludeSocketId) {
        channel.except(opts.excludeSocketId).emit(event, payload);
      } else {
        channel.emit(event, payload);
      }
      return;
    }
    for (const socketId of this.listPeerSockets(roomId)) {
      if (socketId === opts?.excludeSocketId) continue;
      this.records.get(socketId)?.socket.emit(event, payload);
    }
  }

  emitToPeer(socketId: string, event: string, payload: unknown): void {
    this.records.get(socketId)?.socket.emit(event, payload);
  }

  onPeerDetach(socketId: string, handler: () => void): () => void {
    let handlers = this.peerDetachHandlers.get(socketId);
    if (!handlers) {
      handlers = new Set();
      this.peerDetachHandlers.set(socketId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
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
      handlers?.delete(handler);
    };
  }

  /** Media detachment + announcements + webhook for one departure. */
  private async depart(
    socketId: string,
    reason: PresenceLeaveReason,
  ): Promise<void> {
    const record = this.records.get(socketId);
    const roomId = this.roomIdOf(socketId);
    if (!record || !roomId) {
      return;
    }

    this.detachPeer(socketId);
    this.broadcastToRoom(
      roomId,
      'sfu:peer-left',
      { userId: record.userId },
      {
        excludeSocketId: socketId,
      },
    );
    this.webhooks.participantLeft(
      roomId,
      this.findRoomSlug(roomId),
      {
        id: record.userId,
        displayName: record.username,
        externalId: record.externalId,
        metadata: record.metadata,
      },
      reason,
    );

    await this.cleanupRoomIfEmpty(roomId);
  }

  /**
   * Runs the media-detach handlers for a socket and removes its presence
   * records. Handlers run before the departure is announced so the media
   * layer's own events keep their ordering.
   */
  private detachPeer(socketId: string): void {
    const handlers = this.peerDetachHandlers.get(socketId);
    // Clear before firing: departure is one-shot per socket.
    this.peerDetachHandlers.delete(socketId);
    if (handlers) {
      for (const handler of handlers) {
        handler();
      }
    }
    const record = this.records.get(socketId);
    const roomId = record?.roomId;
    this.records.delete(socketId);
    if (record && roomId) {
      this.rooms.get(roomId)?.delete(socketId);
      void record.socket.leave(roomId);
    }
  }

  /** Deferred disconnect leave flow: runs when the grace window lapses. */
  private async expireHeldSeat(key: string): Promise<void> {
    const seat = this.heldSeats.get(key);
    if (!seat) {
      return;
    }
    this.heldSeats.delete(key);
    this.unindexHeldSeat(seat.roomId, key);

    // The room may have ended (e.g. DELETE /v1) while the seat was held:
    // its lifetime already ran the leave flow for everyone.
    if (!this.rooms.has(seat.roomId)) {
      return;
    }

    this.broadcastToRoom(seat.roomId, 'sfu:peer-left', {
      userId: seat.participant.id,
    });
    this.webhooks.participantLeft(
      seat.roomId,
      this.findRoomSlug(seat.roomId),
      seat.participant,
      'disconnect',
    );
    await this.cleanupRoomIfEmpty(seat.roomId);
  }

  /** Runs the room-empty cleanup unless a grace seat still holds it alive. */
  private async cleanupRoomIfEmpty(roomId: string): Promise<void> {
    if ((this.rooms.get(roomId)?.size ?? 0) > 0) return;
    if (this.roomHasHeldSeat(roomId)) return;
    // Stop egress taps and media while the room is still resolvable.
    this.notifyRoomClosed(roomId);
    this.rooms.delete(roomId);
    this.roomOwners.delete(roomId);
    this.roomLocks.delete(roomId);
    // The room's lifetime ends here, so kicked-users terminality ends with it.
    this.kickedUsers.delete(roomId);
    for (const slug of this.roomIdToSlugs.get(roomId) ?? []) {
      this.slugToRoomId.delete(slug);
    }
    this.roomIdToSlugs.delete(roomId);
  }

  private roomHasHeldSeat(roomId: string): boolean {
    return (this.heldSeatsByRoom.get(roomId)?.size ?? 0) > 0;
  }

  private indexHeldSeat(roomId: string, key: string): void {
    const keys = this.heldSeatsByRoom.get(roomId);
    if (keys) {
      keys.add(key);
    } else {
      this.heldSeatsByRoom.set(roomId, new Set([key]));
    }
  }

  private unindexHeldSeat(roomId: string, key: string): void {
    const keys = this.heldSeatsByRoom.get(roomId);
    if (!keys) return;
    keys.delete(key);
    if (keys.size === 0) this.heldSeatsByRoom.delete(roomId);
  }

  private roomIdOf(socketId: string): string | undefined {
    // Records carry roomId. Post-detach lookups must capture the room
    // before the record is deleted; this getter never scans the rooms map.
    return this.records.get(socketId)?.roomId;
  }

  private findRoomSlug(roomId: string): string | undefined {
    for (const slug of this.roomIdToSlugs.get(roomId) ?? []) return slug;
    return undefined;
  }

  /** {@inheritdoc RoomPresence.attachServer} */
  attachServer(server: Server): void {
    this.io = server;
  }

  private notifyRoomClosed(roomId: string): void {
    const handlers = this.roomClosedHandlers.get(roomId);
    if (!handlers) return;

    // Clear before firing: endRoom funnels through depart, so the
    // natural-empty branch must not notify a second time.
    this.roomClosedHandlers.delete(roomId);
    for (const handler of handlers) {
      handler();
    }
  }

  /**
   * Resolves a join that presents a room token: verifies signature, expiry,
   * room match and minting-key state, then builds the record solely from the
   * verified claims. Returns null (after emitting a coded join error) on any
   * failure.
   */
  private async resolveTokenRecord(
    socket: Socket,
    payload: SfuJoinPayload,
  ): Promise<PresenceRecord | null> {
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
      socketId: socket.id,
      roomId: payload.roomId,
      userId: claims.participantId,
      username: claims.name,
      externalId: claims.externalId,
      metadata: claims.metadata,
      capabilities: capabilitiesForRole(claims.role),
      socket,
    };
  }

  /**
   * Resolves a join without a room token: derives the participant identity
   * from verified handshake credentials - a registered-user access JWT or an
   * approved-guest JWT - and grounds ownership in the room row. Client
   * payload identity fields are never trusted. Returns null (after emitting
   * a coded join error) when no credential verifies.
   */
  private async resolveHandshakeRecord(
    socket: Socket,
    payload: SfuJoinPayload,
  ): Promise<PresenceRecord | null> {
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
        socketId: socket.id,
        roomId: payload.roomId,
        userId: identity.guestId,
        username: identity.displayName,
        capabilities: capabilitiesForRole('participant'),
        socket,
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
      socketId: socket.id,
      roomId: payload.roomId,
      userId: identity.userId,
      username: user.username,
      ownsRoom: room.ownerId === identity.userId,
      capabilities: capabilitiesForRole(
        room.ownerId === identity.userId ? 'host' : 'participant',
      ),
      socket,
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
}
