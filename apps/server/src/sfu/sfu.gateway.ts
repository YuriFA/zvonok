import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Server, Socket, Namespace } from 'socket.io';
import { SfuService } from './sfu.service';
import { ROOM_PRESENCE } from './room-presence.port';
import type { RoomPresence } from './room-presence.port';
import type {
  SfuJoinPayload,
  SfuTransportConnectPayload,
  SfuProducePayload,
  SfuConsumePayload,
  SfuResumeConsumerPayload,
  SfuKickPeerPayload,
  SfuMutePeerPayload,
  SfuLockRoomPayload,
  SfuSetPreferredLayersPayload,
  SfuCloseProducerPayload,
  SfuHostActionAck,
  SfuBroadcastAck,
  SfuBroadcastPayload,
} from './interfaces/sfu.interface';
import { OnGatewayInit } from '@nestjs/websockets';
import { SfuBroadcastService } from './sfu-broadcast.service';

@SkipThrottle()
@WebSocketGateway({
  cors: {
    // Any origin may connect: token-authenticated SDK clients come from
    // arbitrary origins. The /sfu namespace never authenticates via cookies
    // (identity comes from REST-issued payloads or verified room tokens), so
    // reflected-origin CORS here opens no cookie surface; cookie-bearing
    // surfaces (/chat gateway, REST) keep their strict CLIENT_URL CORS.
    origin: true,
    credentials: true,
  },
  namespace: '/sfu',
})
export class SfuGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SfuGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sfuService: SfuService,
    private readonly broadcastService: SfuBroadcastService,
    @Inject(ROOM_PRESENCE) private readonly presence: RoomPresence,
  ) {}

  afterInit(): void {
    this.logger.log('SFU Gateway initialized');
    // Hand the namespace to presence so room fan-out rides the socket.io
    // adapter (io.to(room)/except) instead of per-record socket loops.
    this.presence.attachServer(this.server);
  }

  handleConnection(client: Socket): void {
    this.logger.verbose(`SFU client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.verbose(`SFU client disconnected: ${client.id}`);
    await this.sfuService.closePeer(client);
  }

  @SubscribeMessage('sfu:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuJoinPayload,
  ): Promise<void> {
    this.logger.verbose(`SFU join request from ${client.id}`, { payload });
    await this.sfuService.joinRoom(client, payload);
  }

  @SubscribeMessage('sfu:leave')
  async handleLeave(@ConnectedSocket() client: Socket): Promise<void> {
    this.logger.verbose(`SFU leave request from ${client.id}`);
    await this.sfuService.leaveRoom(client);
  }

  @SubscribeMessage('sfu:create-send-transport')
  async handleCreateSendTransport(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    this.logger.verbose(`Creating send transport for ${client.id}`);
    await this.sfuService.createSendTransport(client);
  }

  @SubscribeMessage('sfu:create-recv-transport')
  async handleCreateRecvTransport(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    this.logger.verbose(`Creating recv transport for ${client.id}`);
    await this.sfuService.createRecvTransport(client);
  }

  @SubscribeMessage('sfu:connect-transport')
  async handleConnectTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuTransportConnectPayload,
  ): Promise<void> {
    this.logger.verbose(
      `Connecting transport ${payload.transportId} for ${client.id}`,
    );
    await this.sfuService.connectTransport(client, payload);
  }

  @SubscribeMessage('sfu:produce')
  async handleProduce(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuProducePayload,
  ): Promise<void> {
    this.logger.verbose(`Creating producer for ${client.id}`);
    await this.sfuService.createProducer(client, payload);
  }

  @SubscribeMessage('sfu:consume')
  async handleConsume(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuConsumePayload,
  ): Promise<void> {
    this.logger.verbose(`Creating consumer for ${client.id}`);
    await this.sfuService.createConsumer(client, payload);
  }

  @SubscribeMessage('sfu:resume-consumer')
  async handleResumeConsumer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuResumeConsumerPayload,
  ): Promise<void> {
    this.logger.verbose(
      `Resuming consumer ${payload.consumerId} for ${client.id}`,
    );
    await this.sfuService.resumeConsumer(client, payload.consumerId);
  }

  @SubscribeMessage('sfu:pause-producer')
  async handlePauseProducer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { producerId: string },
  ): Promise<void> {
    this.logger.verbose(
      `Pausing producer ${payload.producerId} for ${client.id}`,
    );
    await this.sfuService.pauseProducer(client, payload.producerId);
  }

  @SubscribeMessage('sfu:resume-producer')
  async handleResumeProducer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { producerId: string },
  ): Promise<void> {
    this.logger.verbose(
      `Resuming producer ${payload.producerId} for ${client.id}`,
    );
    await this.sfuService.resumeProducer(client, payload.producerId);
  }

  @SubscribeMessage('sfu:kick-peer')
  async handleKickPeer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuKickPeerPayload,
  ): Promise<SfuHostActionAck> {
    this.logger.verbose(
      `Kick peer ${payload.userId} requested by ${client.id}`,
    );
    return this.presence.kick(client.id, payload.userId);
  }

  @SubscribeMessage('sfu:mute-peer')
  async handleMutePeer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuMutePeerPayload,
  ): Promise<SfuHostActionAck> {
    this.logger.verbose(
      `Mute peer ${payload.userId} requested by ${client.id}`,
    );
    return this.sfuService.mutePeer(client, payload.userId);
  }

  @SubscribeMessage('sfu:mute-all')
  async handleMuteAll(
    @ConnectedSocket() client: Socket,
  ): Promise<SfuHostActionAck> {
    this.logger.verbose(`Mute all requested by ${client.id}`);
    return this.sfuService.muteAll(client);
  }

  @SubscribeMessage('sfu:lock-room')
  async handleLockRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuLockRoomPayload,
  ): Promise<SfuHostActionAck> {
    this.logger.verbose(
      `Lock room ${payload.locked} requested by ${client.id}`,
    );
    return this.presence.lockRoom(client.id, payload.locked);
  }

  @SubscribeMessage('sfu:broadcast')
  handleBroadcast(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuBroadcastPayload,
  ): SfuBroadcastAck {
    this.logger.verbose(
      `Broadcast on topic ${payload?.topic} requested by ${client.id}`,
    );
    return this.broadcastService.broadcast(client, payload);
  }

  @SubscribeMessage('sfu:set-preferred-layers')
  async handleSetPreferredLayers(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuSetPreferredLayersPayload,
  ): Promise<void> {
    this.logger.verbose(
      `Set preferred layers for consumer ${payload.consumerId} to spatial ${payload.spatialLayer} by ${client.id}`,
    );
    await this.sfuService.setPreferredLayers(
      client,
      payload.consumerId,
      payload.spatialLayer,
    );
  }

  @SubscribeMessage('sfu:close-producer')
  handleCloseProducer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SfuCloseProducerPayload,
  ): void {
    this.logger.verbose(
      `Closing producer ${payload.producerId} for ${client.id}`,
    );
    this.sfuService.closeProducer(client.id, payload.producerId);
  }

  getOwnerSocketId(roomSlug: string): string | null {
    return this.presence.ownerSocketId(roomSlug);
  }

  emitToSocket(socketId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    const socket = (this.server as unknown as Namespace).sockets.get(socketId);
    if (socket) {
      socket.emit(event, payload);
    }
  }
}
