jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PATH_METADATA } from '@nestjs/common/constants';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { GuestService } from './guest.service';
import { ROOM_PRESENCE } from '../sfu/room-presence.port';

describe('RoomController history endpoints', () => {
  let controller: RoomController;
  let roomService: {
    listCallHistory: jest.Mock;
    getCallRecord: jest.Mock;
    deleteCallRecord: jest.Mock;
  };

  beforeEach(async () => {
    roomService = {
      listCallHistory: jest.fn().mockResolvedValue([]),
      getCallRecord: jest.fn().mockResolvedValue({ id: 'record-1' }),
      deleteCallRecord: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RoomController],
      providers: [
        { provide: RoomService, useValue: roomService },
        { provide: GuestService, useValue: {} },
        { provide: ROOM_PRESENCE, useValue: { endRoom: jest.fn() } },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
      ],
    }).compile();

    controller = moduleRef.get(RoomController);
  });

  it('scopes the history list to the signed-in user', async () => {
    await controller.listCallHistory({ id: 'user-1' } as never);
    expect(roomService.listCallHistory).toHaveBeenCalledWith('user-1');
  });

  it('scopes the record detail to the signed-in user', async () => {
    await controller.getCallRecord({ id: 'user-1' } as never, 'record-1');
    expect(roomService.getCallRecord).toHaveBeenCalledWith(
      'user-1',
      'record-1',
    );
  });

  it('scopes deletion to the signed-in user', async () => {
    await controller.deleteCallRecord({ id: 'user-1' } as never, 'record-1');
    expect(roomService.deleteCallRecord).toHaveBeenCalledWith(
      'user-1',
      'record-1',
    );
  });

  it('declares the static history routes before the :slug lookup', () => {
    const prototype = RoomController.prototype as unknown as Record<
      string,
      unknown
    >;
    const declarationOrder = Object.getOwnPropertyNames(prototype);
    expect(declarationOrder.indexOf('listCallHistory')).toBeLessThan(
      declarationOrder.indexOf('getRoomBySlug'),
    );
    expect(Reflect.getMetadata(PATH_METADATA, controller.listCallHistory)).toBe(
      'history',
    );
    expect(Reflect.getMetadata(PATH_METADATA, controller.getRoomBySlug)).toBe(
      ':slug',
    );
  });
});
