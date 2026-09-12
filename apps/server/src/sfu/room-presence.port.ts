import type { Socket } from 'socket.io';
import type { CapabilityId } from './capabilities';
import type {
  SfuHostActionAck,
  SfuJoinPayload,
} from './interfaces/sfu.interface';

/** DI token for the Room Presence port. */
export const ROOM_PRESENCE = Symbol('ROOM_PRESENCE');

/** Verified identity of a connected participant, minus any media state. */
export interface PresenceParticipant {
  userId: string;
  username: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: Record<string, unknown>;
}

/** Room context of a connected socket, as seen through presence only. */
export interface PeerContext extends PresenceParticipant {
  roomId: string;
  /** Effective capabilities resolved by the server from the verified
   * credential path; never read from client-supplied payload fields. */
  capabilities: CapabilityId[];
}

/** What the media layer receives after presence admits a join. */
export interface PresenceJoinOutcome extends PeerContext {
  socketId: string;
  /** True when a grace seat was restored: the room never saw a departure,
   * so it gets no arrival announcement or webhook either. */
  restoredSeat: boolean;
}

/** Why a participant left; maps onto webhook leave reasons. */
export type PresenceLeaveReason = 'leave' | 'kick' | 'room-end' | 'disconnect';

/**
 * Room Presence port: participants, admission through the verified identity
 * paths, kick terminality, disconnect grace, room lock, and room lifetime.
 * Media-blind by design - transports, producers and consumers never cross
 * this seam; the media layer subscribes to detach/room-closed instead.
 */
export interface RoomPresence {
  /**
   * Admit a join: resolve identity (room token claims, verified session or
   * approved-guest cookie), enforce lock and kick terminality, restore a
   * grace seat, register membership, announce arrival. Emits coded join
   * errors on the socket and returns null when the join is refused.
   */
  join(
    socket: Socket,
    payload: SfuJoinPayload,
  ): Promise<PresenceJoinOutcome | null>;

  /** Run the departure flow for a joined socket (announcements, webhook). */
  leave(socketId: string, reason: PresenceLeaveReason): Promise<void>;

  /**
   * Hold the participant's seat for the grace window after a socket drop.
   * Media detaches immediately through {@link onPeerDetach}; announcements
   * and the webhook run only when the window lapses unrestored.
   */
  holdSeat(socketId: string): void;

  /** Host control: remove a participant; terminal for the room's lifetime. */
  kick(
    requesterSocketId: string,
    targetUserId: string,
  ): Promise<SfuHostActionAck>;

  /** Host control: lock or unlock the room against new joins. */
  lockRoom(
    requesterSocketId: string,
    locked: boolean,
  ): Promise<SfuHostActionAck>;

  /** End the room: refuse seats, announce, webhooks, lifetime teardown. */
  endRoom(roomId: string): Promise<void>;

  /** Room context of a socket, or null when the socket never joined. */
  contextOf(socketId: string): PeerContext | null;

  /** True when a verified user holds membership in the room behind a slug. */
  hasPeerInSlug(roomSlug: string, userId: string): boolean;

  /** Live socket of the room owner behind a slug, for guest-approval flow. */
  ownerSocketId(roomSlug: string): string | null;

  /** Socket of a room member by verified user id, for targeted actions. */
  peerSocketInRoom(roomId: string, userId: string): string | null;

  /** Socket ids of every current member of the room. */
  listPeerSockets(roomId: string): string[];

  /** Emit to every member's socket, optionally excluding one. */
  broadcastToRoom(
    roomId: string,
    event: string,
    payload: unknown,
    opts?: { excludeSocketId?: string },
  ): void;

  /** Emit to one member's socket; no-op for unknown sockets. */
  emitToPeer(socketId: string, event: string, payload: unknown): void;

  /**
   * Subscribe to immediate media detachment for a socket: fired when the
   * participant departs or their seat-hold begins, BEFORE the departure is
   * announced. Returns the unsubscribe function.
   */
  onPeerDetach(socketId: string, handler: () => void): () => void;

  /**
   * Subscribe to room lifetime end: fired once while room state is still
   * resolvable, before presence deletes the room. Returns the unsubscribe
   * function.
   */
  onRoomClosed(roomId: string, handler: () => void): () => void;

  /** Grace window before a dropped peer's departure flow runs. */
  rejoinGraceMs: number;
}
