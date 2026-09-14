import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { ApiKeyHelper } from '../src/developer/api-key.helper';
import { WorkerManager } from '../src/sfu/worker-manager';
import type { Server as NetServer } from 'node:net';

interface TestRoom {
  id: string;
  name?: string;
  slug: string;
  ownerId?: string;
  projectId?: string;
  status: string;
  maxParticipants: number;
}

describe('SFU host controls (e2e)', () => {
  let app: INestApplication<App>;
  let httpUrl: string;
  let roomId: string;
  let hostId: string;
  let plainId: string;
  let roomLockedCount = 0;
  const hostMutes: Array<{ userId: string }> = [];
  const sockets: Socket[] = [];

  const generatedKey = ApiKeyHelper.generate();
  const keyRecord = {
    id: 'key-e2e-host',
    keyHash: generatedKey.keyHash,
    prefix: generatedKey.prefix,
    projectId: 'project-e2e',
    revokedAt: null as Date | null,
  };
  const rooms = new Map<string, TestRoom>();

  function connectSocket(): Socket {
    const socket = io(`${httpUrl}/sfu`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  async function waitFor<T>(
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

  async function mintToken(body: Record<string, unknown>): Promise<string> {
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set({ Authorization: `Bearer ${generatedKey.key}` })
      .send(body);
    expect(mint.status).toBe(201);
    return mint.body.token as string;
  }

  async function joinWithToken(socket: Socket, token: string): Promise<void> {
    const joined = waitFor<{ routerRtpCapabilities: unknown }>(
      socket,
      'sfu:joined',
    );
    socket.emit('sfu:join', {
      roomId,
      userId: 'ignored',
      username: 'Ignored',
      token,
    });
    await joined;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        apiKey: {
          findUnique: jest.fn(
            ({ where }: { where: { keyHash?: string; id?: string } }) => {
              if (
                where.keyHash === keyRecord.keyHash ||
                where.id === keyRecord.id
              ) {
                return keyRecord;
              }
              return null;
            },
          ),
        },
        project: {
          findFirst: jest.fn().mockResolvedValue({ id: 'project-e2e' }),
        },
        egress: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        room: {
          findUnique: jest.fn(({ where }: { where: { id: string } }) => {
            const room = rooms.get(where.id);
            if (!room) return null;
            // softDeleteRoom reads the transcript through this query.
            return { ...room, messages: [] };
          }),
          findFirst: jest.fn(
            ({ where }: { where: { id: string; projectId?: string } }) => {
              const room = rooms.get(where.id);
              if (!room) return null;
              if (where.projectId && room.projectId !== where.projectId) {
                return null;
              }
              return room;
            },
          ),
          findMany: jest.fn(() =>
            [...rooms.values()].filter(
              (room) => room.projectId === 'project-e2e',
            ),
          ),
          create: jest.fn(({ data }: { data: Partial<TestRoom> }) => {
            const room: TestRoom = {
              id: `room-${rooms.size + 1}`,
              slug: data.slug ?? 'slug',
              projectId: data.projectId,
              ownerId: data.ownerId,
              name: data.name,
              status: 'active',
              maxParticipants: data.maxParticipants ?? 10,
            };
            rooms.set(room.id, room);
            return room;
          }),
          update: jest.fn(
            ({ where, data }: { where: { id: string }; data: object }) => {
              const room = rooms.get(where.id);
              return Object.assign(room ?? {}, data);
            },
          ),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
        onRoutersLost: jest.fn(() => jest.fn()),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);

    const address = (app.getHttpServer() as unknown as NetServer).address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    httpUrl = `http://127.0.0.1:${port}`;

    const created = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set({ Authorization: `Bearer ${generatedKey.key}` })
      .send({});
    expect(created.status).toBe(201);
    roomId = created.body.id as string;
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app.close();
  });

  it('refuses host controls from a non-host participant', async () => {
    const hostToken = await mintToken({ name: 'Host', role: 'host' });
    const host = connectSocket();
    host.on('sfu:peer-muted', (payload: { userId: string }) => {
      hostMutes.push(payload);
    });
    await joinWithToken(host, hostToken);

    const plainToken = await mintToken({ name: 'Plain' });
    const plain = connectSocket();
    const peerJoined = waitFor<{ userId: string }>(host, 'sfu:peer-joined');
    const existingPeers = waitFor<Array<{ userId: string }>>(
      plain,
      'sfu:existing-peers',
    );
    await joinWithToken(plain, plainToken);
    plainId = (await peerJoined).userId;
    hostId = (await existingPeers)[0].userId;

    const denial = new Promise<Record<string, unknown>>((resolve) => {
      plain.emit('sfu:mute-peer', { userId: hostId }, resolve);
    });
    expect(await denial).toEqual({
      ok: false,
      code: 'MISSING_CAPABILITY',
      message: expect.any(String),
    });

    // A denied attempt changes nothing: the host was never muted.
    expect(hostMutes).toEqual([]);
  });

  it('mutes a target participant when the host asks', async () => {
    const host = sockets[0];
    const plain = sockets[1];

    const ack = new Promise<Record<string, unknown>>((resolve) => {
      host.emit('sfu:mute-peer', { userId: plainId }, resolve);
    });
    const plainMuted = waitFor<{ userId: string }>(plain, 'sfu:peer-muted');
    expect(await ack).toEqual({ ok: true });
    const muted = await plainMuted;
    expect(muted).toEqual({ userId: plainId });

    // The whole room is told, but the muted peer is the only subject.
    expect(hostMutes).toEqual([{ userId: plainId }]);
  });

  it('locks the room, refuses token joins, and unlocks on the end path', async () => {
    const host = sockets[0];
    const plain = sockets[1];
    plain.on('sfu:room-locked', () => {
      roomLockedCount += 1;
    });

    const locked = waitFor<{ locked: boolean }>(host, 'sfu:room-locked');
    host.emit('sfu:lock-room', { locked: true });
    expect(await locked).toEqual({ locked: true });

    // A join while locked is refused with a coded error.
    const refusedToken = await mintToken({ name: 'Late' });
    const refused = connectSocket();
    const joinError = waitFor<{ code: string; message: string }>(
      refused,
      'sfu:join-error',
    );
    refused.emit('sfu:join', {
      roomId,
      userId: 'ignored',
      username: 'Ignored',
      token: refusedToken,
    });
    expect(await joinError).toEqual({
      code: 'ROOM_LOCKED',
      message: expect.any(String),
    });

    // Idempotent lock: a repeated set must not broadcast again.
    host.emit('sfu:lock-room', { locked: true });
    expect(roomLockedCount).toBe(1);

    // The /v1 DELETE end path clears the lock: a token minted before the end
    // joins cleanly afterwards.
    const spareToken = await mintToken({ name: 'Spare' });
    const ended = waitFor<{ roomId: string }>(host, 'sfu:room-ended');
    const response = await request(app.getHttpServer())
      .delete(`/v1/rooms/${roomId}`)
      .set({ Authorization: `Bearer ${generatedKey.key}` });
    expect(response.status).toBe(204);
    await ended;

    const late = connectSocket();
    await joinWithToken(late, spareToken);
    expect(roomLockedCount).toBe(1);
  });
});
