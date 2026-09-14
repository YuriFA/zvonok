import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { ROOM_PRESENCE } from './room-presence.port';
import type { RoomPresence } from './room-presence.port';
import type {
  SfuBroadcastAck,
  SfuBroadcastMessage,
  SfuBroadcastPayload,
} from './interfaces/sfu.interface';

/** Serialized data-channel payload cap, measured on the wire. */
export const BROADCAST_PAYLOAD_MAX_BYTES = 8192;

/**
 * Data channel broadcast: validates capability, topic, and serialized
 * payload size, acknowledges on the requesting socket, and relays the
 * message to every other participant in the room. Ephemeral: nothing is
 * persisted and the sender never receives their own message back.
 */
@Injectable()
export class SfuBroadcastService {
  private readonly logger = new Logger(SfuBroadcastService.name);

  constructor(@Inject(ROOM_PRESENCE) private readonly presence: RoomPresence) {}

  broadcast(socket: Socket, payload: SfuBroadcastPayload): SfuBroadcastAck {
    const ctx = this.presence.contextOf(socket.id);

    if (!ctx) {
      this.logger.warn(`Broadcast request from unknown peer ${socket.id}`);
      return {
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'Join the room before broadcasting',
      };
    }

    if (!ctx.capabilities.includes('send-data-message')) {
      this.logger.warn(
        `Unauthorized broadcast request from ${ctx.userId} in room ${ctx.roomId}`,
      );
      return {
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: 'Missing send-data-message capability',
      };
    }

    if (
      typeof payload?.topic !== 'string' ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(payload.topic)
    ) {
      return {
        ok: false,
        code: 'INVALID_TOPIC',
        message: 'topic must be 1-64 characters of [A-Za-z0-9._-]',
      };
    }

    const serialized = JSON.stringify(payload?.payload);
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized, 'utf8') > BROADCAST_PAYLOAD_MAX_BYTES
    ) {
      return {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `payload must serialize to at most ${BROADCAST_PAYLOAD_MAX_BYTES} bytes`,
      };
    }

    const message: SfuBroadcastMessage = {
      senderId: ctx.userId,
      topic: payload.topic,
      payload: payload.payload,
      timestamp: new Date().toISOString(),
    };
    this.presence.broadcastToRoom(ctx.roomId, 'sfu:broadcast', message, {
      excludeSocketId: socket.id,
    });
    return { ok: true };
  }
}
