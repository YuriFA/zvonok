jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RoomTokenHelper } from './room-token.helper';
import type { RoomTokenClaims } from './room-token.helper';
import { PlatformService } from './platform.service';
import { MintRoomTokenDto } from './dto/platform.dto';
import { RoomService } from 'src/room/room.service';
import { SfuService } from 'src/sfu/sfu.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ExecutionContext } from '@nestjs/common';

const ROOM_SECRET = 'test-room-secret';

function makeConfig() {
  return {
    get: (key: string) =>
      key === 'JWT_ROOM_SECRET'
        ? ROOM_SECRET
        : key === 'ROOM_TOKEN_TTL_MINUTES'
          ? '60'
          : undefined,
  } as never;
}

describe('RoomTokenHelper', () => {
  let helper: RoomTokenHelper;

  beforeEach(() => {
    helper = new RoomTokenHelper(
      new JwtService({ secret: ROOM_SECRET }),
      makeConfig(),
    );
  });

  it('round-trips claims through mint and verify', () => {
    const claims: RoomTokenClaims = {
      roomId: 'room-1',
      projectId: 'project-1',
      keyId: 'key-1',
      participantId: 'participant-1',
      name: 'Alice',
      role: 'host',
    };

    const result = helper.verify(helper.mint(claims));

    expect(result).toEqual({ ok: true, claims });
  });

  it('round-trips correlation fields verbatim and keeps them absent when omitted', () => {
    const base: RoomTokenClaims = {
      roomId: 'room-1',
      projectId: 'project-1',
      keyId: 'key-1',
      participantId: 'participant-1',
      name: 'Alice',
      role: 'participant',
    };
    const metadata = {
      tenant: 'acme',
      avatar: 'https://cdn.example.com/a.png',
    };

    const withFields = helper.verify(
      helper.mint({ ...base, externalId: 'user-42', metadata }),
    );
    expect(withFields).toEqual({
      ok: true,
      claims: { ...base, externalId: 'user-42', metadata },
    });
    const withoutFields = helper.verify(helper.mint(base));
    expect(withoutFields).toEqual({ ok: true, claims: base });
    if (withoutFields.ok) {
      expect('externalId' in withoutFields.claims).toBe(false);
      expect('metadata' in withoutFields.claims).toBe(false);
    }
  });

  it('reports expired tokens with a distinct code', () => {
    const jwt = new JwtService({ secret: ROOM_SECRET });
    const expired = jwt.sign(
      {
        projectId: 'p',
        keyId: 'k',
        participantId: 'pa',
        name: 'n',
        publish: true,
        admin: false,
      },
      { subject: 'room-1', secret: ROOM_SECRET, expiresIn: '-10s' },
    );

    expect(helper.verify(expired)).toEqual({
      ok: false,
      code: 'ROOM_TOKEN_EXPIRED',
    });
  });

  it('rejects garbage and wrong-secret tokens as invalid', () => {
    expect(helper.verify('not-a-jwt')).toEqual({
      ok: false,
      code: 'ROOM_TOKEN_INVALID',
    });

    const forged = new JwtService({ secret: 'other-secret' }).sign(
      {},
      { subject: 'room-1', secret: 'other-secret', expiresIn: '1h' },
    );
    expect(helper.verify(forged)).toEqual({
      ok: false,
      code: 'ROOM_TOKEN_INVALID',
    });
  });
});

describe('PlatformService', () => {
  let service: PlatformService;
  let roomService: {
    createProjectRoom: jest.Mock;
    listProjectRooms: jest.Mock;
    findProjectRoom: jest.Mock;
    softDeleteRoom: jest.Mock;
  };
  let sfuService: { endRoom: jest.Mock };
  let egressService: {
    start: jest.Mock;
    listForRoom: jest.Mock;
    get: jest.Mock;
    stop: jest.Mock;
  };
  let roomTokenHelper: { mint: jest.Mock; expiresAt: jest.Mock };

  beforeEach(() => {
    roomService = {
      createProjectRoom: jest.fn(),
      listProjectRooms: jest.fn(),
      findProjectRoom: jest.fn(),
      softDeleteRoom: jest.fn(),
    };
    sfuService = { endRoom: jest.fn() };
    egressService = {
      start: jest.fn(),
      listForRoom: jest.fn(),
      get: jest.fn(),
      stop: jest.fn(),
    };
    roomTokenHelper = {
      mint: jest.fn().mockReturnValue('signed-token'),
      expiresAt: jest.fn().mockReturnValue(new Date('2026-01-01T00:00:00Z')),
    };

    service = new PlatformService(
      roomService as unknown as RoomService,
      sfuService as unknown as SfuService,
      roomTokenHelper as unknown as RoomTokenHelper,
      egressService as never,
    );
  });

  it('creates rooms under the authenticated project', async () => {
    roomService.createProjectRoom.mockResolvedValue({
      id: 'room-1',
      slug: 'abc123',
    });

    const room = await service.createRoom('project-1', { maxParticipants: 5 });

    expect(room).toEqual({ id: 'room-1', slug: 'abc123' });
    expect(roomService.createProjectRoom).toHaveBeenCalledWith('project-1', {
      maxParticipants: 5,
    });
  });

  it('lists only the project rooms', async () => {
    roomService.listProjectRooms.mockResolvedValue([]);

    await service.listRooms('project-1');

    expect(roomService.listProjectRooms).toHaveBeenCalledWith('project-1');
  });

  it('ends a room through soft-delete and SFU teardown', async () => {
    roomService.findProjectRoom.mockResolvedValue({ id: 'room-1' });

    await service.endRoom('project-1', 'room-1');

    expect(roomService.softDeleteRoom).toHaveBeenCalledWith('room-1');
    expect(sfuService.endRoom).toHaveBeenCalledWith('room-1');
  });

  it('mints a token for an active room with defaults', async () => {
    roomService.findProjectRoom.mockResolvedValue({
      id: 'room-1',
      status: 'active',
    });

    const result = await service.mintRoomToken(
      'project-1',
      'key-1',
      'room-1',
      {},
    );

    expect(result.token).toBe('signed-token');
    expect(roomTokenHelper.mint).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        projectId: 'project-1',
        keyId: 'key-1',
        participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Participant',
        role: 'participant',
      }),
    );
    // Absent means absent: no null placeholders for correlation fields.
    const mintedClaims = (roomTokenHelper.mint as jest.Mock).mock.calls[0][0];
    expect('externalId' in mintedClaims).toBe(false);
    expect('metadata' in mintedClaims).toBe(false);
  });

  it('mints a token carrying correlation fields verbatim', async () => {
    roomService.findProjectRoom.mockResolvedValue({
      id: 'room-1',
      status: 'active',
    });
    const metadata = { tenant: 'acme', seat: 4 };

    await service.mintRoomToken('project-1', 'key-1', 'room-1', {
      externalId: 'user-42',
      metadata,
    });

    expect(roomTokenHelper.mint).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'user-42', metadata }),
    );
  });

  it('refuses to mint tokens for ended rooms', async () => {
    roomService.findProjectRoom.mockResolvedValue({
      id: 'room-1',
      status: 'ended',
    });

    await expect(
      service.mintRoomToken('project-1', 'key-1', 'room-1', {}),
    ).rejects.toThrow(BadRequestException);
    expect(roomTokenHelper.mint).not.toHaveBeenCalled();
  });

  it('surfaces cross-project rooms as NotFound', async () => {
    roomService.findProjectRoom.mockRejectedValue(new NotFoundException());

    await expect(service.endRoom('project-1', 'foreign-room')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: { apiKey: { findUnique: jest.Mock } };

  function makeContext(headers: Record<string, string>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    prisma = { apiKey: { findUnique: jest.fn() } };
    guard = new ApiKeyGuard(prisma as unknown as PrismaService);
  });

  it('rejects a missing Authorization header with 401', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects an unknown key with the same 401 as a revoked one', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);
    const unknown = await guard
      .canActivate(makeContext({ authorization: 'Bearer zk_live_unknown' }))
      .catch((e) => e);

    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      projectId: 'p1',
      revokedAt: new Date(),
    });
    const revoked = await guard
      .canActivate(makeContext({ authorization: 'Bearer zk_live_revoked' }))
      .catch((e) => e);

    expect(unknown.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(unknown.message).toBe(revoked.message);
  });

  it('attaches the key context and passes for an active key', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      projectId: 'project-1',
      revokedAt: null,
    });
    const request: Record<string, unknown> = {};
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    Object.defineProperty(request, 'headers', {
      value: { authorization: 'Bearer zk_live_valid' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.apiKey).toEqual({ id: 'key-1', projectId: 'project-1' });
  });
});

describe('MintRoomTokenDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const transform = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: MintRoomTokenDto,
    });

  it('accepts correlation fields within the limits', async () => {
    const metadata = { tenant: 'acme', seat: 4 };
    const dto = await transform({
      name: 'Alice',
      externalId: 'user-42',
      metadata,
    });
    expect(dto).toEqual({ name: 'Alice', externalId: 'user-42', metadata });
  });

  it('rejects an oversized metadata object with 400', async () => {
    await expect(
      transform({
        metadata: { blob: 'x'.repeat(2048) },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-object metadata with 400', async () => {
    for (const metadata of ['acme', 42, ['acme'], null]) {
      await expect(transform({ metadata })).rejects.toThrow(
        BadRequestException,
      );
    }
  });

  it('rejects an out-of-range externalId with 400', async () => {
    await expect(transform({ externalId: '' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(transform({ externalId: 'x'.repeat(65) })).rejects.toThrow(
      BadRequestException,
    );
  });
});
