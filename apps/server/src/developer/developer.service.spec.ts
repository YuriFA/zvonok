jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DeveloperService } from './developer.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PasswordHelper } from 'src/auth/helpers/password.helper';
import { ApiKeyHelper } from './api-key.helper';
import { SetWebhookDto } from './dto/developer.dto';

describe('DeveloperService', () => {
  let service: DeveloperService;
  let prisma: {
    developerAccount: { findUnique: jest.Mock; create: jest.Mock };
    project: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    apiKey: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    room: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      developerAccount: { findUnique: jest.fn(), create: jest.fn() },
      project: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      apiKey: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      room: { findMany: jest.fn() },
    };

    service = new DeveloperService(
      prisma as unknown as PrismaService,
      { sign: jest.fn().mockReturnValue('dev-token') } as unknown as JwtService,
      { get: jest.fn().mockReturnValue('dev-secret') } as never,
      {
        list: jest.fn().mockResolvedValue([]),
        download: jest.fn().mockResolvedValue({
          stream: null,
          contentType: 'video/mp4',
          size: 1,
          range: null,
        }),
      } as never,
    );
  });

  describe('register', () => {
    it('creates the account and returns a session token', async () => {
      prisma.developerAccount.findUnique.mockResolvedValue(null);
      prisma.developerAccount.create.mockResolvedValue({
        id: 'dev-1',
        username: 'platform-dev',
      });
      jest.spyOn(PasswordHelper, 'hash').mockResolvedValue('hashed');

      const result = await service.register({
        username: 'platform-dev',
        password: 'Password123',
      });

      expect(result).toEqual({ token: 'dev-token' });
      expect(prisma.developerAccount.create).toHaveBeenCalledWith({
        data: { username: 'platform-dev', passwordHash: 'hashed' },
      });
    });

    it('rejects a duplicate username with 409', async () => {
      prisma.developerAccount.findUnique.mockResolvedValue({ id: 'dev-1' });

      await expect(
        service.register({ username: 'platform-dev', password: 'Password123' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.developerAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      prisma.developerAccount.findUnique.mockResolvedValue({
        id: 'dev-1',
        username: 'platform-dev',
        passwordHash: 'hashed',
      });
      jest.spyOn(PasswordHelper, 'compare').mockResolvedValue(true);

      const result = await service.login({
        username: 'platform-dev',
        password: 'Password123',
      });

      expect(result).toEqual({ token: 'dev-token' });
    });

    it('rejects a wrong password with 401', async () => {
      prisma.developerAccount.findUnique.mockResolvedValue({
        id: 'dev-1',
        passwordHash: 'hashed',
      });
      jest.spyOn(PasswordHelper, 'compare').mockResolvedValue(false);

      await expect(
        service.login({ username: 'platform-dev', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown username with 401', async () => {
      prisma.developerAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('createApiKey', () => {
    it('returns the full key once and persists only hash and prefix', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      prisma.apiKey.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'key-1', ...data, createdAt: new Date() }),
      );

      const result = await service.createApiKey('dev-1', 'project-1');

      expect(result.key).toMatch(/^zk_live_[A-Za-z0-9_-]{43}$/);
      expect(prisma.apiKey.create).toHaveBeenCalledWith({
        data: {
          keyHash: expect.any(String),
          prefix: result.key.slice(0, 15),
          projectId: 'project-1',
        },
      });
      expect(prisma.apiKey.create.mock.calls[0][0].data.keyHash).not.toContain(
        'zk_live_',
      );
    });

    it('rejects a project owned by another developer with 404', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.createApiKey('dev-1', 'foreign-project'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });
  });

  describe('listApiKeys', () => {
    it('returns metadata only, never key material', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      prisma.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          keyHash: 'secret-hash',
          prefix: 'zk_live_abc',
          projectId: 'project-1',
          createdAt: new Date(),
          revokedAt: null,
        },
      ]);

      const keys = await service.listApiKeys('dev-1', 'project-1');

      expect(keys).toHaveLength(1);
      expect(JSON.stringify(keys)).not.toContain('secret-hash');
      expect(keys[0]).toEqual({
        id: 'key-1',
        prefix: 'zk_live_abc',
        createdAt: expect.any(Date),
        revokedAt: null,
      });
    });
  });

  describe('revokeApiKey', () => {
    it('sets revokedAt on an owned key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        revokedAt: null,
      });

      await service.revokeApiKey('dev-1', 'key-1');

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is idempotent for an already-revoked key', async () => {
      prisma.apiKey.findFirst.mockResolvedValue({
        id: 'key-1',
        revokedAt: new Date(),
      });

      await service.revokeApiKey('dev-1', 'key-1');

      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('rejects a key owned by another developer with 404', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.revokeApiKey('dev-1', 'foreign-key'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ApiKeyHelper', () => {
    it('produces distinct keys with stable hashes', () => {
      const first = ApiKeyHelper.generate();
      const second = ApiKeyHelper.generate();

      expect(first.key).not.toEqual(second.key);
      expect(ApiKeyHelper.hash(first.key)).toBe(first.keyHash);
    });
  });
});

describe('DeveloperService webhook config', () => {
  const ownedProject = { id: 'project-1', developerAccountId: 'dev-1' };
  let service: DeveloperService;
  let prisma: {
    project: { findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      project: { findFirst: jest.fn(), update: jest.fn() },
    };
    prisma.project.findFirst.mockResolvedValue(ownedProject);

    service = new DeveloperService(
      prisma as unknown as PrismaService,
      { sign: jest.fn() } as unknown as JwtService,
      { get: jest.fn() } as never,
      {
        list: jest.fn().mockResolvedValue([]),
        download: jest.fn(),
      } as never,
    );
  });

  it('stores the endpoint with a 43+ char base64url secret and returns both', async () => {
    const result = await service.setWebhook(
      'dev-1',
      'project-1',
      'https://example.com/hooks',
    );

    expect(result.url).toBe('https://example.com/hooks');
    expect(result.secret).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        webhookUrl: 'https://example.com/hooks',
        webhookSecret: result.secret,
      },
    });
  });

  it('generates a fresh secret when replacing the endpoint', async () => {
    const first = await service.setWebhook(
      'dev-1',
      'project-1',
      'https://example.com/hooks',
    );
    const second = await service.setWebhook(
      'dev-1',
      'project-1',
      'https://example.com/hooks-v2',
    );

    expect(second.secret).not.toBe(first.secret);
    expect(second.url).toBe('https://example.com/hooks-v2');
  });

  it('rejects a webhook config for a foreign project with 404', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.setWebhook('dev-1', 'foreign-project', 'https://example.com'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('clears the endpoint and secret on removal', async () => {
    await service.removeWebhook('dev-1', 'project-1');

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { webhookUrl: null, webhookSecret: null },
    });
  });

  it('rejects removal for a foreign project with 404', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.removeWebhook('dev-1', 'foreign-project'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe('SetWebhookDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const transform = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: SetWebhookDto,
    });

  it('accepts an https URL, including loopback hosts', async () => {
    for (const url of [
      'https://example.com/hooks',
      'https://localhost:8443/hook',
      'https://127.0.0.1:9000/hook',
    ]) {
      const dto = await transform({ url });
      expect(dto).toEqual({ url });
    }
  });

  it('rejects plain http and non-URL values with a BadRequestException', async () => {
    for (const url of [
      'http://example.com/hooks',
      'ftp://example.com/hooks',
      'not-a-url',
      '',
    ]) {
      await expect(transform({ url })).rejects.toThrow(BadRequestException);
    }
  });
});

describe('DeveloperService project reads', () => {
  const ownedProject = { id: 'project-1', developerAccountId: 'dev-1' };
  let service: DeveloperService;
  let prisma: {
    project: { findFirst: jest.Mock; findMany: jest.Mock };
    room: { findMany: jest.Mock };
  };
  let recordings: { list: jest.Mock; download: jest.Mock };

  beforeEach(() => {
    prisma = {
      project: { findFirst: jest.fn(), findMany: jest.fn() },
      room: { findMany: jest.fn() },
    };
    recordings = {
      list: jest.fn().mockResolvedValue([]),
      download: jest.fn().mockResolvedValue({
        stream: 'stream',
        contentType: 'video/mp4',
        size: 10,
        range: null,
      }),
    };
    service = new DeveloperService(
      prisma as unknown as PrismaService,
      { sign: jest.fn() } as unknown as JwtService,
      { get: jest.fn() } as never,
      recordings as never,
    );
  });

  it('lists only the developer projects with room counts', async () => {
    prisma.project.findMany.mockResolvedValue([
      { id: 'project-1', name: 'P1', _count: { rooms: 3 } },
      { id: 'project-2', name: 'P2', _count: { rooms: 0 } },
    ]);

    const result = await service.listProjects('dev-1');

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { developerAccountId: 'dev-1' },
      }),
    );
    expect(result.items).toEqual([
      { id: 'project-1', name: 'P1', roomCount: 3 },
      { id: 'project-2', name: 'P2', roomCount: 0 },
    ]);
  });

  it('never exposes the webhook signing secret in the listing', async () => {
    prisma.project.findMany.mockResolvedValue([
      {
        id: 'project-1',
        name: 'P1',
        webhookUrl: 'https://example.com/hooks',
        createdAt: new Date(),
        _count: { rooms: 0 },
      },
    ]);

    await service.listProjects('dev-1');

    // With a mocked Prisma the engine-side select stripping is bypassed, so
    // pin the projection: webhookSecret must not be in the query shape.
    const query = prisma.project.findMany.mock.calls[0][0];
    expect(query.select).toEqual({
      id: true,
      name: true,
      webhookUrl: true,
      createdAt: true,
      _count: { select: { rooms: true } },
    });
  });

  it('lists rooms of an owned project with lifecycle fields only', async () => {
    prisma.project.findFirst.mockResolvedValue(ownedProject);
    prisma.room.findMany.mockResolvedValue([
      {
        id: 'room-1',
        name: 'Standup',
        slug: 'standup',
        status: 'ended',
        createdAt: new Date('2026-09-01'),
        endedAt: new Date('2026-09-01'),
      },
    ]);

    const result = await service.listProjectRooms('dev-1', 'project-1');

    expect(prisma.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'project-1' } }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty('messages');
    expect(result.items[0]).not.toHaveProperty('ownerId');
  });

  it('lists recordings through RecordingsService after the ownership check', async () => {
    prisma.project.findFirst.mockResolvedValue(ownedProject);
    recordings.list.mockResolvedValue({
      items: [{ id: 'egress-1' }],
      next: null,
    });

    const result = await service.listProjectRecordings('dev-1', 'project-1');

    expect(recordings.list).toHaveBeenCalledWith('project-1', undefined, {});
    expect(result).toEqual({ items: [{ id: 'egress-1' }], next: null });
  });

  it('delegates downloads with part and range options', async () => {
    prisma.project.findFirst.mockResolvedValue(ownedProject);
    recordings.download.mockResolvedValue({
      stream: 'stream',
      contentType: 'video/mp4',
      size: 10,
      range: { start: 0, end: 9 },
    });

    const result = await service.downloadProjectRecording(
      'dev-1',
      'project-1',
      'egress-1',
      { part: 2, rangeHeader: 'bytes=0-9' },
    );

    expect(recordings.download).toHaveBeenCalledWith('project-1', 'egress-1', {
      part: 2,
      rangeHeader: 'bytes=0-9',
    });
    expect(result).toMatchObject({ size: 10, range: { start: 0, end: 9 } });
  });

  it('rejects reads of foreign projects with 404', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.listProjectRooms('dev-1', 'foreign-project'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.listProjectRecordings('dev-1', 'foreign-project'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.downloadProjectRecording('dev-1', 'foreign-project', 'egress-1'),
    ).rejects.toThrow(NotFoundException);
    expect(recordings.list).not.toHaveBeenCalled();
    expect(recordings.download).not.toHaveBeenCalled();
  });
});

describe('DeveloperService app-session sign-in', () => {
  const appUser = {
    id: 'user-1',
    username: 'alice',
    passwordHash: 'site-hash',
  };
  let service: DeveloperService;
  let prisma: {
    developerAccount: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };
  let jwt: { sign: jest.Mock };

  beforeEach(() => {
    prisma = {
      developerAccount: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    jwt = { sign: jest.fn().mockReturnValue('dev-token') };
    service = new DeveloperService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      { get: jest.fn() } as never,
      { list: jest.fn(), download: jest.fn() } as never,
    );
  });

  it('creates and links a developer account on first sign-in', async () => {
    prisma.developerAccount.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(appUser);
    prisma.developerAccount.create.mockResolvedValue({
      id: 'dev-1',
      username: 'alice',
    });

    const result = await service.ssoFromAppUser('user-1');

    expect(prisma.developerAccount.create).toHaveBeenCalledWith({
      data: {
        username: 'alice',
        passwordHash: 'site-hash',
        userId: 'user-1',
      },
    });
    expect(result).toMatchObject({
      token: 'dev-token',
      username: 'alice',
      created: true,
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      { username: 'alice' },
      expect.objectContaining({ subject: 'dev-1' }),
    );
  });

  it('suffixes the username when an unlinked account holds it', async () => {
    prisma.developerAccount.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(appUser);
    prisma.developerAccount.findMany.mockResolvedValue([
      { username: 'alice' },
      { username: 'alice-2' },
    ]);
    prisma.developerAccount.create.mockResolvedValue({
      id: 'dev-2',
      username: 'alice-3',
    });

    const result = await service.ssoFromAppUser('user-1');

    expect(prisma.developerAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: 'alice-3' }),
    });
    expect(result.username).toBe('alice-3');
  });

  it('returns the linked account on repeat sign-in without creating', async () => {
    prisma.developerAccount.findUnique.mockResolvedValue({
      id: 'dev-1',
      username: 'alice',
      userId: 'user-1',
    });

    const result = await service.ssoFromAppUser('user-1');

    expect(result).toMatchObject({ username: 'alice', created: false });
    expect(prisma.developerAccount.create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects SSO for an unknown user with 404', async () => {
    prisma.developerAccount.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.ssoFromAppUser('ghost')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.developerAccount.create).not.toHaveBeenCalled();
  });
});
