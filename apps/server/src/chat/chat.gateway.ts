import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ConfigService } from '@nestjs/config';
import {
  resolveRoomSocketIdentity,
  RoomSocketIdentity,
} from '../auth/helpers/room-socket-auth.helper';
@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(): void {
    this.logger.log('Chat Gateway initialized');
  }

  handleConnection(client: Socket): void {
    const identity = this.authenticate(client);
    if (!identity) {
      this.logger.warn(`Chat client disconnected (auth failed): ${client.id}`);
      client.disconnect(true);
      return;
    }
    (client.data as Record<string, unknown>).identity = identity;
    const label =
      identity.type === 'user'
        ? `user:${identity.userId}`
        : `guest:${identity.guestId} (${identity.displayName})`;
    this.logger.log(`Chat client connected: ${client.id} (${label})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageDto,
  ): Promise<void> {
    const identity = (client.data as Record<string, unknown>)
      .identity as RoomSocketIdentity;

    if (identity.type === 'guest') {
      try {
        const saved = await this.chatService.saveGuestMessage(
          identity.guestId,
          identity.displayName,
          payload.content,
          payload.roomId,
          identity.roomSlug,
        );
        const message = {
          id: saved.id,
          content: saved.content,
          userId: identity.guestId,
          roomId: saved.roomId,
          createdAt: saved.createdAt.toISOString(),
          isGuest: true,
          user: { id: identity.guestId, username: identity.displayName },
        };
        await client.join(payload.roomId);
        this.server.to(payload.roomId).emit('chat:message', message);
      } catch (err) {
        client.emit('chat:error', {
          event: 'chat:send',
          message:
            err instanceof Error ? err.message : 'Failed to send message',
        });
      }
      return;
    }

    try {
      const message = await this.chatService.sendMessage(
        identity.userId,
        payload,
      );
      await client.join(payload.roomId);
      this.server.to(payload.roomId).emit('chat:message', message);
    } catch (err) {
      client.emit('chat:error', {
        event: 'chat:send',
        message: err instanceof Error ? err.message : 'Failed to send message',
      });
    }
  }

  @SubscribeMessage('chat:history')
  async handleHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() { roomId }: { roomId: string },
  ) {
    const identity = (client.data as Record<string, unknown>)
      .identity as RoomSocketIdentity;
    try {
      const result = await this.chatService.getMessages(
        roomId,
        1,
        50,
        identity.type === 'guest' ? identity.roomSlug : undefined,
      );
      await client.join(roomId);
      return result;
    } catch (err) {
      client.emit('chat:error', {
        event: 'chat:history',
        message: err instanceof Error ? err.message : 'Failed to load history',
      });
      return;
    }
  }

  private authenticate(client: Socket): RoomSocketIdentity | null {
    return resolveRoomSocketIdentity(
      client,
      this.jwtService,
      this.configService,
    );
  }
}
