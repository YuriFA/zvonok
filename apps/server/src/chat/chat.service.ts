import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async sendMessage(userId: string, dto: SendMessageDto) {
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    if (room.status === 'ended') {
      throw new BadRequestException('Room has ended');
    }

    return this.prisma.message.create({
      data: {
        content: dto.content,
        userId,
        roomId: dto.roomId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
  }

  async saveGuestMessage(
    guestId: string,
    displayName: string,
    content: string,
    roomId: string,
    /** Guest tokens are room-bound: the expected slug comes from the
     * verified identity, never from the client payload. */
    expectedSlug?: string,
  ) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    // "Not found" and "not yours" are indistinguishable for guests, so
    // existence probing cannot leak valid room ids.
    if (!room || (expectedSlug !== undefined && room.slug !== expectedSlug)) {
      throw new ForbiddenException('Forbidden');
    }
    if (room.status === 'ended') {
      throw new BadRequestException('Room has ended');
    }
    return this.prisma.message.create({
      data: {
        content,
        guestId,
        roomId,
      },
      select: {
        id: true,
        content: true,
        guestId: true,
        roomId: true,
        createdAt: true,
      },
    });
  }

  async getMessages(
    roomId: string,
    page: number = 1,
    limit: number = 50,
    /** Room-bound guest identity: same opaque-Forbidden rule as sending. */
    expectedSlug?: string,
  ) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });
    if (!room || (expectedSlug !== undefined && room.slug !== expectedSlug)) {
      throw new NotFoundException('Room not found');
    }

    const skip = (page - 1) * limit;

    const [rawMessages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { roomId },
        select: {
          id: true,
          content: true,
          userId: true,
          guestId: true,
          roomId: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where: { roomId } }),
    ]);

    // Normalise guest messages: expose guestId as userId and provide a user shape
    const messages = rawMessages.map((m) => {
      if (m.guestId != null) {
        return {
          id: m.id,
          content: m.content,
          userId: m.guestId,
          roomId: m.roomId,
          createdAt: m.createdAt,
          isGuest: true as const,
          user: { id: m.guestId, username: 'Guest' },
        };
      }
      return {
        id: m.id,
        content: m.content,
        userId: m.userId,
        roomId: m.roomId,
        createdAt: m.createdAt,
        user: m.user,
      };
    });

    return {
      data: messages,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
