import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RoomService } from 'src/room/room.service';
import { SfuService } from 'src/sfu/sfu.service';
import { EgressService } from 'src/egress/egress.service';
import { RoomTokenHelper } from './room-token.helper';
import type { Page } from './pagination.helper';
import type { RoomTokenClaims } from './room-token.helper';
import type {
  CreatePlatformRoomDto,
  MintRoomTokenDto,
  StartEgressDto,
} from './dto/platform.dto';
import type { EgressSessionView } from 'src/egress/egress.types';

@Injectable()
export class PlatformService {
  constructor(
    private readonly roomService: RoomService,
    private readonly sfuService: SfuService,
    private readonly roomTokenHelper: RoomTokenHelper,
    private readonly egressService: EgressService,
  ) {}

  createRoom(projectId: string, dto: CreatePlatformRoomDto) {
    return this.roomService.createProjectRoom(projectId, dto);
  }

  listRooms(projectId: string, page: { limit?: number; cursor?: string }) {
    return this.roomService.listProjectRooms(projectId, page);
  }

  async endRoom(projectId: string, roomId: string) {
    const room = await this.roomService.findProjectRoom(roomId, projectId);
    await this.roomService.softDeleteRoom(room.id);
    await this.sfuService.endRoom(room.id);
  }

  async mintRoomToken(
    projectId: string,
    keyId: string,
    roomId: string,
    dto: MintRoomTokenDto,
  ) {
    const room = await this.roomService.findProjectRoom(roomId, projectId);
    if (room.status !== 'active') {
      throw new BadRequestException('Room is not active');
    }

    const claims: RoomTokenClaims = {
      roomId: room.id,
      projectId,
      keyId,
      participantId: randomUUID(),
      name: dto.name ?? 'Participant',
      role: dto.role ?? 'participant',
      ...(dto.externalId !== undefined && { externalId: dto.externalId }),
      ...(dto.metadata !== undefined && { metadata: dto.metadata }),
    };

    return {
      token: this.roomTokenHelper.mint(claims),
      expiresAt: this.roomTokenHelper.expiresAt(),
    };
  }

  async startEgress(
    projectId: string,
    roomId: string,
    dto: StartEgressDto,
  ): Promise<EgressSessionView> {
    const room = await this.roomService.findProjectRoom(roomId, projectId);
    if (room.status !== 'active') {
      throw new BadRequestException('Room is not active');
    }
    return this.egressService.start(projectId, room.id, {
      rtmpEndpoints: dto.rtmpEndpoints ?? [],
      hls: dto.hls ?? false,
      record: dto.record ?? false,
    });
  }

  async listEgress(
    projectId: string,
    roomId: string,
    page: { limit?: number; cursor?: string },
  ): Promise<Page<EgressSessionView>> {
    const room = await this.roomService.findProjectRoom(roomId, projectId);
    return this.egressService.listForRoom(projectId, room.id, page);
  }

  getEgress(projectId: string, egressId: string): Promise<EgressSessionView> {
    return this.egressService.get(projectId, egressId);
  }

  stopEgress(projectId: string, egressId: string): Promise<EgressSessionView> {
    return this.egressService.stop(projectId, egressId);
  }
}
