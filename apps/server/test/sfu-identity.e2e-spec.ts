import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RoomTokenHelper } from '../src/platform/room-token.helper';
import { WorkerManager } from '../src/sfu/worker-manager';
import type { Server as NetServer } from 'node:net';

interface TestRoom {
  id: string;
  slug: string;
  ownerId: string | null;
}

type JoinResult =
  | { ok: true; participant: { id: string; username: string } }
  | { ok: false; code: string };

describe('SFU join identity matrix (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;
  let appOrigin: string;
  let jwtService: JwtService;
  let guestSecret: string;
  let roomTokenHelper: RoomTokenHelper;
  const sockets: Socket[] = [];

  const ownedRoom: TestRoom = {
    id: 'room-owned',
    slug: 'owned-slug',
    ownerId: 'user-1',
  };
  const projectRoom: TestRoom = {
    id: 'room-project',
    slug: 'project-slug',
    ownerId: null,
  };
  const rooms = new Map<string, TestRoom>([
    [ownedRoom.id, ownedRoom],
    [projectRoom.id, projectRoom],
  ]);
  const usernames = new Map<string, string>([
    ['user-1', 'alice'],
    ['user-2', 'bob'],
  ]);

  function connectSocket(
    opts: { origin?: string; cookie?: string } = {},
  ): Socket {
    const socket = io(`${httpUrl}/sfu`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        ...(opts.origin ? { Origin: opts.origin } : {}),
        ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      },
    });
    sockets.push(socket);
    return socket;
  }

  function join(
    socket: Socket,
    payload: Record<string, unknown>,
  ): Promise<JoinResult> {
    return new Promise<JoinResult>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('join neither resolved nor refused')),
        3000,
      );
      socket.once(
        'sfu:joined',
        (p: { participant: { id: string; username: string } }) => {
          clearTimeout(timer);
          resolve({ ok: true, participant: p.participant });
        },
      );
      socket.once('sfu:join-error', (p: { code: string }) => {
        clearTimeout(timer);
        resolve({ ok: false, code: p.code });
      });
      socket.emit('sfu:join', payload);
    });
  }

  function signUserToken(userId: string): string {
    return jwtService.sign({ id: userId });
  }

  function signGuestToken(
    roomSlug: string,
    guestId: string,
    displayName: string,
  ): string {
    return jwtService.sign(
      { guestId, displayName, roomSlug, scope: 'room' },
      { secret: guestSecret },
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        room: {
          findUnique: jest.fn(({ where }: { where: { id: string } }) => {
            const room = rooms.get(where.id);
            if (!room) return null;
            // Other readers (room soft-delete) select relations through the
            // same query; the join path only selects slug and ownerId.
            return { ...room };
          }),
          // RoomCleanupService deletes ended rooms on boot.
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        user: {
          findUnique: jest.fn(({ where }: { where: { id: string } }) => {
            const username = usernames.get(where.id);
            return username ? { username } : null;
          }),
        },
        apiKey: {
          findUnique: jest.fn().mockResolvedValue({ revokedAt: null }),
        },
        // EgressService fails active egress rows on boot.
        egress: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn(),
        },
      })
      .overrideProvider(WorkerManager)
      .useValue({
        createRouter: jest.fn(),
        getRtpCapabilities: jest.fn(() => ({
          codecs: [],
          headerExtensions: [],
        })),
        getRouter: jest.fn(),
        closeRouter: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);

    const address = (app.getHttpServer() as unknown as NetServer).address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    httpUrl = `http://127.0.0.1:${port}`;

    jwtService = app.get(JwtService);
    roomTokenHelper = app.get(RoomTokenHelper);
    const config = app.get(ConfigService);
    appOrigin = config.get<string>('CLIENT_URL') || 'http://localhost:5173';
    guestSecret = config.get<string>('JWT_GUEST_SECRET') ?? '';
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app.close();
  });

  it('refuses an anonymous join that spoofs payload identity fields', async () => {
    const anon = connectSocket();
    const result = await join(anon, {
      roomId: ownedRoom.id,
      roomSlug: ownedRoom.slug,
      userId: 'user-1',
      username: 'Alice',
      roomOwnerId: 'user-1',
    });
    expect(result).toEqual({ ok: false, code: 'SFU_JOIN_UNAUTHORIZED' });
  });

  it('accepts a cookie join from the app origin with verified identity and DB-grounded ownership', async () => {
    const owner = connectSocket({
      origin: appOrigin,
      cookie: `access_token=${signUserToken('user-1')}`,
    });
    // Spoofed payload identity must not change the verified participant.
    const result = await join(owner, {
      roomId: ownedRoom.id,
      roomSlug: ownedRoom.slug,
      userId: 'user-999',
      username: 'Spoof',
      roomOwnerId: 'user-999',
    });
    expect(result).toEqual({
      ok: true,
      participant: { id: 'user-1', username: 'alice' },
    });

    // Host powers come from room.ownerId matched against the verified user.
    const locked = waitFor<{ locked: boolean }>(owner, 'sfu:room-locked');
    owner.emit('sfu:lock-room', { locked: true });
    await expect(locked).resolves.toEqual({ locked: true });

    // While locked, even a valid credential is refused.
    const member = connectSocket({
      origin: appOrigin,
      cookie: `access_token=${signUserToken('user-2')}`,
    });
    await expect(
      join(member, { roomId: ownedRoom.id, roomSlug: ownedRoom.slug }),
    ).resolves.toEqual({ ok: false, code: 'ROOM_LOCKED' });

    const unlocked = waitFor<{ locked: boolean }>(owner, 'sfu:room-locked');
    owner.emit('sfu:lock-room', { locked: false });
    await expect(unlocked).resolves.toEqual({ locked: false });
  });

  it('refuses a cookie join from a foreign origin', async () => {
    const intruder = connectSocket({
      origin: 'https://evil.example',
      cookie: `access_token=${signUserToken('user-1')}`,
    });
    const result = await join(intruder, {
      roomId: ownedRoom.id,
      roomSlug: ownedRoom.slug,
    });
    expect(result).toEqual({ ok: false, code: 'SFU_JOIN_UNAUTHORIZED' });
  });

  it('refuses a cookie whose account no longer exists', async () => {
    const ghost = connectSocket({
      origin: appOrigin,
      cookie: `access_token=${signUserToken('user-ghost')}`,
    });
    const result = await join(ghost, {
      roomId: ownedRoom.id,
      roomSlug: ownedRoom.slug,
    });
    expect(result).toEqual({ ok: false, code: 'SFU_JOIN_UNAUTHORIZED' });
  });

  it('joins an approved guest under the token identity and refuses a cross-room guest', async () => {
    const guest = connectSocket({
      origin: appOrigin,
      cookie: `zvonok_guest_${ownedRoom.slug}=${signGuestToken(ownedRoom.slug, 'guest-1', 'Guesty')}`,
    });
    await expect(
      join(guest, { roomId: ownedRoom.id, roomSlug: ownedRoom.slug }),
    ).resolves.toEqual({
      ok: true,
      participant: { id: 'guest-1', username: 'Guesty' },
    });

    // A guest credential bound to one room cannot join another room.
    const stray = connectSocket({
      origin: appOrigin,
      cookie: `zvonok_guest_${ownedRoom.slug}=${signGuestToken(ownedRoom.slug, 'guest-2', 'Stray')}`,
    });
    await expect(
      join(stray, { roomId: projectRoom.id, roomSlug: projectRoom.slug }),
    ).resolves.toEqual({ ok: false, code: 'SFU_JOIN_FORBIDDEN' });
  });

  it('joins a valid room token from any origin without cookies', async () => {
    const token = roomTokenHelper.mint({
      roomId: projectRoom.id,
      projectId: 'project-e2e',
      keyId: 'key-e2e',
      participantId: 'participant-embed',
      name: 'Embed',
      role: 'participant',
    });
    const embed = connectSocket({ origin: 'https://evil.example' });
    await expect(
      join(embed, { roomId: projectRoom.id, token }),
    ).resolves.toEqual({
      ok: true,
      participant: { id: 'participant-embed', username: 'Embed' },
    });
  });

  it('surfaces token-carried correlation fields in the join and peer events', async () => {
    const metadata = { tenant: 'acme', seat: 4 };
    const token = roomTokenHelper.mint({
      roomId: projectRoom.id,
      projectId: 'project-e2e',
      keyId: 'key-e2e',
      participantId: 'participant-corr',
      name: 'Corr',
      role: 'participant',
      externalId: 'user-42',
      metadata,
    });
    const first = connectSocket();
    await expect(
      join(first, { roomId: projectRoom.id, token }),
    ).resolves.toEqual({
      ok: true,
      participant: {
        id: 'participant-corr',
        username: 'Corr',
        externalId: 'user-42',
        metadata,
      },
    });

    // A second plain-token joiner sees the correlation fields in the
    // existing-participants snapshot; the first peer sees a plain identity.
    const second = connectSocket();
    const existing = waitFor<Array<Record<string, unknown>>>(
      second,
      'sfu:existing-peers',
    );
    const peerJoined = waitFor<Record<string, unknown>>(
      first,
      'sfu:peer-joined',
    );
    second.emit('sfu:join', {
      roomId: projectRoom.id,
      token: roomTokenHelper.mint({
        roomId: projectRoom.id,
        projectId: 'project-e2e',
        keyId: 'key-e2e',
        participantId: 'participant-plain',
        name: 'Plain',
        role: 'participant',
      }),
    });
    await expect(existing).resolves.toEqual(
      expect.arrayContaining([
        {
          userId: 'participant-corr',
          username: 'Corr',
          externalId: 'user-42',
          metadata,
        },
      ]),
    );
    await expect(peerJoined).resolves.toEqual({
      userId: 'participant-plain',
      username: 'Plain',
    });
  });

  it('denies host powers to a verified non-owner with a forged ownership claim', async () => {
    const member = connectSocket({
      origin: appOrigin,
      cookie: `access_token=${signUserToken('user-2')}`,
    });
    const result = await join(member, {
      roomId: ownedRoom.id,
      roomSlug: ownedRoom.slug,
      roomOwnerId: 'user-2',
    });
    expect(result).toEqual({
      ok: true,
      participant: { id: 'user-2', username: 'bob' },
    });

    const ack = new Promise<Record<string, unknown>>((resolve) => {
      member.emit('sfu:lock-room', { locked: true }, resolve);
    });
    expect(await ack).toEqual({
      ok: false,
      code: 'MISSING_CAPABILITY',
      message: expect.any(String),
    });
  });

  function waitFor<T>(
    socket: Socket,
    event: string,
    timeoutMs = 3000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${event}`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }
});
