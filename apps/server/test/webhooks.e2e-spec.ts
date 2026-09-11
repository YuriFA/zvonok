import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import * as https from 'node:https';
import { createHmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo, Server as NetServer } from 'node:net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { PasswordHelper } from '../src/auth/helpers/password.helper';
import { WorkerManager } from '../src/sfu/worker-manager';
import { ConfigService } from '@nestjs/config';

// Throwaway keypair for localhost only; see NODE_TLS_REJECT_UNAUTHORIZED above.
const TEST_TLS_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFLno28Qr4BHPYQ2vBHDMRVksgbV8uu9dyD3UoT6809PoAoGCCqGSM49
AwEHoUQDQgAERkL4Eg1nSULJhAletNuBBZ/9WnY2mIgrD0CWlkrgE1kUN8q+1ygJ
jbgvpDi0M0piSa9Uqv4BT2/JgS66IS2iEg==
-----END EC PRIVATE KEY-----`;

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUWjQcPbYbH2+TiFzTo0GNnFK5DAUwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDkwNjA5NTQwNloYDzIxMjYwODEz
MDk1NDA2WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARGQvgSDWdJQsmECV6024EFn/1adjaYiCsPQJaWSuATWRQ3yr7XKAmN
uC+kOLQzSmJJr1Sq/gFPb8mBLrohLaISo28wbTAdBgNVHQ4EFgQUGatCgmqLn4oT
IbKlTIx1R+SEgywwHwYDVR0jBBgwFoAUGatCgmqLn4oTIbKlTIx1R+SEgywwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZI
zj0EAwIDSAAwRQIgEmWCYhB8+rH+JEdEHqvuURbP+zGLr1G9STR3Fs8VO0MCIQDc
QCXvFMlpvwsJjrBGgWp1nw9TLO4SkqcSniDD2Ct13w==
-----END CERTIFICATE-----`;

interface HookRequest {
  headers: IncomingHttpHeaders;
  rawBody: string;
  parsed: {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  };
}

interface DbProject {
  id: string;
  name: string;
  developerAccountId: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

interface DbRoom {
  id: string;
  slug: string;
  name?: string;
  ownerId?: string;
  projectId?: string;
  status: string;
  maxParticipants: number;
  createdAt?: Date;
}

interface DbMessage {
  id: string;
  content: string;
  userId: string | null;
  roomId: string;
  createdAt: Date;
}

describe('Project webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let httpUrl: string;
  let hookRequests: HookRequest[];
  let hookPort: number;
  let hookServer: https.Server;
  let apiKey = '';
  let webhookSecret: string;
  const sockets: Socket[] = [];

  let project: DbProject;
  let roomId: string;
  let roomSlug: string;
  let userRoomId: string;
  let userRoomSlug: string;

  const db = {
    developers: [] as Array<Record<string, unknown>>,
    projects: [] as DbProject[],
    keys: [] as Array<{
      id: string;
      keyHash: string;
      prefix: string;
      projectId: string;
      revokedAt: Date | null;
    }>,
    rooms: [] as DbRoom[],
    messages: [] as DbMessage[],
    users: [] as Array<Record<string, unknown>>,
  };

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

  async function waitForSocketEvent<T>(
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

  /** Polls the receiver until a matching webhook arrives (delivery is async). */
  async function waitForHook(
    pred: (r: HookRequest) => boolean,
    timeoutMs = 5000,
  ): Promise<HookRequest> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = hookRequests.find(pred);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for webhook delivery');
  }

  function signatureOf(r: HookRequest, secret: string): string {
    const timestamp = r.headers['x-zvonok-timestamp'] as string;
    return `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${r.rawBody}`)
      .digest('hex')}`;
  }

  function expectValidSignature(r: HookRequest, secret: string): void {
    const timestamp = r.headers['x-zvonok-timestamp'] as string;
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(Math.abs(Number(timestamp) - nowSeconds)).toBeLessThanOrEqual(30);
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['x-zvonok-signature']).toBe(signatureOf(r, secret));
  }

  beforeAll(async () => {
    // HTTPS webhook receiver
    hookRequests = [];
    hookServer = https.createServer(
      { key: TEST_TLS_KEY, cert: TEST_TLS_CERT },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          hookRequests.push({
            headers: req.headers,
            rawBody,
            parsed: JSON.parse(rawBody),
          });
          res.statusCode = 200;
          res.end();
        });
      },
    );
    await new Promise<void>((resolve) =>
      hookServer.listen(0, '127.0.0.1', resolve),
    );
    hookPort = (hookServer.address() as AddressInfo).port;

    // Pre-seeded host user for the user-owned room scenario.
    db.users.push({
      id: 'user-host',
      email: 'host@test.dev',
      username: 'host',
      passwordHash: await PasswordHelper.hash('Password123'),
      role: 'HOST',
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    const prismaMock = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prismaMock),
      ),
      developerAccount: {
        findUnique: jest.fn(
          ({ where }) =>
            db.developers.find((d) => d.username === where.username) ?? null,
        ),
        create: jest.fn(({ data }) => {
          const record = {
            id: `dev-${db.developers.length + 1}`,
            ...data,
          };
          db.developers.push(record);
          return record;
        }),
      },
      project: {
        create: jest.fn(({ data }) => {
          const record = {
            id: `project-${db.projects.length + 1}`,
            webhookUrl: null,
            webhookSecret: null,
            ...data,
          };
          db.projects.push(record);
          return record;
        }),
        findFirst: jest.fn(
          ({ where }) =>
            db.projects.find(
              (p) =>
                p.id === where.id &&
                p.developerAccountId === where.developerAccountId,
            ) ?? null,
        ),
        findUnique: jest.fn(
          ({ where }) => db.projects.find((p) => p.id === where.id) ?? null,
        ),
        update: jest.fn(({ where, data }) => {
          const record = db.projects.find((p) => p.id === where.id);
          if (!record) return null;
          return Object.assign(record, data);
        }),
      },
      apiKey: {
        findUnique: jest.fn(
          ({ where }) =>
            db.keys.find(
              (k) => k.keyHash === where.keyHash || k.id === where.id,
            ) ?? null,
        ),
        create: jest.fn(({ data }) => {
          const record = {
            id: `key-${db.keys.length + 1}`,
            revokedAt: null,
            ...data,
          };
          db.keys.push(record);
          return record;
        }),
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
        findUnique: jest.fn(({ where }) => {
          const record = where.slug
            ? (db.rooms.find((r) => r.slug === where.slug) ?? null)
            : (db.rooms.find((r) => r.id === where.id) ?? null);
          // softDeleteRoom reads the transcript through this query.
          if (!record) return null;
          return {
            ...record,
            createdAt: record.createdAt ?? new Date(),
            messages: db.messages.filter((m) => m.roomId === record.id),
          };
        }),
        findFirst: jest.fn(({ where }) => {
          const room = db.rooms.find((r) => r.id === where.id);
          if (!room) return null;
          if (where.projectId && room.projectId !== where.projectId) {
            return null;
          }
          return room;
        }),
        findMany: jest.fn(({ where }) =>
          db.rooms.filter((r) => r.projectId === where.projectId),
        ),
        create: jest.fn(({ data }) => {
          const record = {
            id: `room-${db.rooms.length + 1}`,
            status: 'active',
            maxParticipants: 10,
            ...data,
          } as DbRoom;
          db.rooms.push(record);
          return record;
        }),
        update: jest.fn(({ where, data }) => {
          const record = db.rooms.find((r) => r.id === where.id);
          if (!record) return null;
          return Object.assign(record, data);
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      callRecord: {
        create: jest.fn(({ data }) => ({
          id: `record-${db.users.length + 1}`,
          ...data,
        })),
      },
      user: {
        findUnique: jest.fn(
          ({ where }) =>
            db.users.find(
              (u) => u.id === where.id || u.email === where.email,
            ) ?? null,
        ),
        create: jest.fn(({ data }) => {
          const record = { id: `user-${db.users.length + 1}`, ...data };
          db.users.push(record);
          return record;
        }),
        update: jest.fn(({ where, data }) => {
          const record = db.users.find((u) => u.id === where.id);
          if (!record) return null;
          return Object.assign(record, data);
        }),
      },
    };
    prismaMock.$transaction = jest.fn((callback: (tx: unknown) => unknown) =>
      callback(prismaMock),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
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

    // Developer account with a project, a webhook endpoint and an API key.
    const register = await request(app.getHttpServer())
      .post('/developers/auth/register')
      .send({ username: 'webhook-dev', password: 'Password123' });
    expect(register.status).toBe(201);
    const devToken = register.body.token as string;
    const devAuth = { Authorization: `Bearer ${devToken}` };

    const created = await request(app.getHttpServer())
      .post('/developers/projects')
      .set(devAuth)
      .send({ name: 'webhook-project' });
    expect(created.status).toBe(201);
    project = created.body;

    const hooked = await request(app.getHttpServer())
      .put(`/developers/projects/${project.id}/webhooks`)
      .set(devAuth)
      .send({ url: `https://127.0.0.1:${hookPort}/hook` });
    expect(hooked.status).toBe(200);
    webhookSecret = hooked.body.secret as string;

    const key = await request(app.getHttpServer())
      .post(`/developers/projects/${project.id}/keys`)
      .set(devAuth)
      .send();
    expect(key.status).toBe(201);
    apiKey = key.body.key as string;

    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ name: 'hooked room' });
    expect(room.status).toBe(201);
    roomId = room.body.id;
    roomSlug = room.body.slug;
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app.close();
    await new Promise((resolve) => hookServer.close(() => resolve(undefined)));
  });

  it('delivers room.started then participant.joined on the first token join', async () => {
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ name: 'Alice' });
    expect(mint.status).toBe(201);
    const token = mint.body.token as string;

    const socket = connectSocket();
    const joined = waitForSocketEvent(socket, 'sfu:joined');
    socket.emit('sfu:join', { roomId, token, userId: 'x', username: 'x' });
    await joined;

    const started = await waitForHook((r) => r.parsed.type === 'room.started');
    const joinedHook = await waitForHook(
      (r) => r.parsed.type === 'participant.joined',
    );

    expect(hookRequests.indexOf(started)).toBeLessThan(
      hookRequests.indexOf(joinedHook),
    );

    expectValidSignature(started, webhookSecret);
    expect(started.parsed.timestamp).toBe(
      new Date(started.parsed.timestamp).toISOString(),
    );
    expect(started.parsed.data).toEqual({ roomId, roomSlug });

    expectValidSignature(joinedHook, webhookSecret);
    expect(joinedHook.parsed.data).toEqual({
      roomId,
      roomSlug,
      participant: { id: expect.any(String), displayName: 'Alice' },
    });
  });

  it('delivers participant.left with reason leave after an explicit leave', async () => {
    const socket = sockets[sockets.length - 1];
    socket.emit('sfu:leave');

    const leftHook = await waitForHook(
      (r) =>
        r.parsed.type === 'participant.left' &&
        r.parsed.data.reason === 'leave',
    );

    expectValidSignature(leftHook, webhookSecret);
    expect(leftHook.parsed.data).toMatchObject({
      roomId,
      roomSlug,
      reason: 'leave',
    });
  });

  it('carries token correlation fields through participant.joined and participant.left', async () => {
    const metadata = { tenant: 'acme', seat: 4 };
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ name: 'Corr', externalId: 'user-42', metadata });
    const socket = connectSocket();
    const joined = waitForSocketEvent(socket, 'sfu:joined');
    socket.emit('sfu:join', { roomId, token: mint.body.token });
    await joined;

    const joinedHook = await waitForHook(
      (r) =>
        r.parsed.type === 'participant.joined' &&
        (r.parsed.data.participant as { displayName?: string })?.displayName ===
          'Corr',
    );
    expect(joinedHook.parsed.data.participant).toEqual({
      id: expect.any(String),
      displayName: 'Corr',
      externalId: 'user-42',
      metadata,
    });

    socket.emit('sfu:leave');
    const leftHook = await waitForHook(
      (r) =>
        r.parsed.type === 'participant.left' &&
        (r.parsed.data.participant as { displayName?: string })?.displayName ===
          'Corr',
    );
    expect(leftHook.parsed.data.participant).toEqual({
      id: expect.any(String),
      displayName: 'Corr',
      externalId: 'user-42',
      metadata,
    });
  });

  it('delivers room.ended when the project room is ended via the API', async () => {
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set({ Authorization: `Bearer ${apiKey}` })
      .send({ name: 'Bob' });
    const token = mint.body.token as string;

    const socket = connectSocket();
    const joined = waitForSocketEvent(socket, 'sfu:joined');
    socket.emit('sfu:join', { roomId, token, userId: 'y', username: 'y' });
    await joined;

    const hookCountBeforeDelete = hookRequests.length;
    const deleted = await request(app.getHttpServer())
      .delete(`/v1/rooms/${roomId}`)
      .set({ Authorization: `Bearer ${apiKey}` })
      .send();
    expect(deleted.status).toBe(204);

    const endedHook = await waitForHook((r) => r.parsed.type === 'room.ended');
    const leftHook = await waitForHook(
      (r) =>
        r.parsed.type === 'participant.left' &&
        r.parsed.data.reason === 'room-end',
    );

    // participant.left(room-end) precedes room.ended (FIFO emission order).
    expect(hookRequests.indexOf(leftHook)).toBeLessThan(
      hookRequests.indexOf(endedHook),
    );
    expect(hookRequests.indexOf(endedHook)).toBeGreaterThanOrEqual(
      hookCountBeforeDelete,
    );
    expectValidSignature(endedHook, webhookSecret);
    expect(endedHook.parsed.data).toEqual({ roomId, roomSlug });
  });

  it('stays silent for a user-owned room joined, left and ended', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'host@test.dev', password: 'Password123' });
    expect(login.status).toBe(200);
    const hostAuth = {
      Authorization: `Bearer ${login.body.tokens.accessToken}`,
    };

    const created = await request(app.getHttpServer())
      .post('/rooms')
      .set(hostAuth)
      .send({ name: 'user room' });
    expect(created.status).toBe(201);
    userRoomId = created.body.id as string;
    userRoomSlug = created.body.slug as string;
    const baseline = hookRequests.length;
    // Cookie identity is only accepted from the app origin; identity fields
    // in the payload are never trusted.
    const appOrigin =
      app.get(ConfigService).get<string>('CLIENT_URL') ||
      'http://localhost:5173';
    const socket = connectSocket({
      origin: appOrigin,
      cookie: `access_token=${login.body.tokens.accessToken}`,
    });
    const joined = waitForSocketEvent(socket, 'sfu:joined');
    socket.emit('sfu:join', {
      roomId: userRoomId,
      roomSlug: userRoomSlug,
    });
    await joined;

    socket.emit('sfu:leave');

    await request(app.getHttpServer())
      .delete(`/rooms/${userRoomId}`)
      .set(hostAuth)
      .send()
      .expect(204);

    // Give any wrongly emitted delivery a chance to arrive.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(hookRequests.length).toBe(baseline);
  });
});
