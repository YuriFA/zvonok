import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import * as Y from 'yjs';

import {
  resolveRoomSocketIdentity,
  RoomSocketIdentity,
} from 'src/auth/helpers/room-socket-auth.helper';
import { RoomService } from 'src/room/room.service';
import { Inject } from '@nestjs/common';
import { ROOM_PRESENCE } from 'src/sfu/room-presence.port';
import type { RoomPresence } from 'src/sfu/room-presence.port';
import { WhiteboardService } from './whiteboard.service';
import type {
  WhiteboardJoinPayload,
  WhiteboardModePayload,
  WhiteboardUpdatePayload,
} from './whiteboard.types';

interface WhiteboardAdmission {
  roomId: string;
  roomSlug: string;
  isOwner: boolean;
}

@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/whiteboard',
})
export class WhiteboardGateway implements OnGatewayConnection {
  private readonly logger = new Logger(WhiteboardGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly whiteboardService: WhiteboardService,
    private readonly roomService: RoomService,
    @Inject(ROOM_PRESENCE) private readonly presence: RoomPresence,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket): void {
    const identity = resolveRoomSocketIdentity(
      client,
      this.jwtService,
      this.configService,
    );
    if (!identity) {
      this.logger.warn(
        `Whiteboard client rejected (auth failed): ${client.id}`,
      );
      client.disconnect(true);
      return;
    }
    (client.data as Record<string, unknown>).identity = identity;
  }

  @SubscribeMessage('whiteboard:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WhiteboardJoinPayload,
  ): Promise<void> {
    const identity = this.identityOf(client);
    if (!identity || typeof payload?.roomSlug !== 'string') return;

    const room = await this.resolveRoom(payload.roomSlug);
    if (!room) {
      client.emit('whiteboard:error', {
        event: 'whiteboard:join',
        message: 'Forbidden',
      });
      return;
    }

    if (identity.type === 'guest' && identity.roomSlug !== payload.roomSlug) {
      client.emit('whiteboard:error', {
        event: 'whiteboard:join',
        message: 'Forbidden',
      });
      return;
    }

    if (
      identity.type === 'user' &&
      !this.presence.hasPeerInSlug(payload.roomSlug, identity.userId)
    ) {
      client.emit('whiteboard:error', {
        event: 'whiteboard:join',
        message: 'Forbidden',
      });
      return;
    }

    const admission: WhiteboardAdmission = {
      roomId: room.id,
      roomSlug: room.slug,
      isOwner: identity.type === 'user' && room.ownerId === identity.userId,
    };
    (client.data as Record<string, unknown>).admission = admission;
    await client.join(admission.roomId);
    // The server holds the authoritative document: late joiners receive the
    // full state immediately, then live updates as they are merged.
    const board = this.whiteboardService.getBoard(admission.roomId);
    client.emit('whiteboard:state', {
      roomSlug: admission.roomSlug,
      update: Y.encodeStateAsUpdate(board.doc),
    });
    client.emit('whiteboard:mode', {
      roomSlug: admission.roomSlug,
      mode: board.mode,
    });
  }

  @SubscribeMessage('whiteboard:update')
  async handleUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WhiteboardUpdatePayload,
  ): Promise<void> {
    const admission = this.admissionOf(client);
    if (!admission || payload?.roomSlug !== admission.roomSlug) return;

    // Defense in depth: the client already renders read-only when locked.
    const { mode } = this.whiteboardService.getBoard(admission.roomId);
    if (mode !== 'open' && !admission.isOwner) return;

    const update = payload?.update;
    if (!(update instanceof Uint8Array) || update.byteLength === 0) return;

    const result = this.whiteboardService.applyUpdate(admission.roomId, update);
    if (result !== 'applied') {
      client.emit('whiteboard:error', {
        event: 'whiteboard:update',
        message:
          result === 'too-large'
            ? 'Board update too large'
            : 'Board update rejected',
      });
      return;
    }

    // Relay to everyone else in the room; the sender already applied it.
    client.to(admission.roomId).emit('whiteboard:update', {
      roomSlug: admission.roomSlug,
      update,
    });
  }

  @SubscribeMessage('whiteboard:mode')
  async handleMode(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: WhiteboardModePayload,
  ): Promise<void> {
    const identity = this.identityOf(client);
    const admission = this.admissionOf(client);
    if (
      !identity ||
      !admission ||
      identity.type !== 'user' ||
      payload?.roomSlug !== admission.roomSlug ||
      (payload?.mode !== 'owner' && payload?.mode !== 'open')
    ) {
      return;
    }

    // Re-verify ownership against current room state, not the cached join.
    const room = await this.resolveRoom(admission.roomSlug);
    if (!room || room.ownerId !== identity.userId) return;

    const mode = this.whiteboardService.setMode(admission.roomId, payload.mode);
    this.server.to(admission.roomId).emit('whiteboard:mode', {
      roomSlug: admission.roomSlug,
      mode,
    });
  }

  private identityOf(client: Socket): RoomSocketIdentity | null {
    return (
      ((client.data as Record<string, unknown>).identity as
        | RoomSocketIdentity
        | undefined) ?? null
    );
  }

  private admissionOf(client: Socket): WhiteboardAdmission | null {
    return (
      ((client.data as Record<string, unknown>).admission as
        | WhiteboardAdmission
        | undefined) ?? null
    );
  }
  /** Resolve an active room by slug; missing and ended rooms both reject. */
  private async resolveRoom(slug: string) {
    try {
      const room = await this.roomService.findBySlug(slug);
      return room.status === 'ended' ? null : room;
    } catch {
      return null;
    }
  }
}
