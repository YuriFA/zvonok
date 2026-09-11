import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, Room } from '../generated/prisma/client';
import { paginate } from '../platform/pagination.helper';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(private prisma: PrismaService) {}

  async createRoom(ownerId: string, dto: CreateRoomDto) {
    const slug = await this.generateUniqueSlug();
    return this.prisma.room.create({
      data: {
        name: dto.name,
        slug,
        ownerId,
        maxParticipants: dto.maxParticipants ?? 10,
      },
    });
  }

  async createProjectRoom(projectId: string, dto: CreateRoomDto) {
    const slug = await this.generateUniqueSlug();
    return this.prisma.room.create({
      data: {
        name: dto.name,
        slug,
        projectId,
        maxParticipants: dto.maxParticipants ?? 10,
      },
    });
  }

  async listProjectRooms(
    projectId: string,
    page: { limit?: number; cursor?: string } = {},
  ) {
    const result = await paginate<Room>({
      limit: page.limit,
      cursor: page.cursor,
      orderKey: 'createdAt',
      scope: { projectId },
      findPage: (query) =>
        // Generated Prisma arg types cannot express the dynamic order key.
        this.prisma.room.findMany(query as unknown as Prisma.RoomFindManyArgs),
    });
    return result;
  }

  async findProjectRoom(id: string, projectId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id, projectId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }

  async findBySlug(slug: string) {
    const room = await this.prisma.room.findUnique({ where: { slug } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }

  async findById(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }

  async updateRoom(id: string, dto: UpdateRoomDto) {
    return this.prisma.room.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * End a room. For user-owned rooms the snapshot of the call into the
   * owner's history is committed in the same transaction as the end: the
   * record must never exist for a room that did not end, and the transcript
   * must match the room's final state exactly. Project-owned rooms perform
   * the single status update - there is no second write to couple.
   */
  async softDeleteRoom(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { username: true } } },
        },
      },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    const endedAt = new Date();
    const end = { status: 'ended' as const, endedAt };
    if (!room.ownerId) {
      return this.prisma.room.update({ where: { id }, data: end });
    }
    const ownerId: string = room.ownerId;
    return this.prisma.$transaction(async (tx) => {
      const messages = room.messages.map((message) => ({
        author: message.user?.username ?? 'Guest',
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      }));
      const updated = await tx.room.update({ where: { id }, data: end });
      await tx.callRecord.create({
        data: {
          ownerId,
          roomName: room.name ?? room.slug,
          roomSlug: room.slug,
          startedAt: room.createdAt,
          endedAt,
          messageCount: messages.length,
          messages,
        },
      });
      return updated;
    });
  }

  /** The owner's past calls, newest first, transcripts excluded. */
  listCallHistory(ownerId: string) {
    return this.prisma.callRecord.findMany({
      where: { ownerId },
      orderBy: { endedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        roomName: true,
        roomSlug: true,
        startedAt: true,
        endedAt: true,
        messageCount: true,
      },
    });
  }

  async getCallRecord(ownerId: string, id: string) {
    const record = await this.prisma.callRecord.findUnique({
      where: { id },
    });
    if (!record || record.ownerId !== ownerId) {
      throw new NotFoundException('Call record not found');
    }
    return record;
  }

  async deleteCallRecord(ownerId: string, id: string): Promise<void> {
    await this.getCallRecord(ownerId, id);
    await this.prisma.callRecord.delete({ where: { id } });
  }

  private generateSlug(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let slug = '';
    for (let i = 0; i < 6; i++) {
      slug += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return slug;
  }

  private async generateUniqueSlug(): Promise<string> {
    let slug = this.generateSlug();
    let attempts = 0;
    while (await this.prisma.room.findUnique({ where: { slug } })) {
      if (attempts++ >= 10) {
        slug = this.generateSlug() + Date.now().toString(36);
        break;
      }
      slug = this.generateSlug();
    }
    return slug;
  }
}
