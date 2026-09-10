import {
  SubscribeMessage,
  WebSocketGateway,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Socket } from 'socket.io';
import { PrismaService } from 'src/prisma/prisma.service';
import { SfuService } from 'src/sfu/sfu.service';
import { EgressService } from './egress.service';
import type { EgressActionAck, EgressActionErrorCode } from './egress.types';

/**
 * Client-initiated egress control on the /sfu namespace. The browser holds
 * a room token, not the project API key, so /v1 is unreachable; these
 * acknowledged events are the in-room front door to the same egress
 * session machinery. RTMP endpoints are not specifiable here - push URLs
 * from a browser are an SSRF boundary and stay server-side via /v1.
 */
@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  namespace: '/sfu',
})
export class EgressSignalGateway {
  private readonly logger = new Logger(EgressSignalGateway.name);

  constructor(
    private readonly sfu: SfuService,
    private readonly egress: EgressService,
    private readonly prisma: PrismaService,
  ) {}

  @SubscribeMessage('egress:start')
  async handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { record?: unknown; hls?: unknown },
  ): Promise<EgressActionAck> {
    const peer = this.sfu.describeSocket(client.id);
    if (!peer) {
      return deny('NOT_IN_ROOM', 'Join the room before controlling egress');
    }

    const record = payload?.record === true;
    const hls = payload?.hls === true;
    if (!record && !hls) {
      return deny(
        'INVALID_OUTPUTS',
        'At least one output (record, hls) is required',
      );
    }
    if (record && !peer.capabilities.includes('start-recording')) {
      return deny('MISSING_CAPABILITY', 'Missing start-recording capability');
    }
    if (hls && !peer.capabilities.includes('start-broadcast')) {
      return deny('MISSING_CAPABILITY', 'Missing start-broadcast capability');
    }

    const room = await this.prisma.room.findUnique({
      where: { id: peer.roomId },
      select: { projectId: true, status: true },
    });
    if (!room?.projectId) {
      return deny(
        'NOT_PROJECT_ROOM',
        'Egress is available for project rooms only',
      );
    }

    try {
      await this.egress.start(room.projectId, peer.roomId, {
        rtmpEndpoints: [],
        hls,
        record,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        return deny('ALREADY_ACTIVE', 'Egress already active for this room');
      }
      if (error instanceof BadRequestException) {
        return deny(
          'INVALID_OUTPUTS',
          'The server refused the requested outputs',
        );
      }
      if (error instanceof NotFoundException) {
        return deny('NOT_PROJECT_ROOM', 'Room not found');
      }
      this.logger.error(
        `Client egress start failed for room ${peer.roomId}: ${String(error)}`,
      );
      return deny('EGRESS_UNAVAILABLE', 'Egress could not be started');
    }
    return { ok: true };
  }

  @SubscribeMessage('egress:stop')
  async handleStop(
    @ConnectedSocket() client: Socket,
  ): Promise<EgressActionAck> {
    const peer = this.sfu.describeSocket(client.id);
    if (!peer) {
      return deny('NOT_IN_ROOM', 'Join the room before controlling egress');
    }
    const mayControl =
      peer.capabilities.includes('start-recording') ||
      peer.capabilities.includes('start-broadcast');
    if (!mayControl) {
      return deny('MISSING_CAPABILITY', 'Missing egress control capability');
    }

    const room = await this.prisma.room.findUnique({
      where: { id: peer.roomId },
      select: { projectId: true },
    });
    if (!room?.projectId) {
      return deny(
        'NOT_PROJECT_ROOM',
        'Egress is available for project rooms only',
      );
    }

    const active = await this.prisma.egress.findFirst({
      where: {
        roomId: peer.roomId,
        status: { in: ['starting', 'live', 'stopping'] },
      },
      select: { id: true },
    });
    if (!active) {
      return deny('NOT_ACTIVE', 'No active egress session in this room');
    }

    try {
      await this.egress.stop(room.projectId, active.id);
    } catch (error) {
      if (error instanceof ConflictException) {
        return deny('NOT_ACTIVE', 'Egress session is not active');
      }
      this.logger.error(
        `Client egress stop failed for room ${peer.roomId}: ${String(error)}`,
      );
      return deny('EGRESS_UNAVAILABLE', 'Egress could not be stopped');
    }
    return { ok: true };
  }
}

function deny(code: EgressActionErrorCode, message: string): EgressActionAck {
  return { ok: false, code, message };
}
