jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: {
    room: { findUnique: jest.Mock };
    message: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  const baseRoom = {
    id: 'room-1',
    name: 'Test Room',
    slug: 'abc123',
    ownerId: 'user-1',
    isPublic: true,
    maxParticipants: 10,
    status: 'active' as const,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    endedAt: null,
    lastActivityAt: null,
  };

  const baseMessage = {
    id: 'msg-1',
    content: 'Hello!',
    userId: 'user-1',
    guestId: null,
    roomId: 'room-1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    user: { id: 'user-1', username: 'john' },
  };

  const baseMessageNormalized = {
    id: 'msg-1',
    content: 'Hello!',
    userId: 'user-1',
    roomId: 'room-1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    user: { id: 'user-1', username: 'john' },
  };

  beforeEach(async () => {
    prisma = {
      room: { findUnique: jest.fn() },
      message: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('creates message and returns it with user data', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);
      prisma.message.create.mockResolvedValue(baseMessage);

      const result = await service.sendMessage('user-1', {
        content: 'Hello!',
        roomId: 'room-1',
      });

      expect(prisma.room.findUnique).toHaveBeenCalledWith({
        where: { id: 'room-1' },
      });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          content: 'Hello!',
          userId: 'user-1',
          roomId: 'room-1',
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
      expect(result).toEqual(baseMessage);
    });

    it('throws NotFoundException when room does not exist', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.sendMessage('user-1', {
          content: 'Hello!',
          roomId: 'nonexistent',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when room has ended', async () => {
      prisma.room.findUnique.mockResolvedValue({
        ...baseRoom,
        status: 'ended',
      });

      await expect(
        service.sendMessage('user-1', {
          content: 'Hello!',
          roomId: 'room-1',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it('returns paginated messages with user data', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);
      prisma.message.findMany.mockResolvedValue([baseMessage]);
      prisma.message.count.mockResolvedValue(1);

      const result = await service.getMessages('room-1', 1, 50);

      expect(result).toEqual({
        data: [baseMessageNormalized],
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
        },
      });
    });

    it('calculates pagination correctly for page 2', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(75);

      const result = await service.getMessages('room-1', 2, 50);

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 50,
          take: 50,
        }),
      );
      expect(result.meta).toEqual({
        page: 2,
        limit: 50,
        total: 75,
        totalPages: 2,
      });
    });

    it('uses default page=1 and limit=50', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      const result = await service.getMessages('room-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 50,
        }),
      );
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
    });

    it('throws NotFoundException when room does not exist', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(service.getMessages('nonexistent')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('orders messages by createdAt ascending', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.count.mockResolvedValue(0);

      await service.getMessages('room-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
        }),
      );
    });
  });

  describe('saveGuestMessage', () => {
    it('persists a guest message with guest fields only', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);
      prisma.message.create.mockResolvedValue({ id: 'msg-9' });

      await service.saveGuestMessage(
        'guest-1',
        'Guest Name',
        'Hi there',
        'room-1',
        'abc123',
      );

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { content: 'Hi there', guestId: 'guest-1', roomId: 'room-1' },
        }),
      );
    });

    it('throws Forbidden for a slug mismatch and never creates', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);

      await expect(
        service.saveGuestMessage(
          'guest-1',
          'Guest Name',
          'Hi',
          'room-1',
          'other-slug',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('throws Forbidden for a missing room so existence cannot be probed', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.saveGuestMessage(
          'guest-1',
          'Guest Name',
          'Hi',
          'nonexistent',
          'abc123',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the room has ended', async () => {
      prisma.room.findUnique.mockResolvedValue({
        ...baseRoom,
        status: 'ended',
      });

      await expect(
        service.saveGuestMessage(
          'guest-1',
          'Guest Name',
          'Hi',
          'room-1',
          'abc123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMessages for a room-bound guest', () => {
    it('hides foreign rooms behind the same not-found error', async () => {
      prisma.room.findUnique.mockResolvedValue(baseRoom);

      await expect(
        service.getMessages('room-1', 1, 50, 'other-slug'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });
  });
});
