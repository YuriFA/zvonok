// Sets EGRESS_FFMPEG_PATH to a stub before any config import. Must be first.
import './stubs/egress-ffmpeg-stub';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { createServer, type Server as HttpServer } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { ApiKeyHelper } from '../src/developer/api-key.helper';
import { WorkerManager } from '../src/sfu/worker-manager';
import type { Server as NetServer } from 'node:net';

interface TestRoom {
  id: string;
  slug: string;
  projectId: string | null;
  ownerId: string | null;
  name: string | null;
  status: string;
  maxParticipants: number;
}

interface TestEgressRow {
  id: string;
  roomId: string;
  projectId: string;
  outputs: { rtmpEndpoints: string[]; hls: boolean; record: boolean };
  status: string;
  endedReason: string | null;
  error: string | null;
  recordingSizeBytes: bigint | null;
  recordingFinalizedAt: Date | null;
  startedAt: Date;
  endedAt: Date | null;
}

interface ReceivedWebhook {
  type: string;
  data: Record<string, unknown>;
}

async function waitFor<T>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(
    () => reject(new Error(`Timed out waiting for ${event}`)),
    timeoutMs,
  );
  socket.once(event, (payload: T) => {
    clearTimeout(timer);
    resolve(payload);
  });
  return promise;
}

function emitAck(
  socket: Socket,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
  socket.emit(event, payload, resolve);
  return promise;
}

describe('Client-initiated egress (e2e)', () => {
  let app: INestApplication<App>;
  let httpUrl: string;
  let webhookUrl: string;
  let roomId: string;
  const sockets: Socket[] = [];
  const received: ReceivedWebhook[] = [];
  const webhookServer: HttpServer = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/webhook')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as ReceivedWebhook;
        received.push(parsed);
      } catch {
        // ignore malformed frames
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });

  const generatedKey = ApiKeyHelper.generate();
  const rooms = new Map<string, TestRoom>();
  const egressRows = new Map<string, TestEgressRow>();
  let egressCounter = 0;
  let projectWebhook: { url: string | null; secret: string | null } = {
    url: null,
    secret: null,
  };

  function connectSocket(): Socket {
    const socket = io(`${httpUrl}/sfu`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  async function joinWithToken(
    socket: Socket,
    token: string,
  ): Promise<string[]> {
    const joined = waitFor<{ capabilities: string[] }>(socket, 'sfu:joined');
    socket.emit('sfu:join', { roomId, token });
    return (await joined).capabilities;
  }

  async function mintToken(body: Record<string, unknown>): Promise<string> {
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set({ Authorization: `Bearer ${generatedKey.key}` })
      .send(body);
    expect(mint.status).toBe(201);
    return mint.body.token as string;
  }

  async function waitForWebhook(
    type: string,
    timeoutMs = 8000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = received.find((webhook) => webhook.type === type);
      if (hit) return hit.data;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for webhook ${type}`);
      }
      const { promise: nap, resolve: wake } = Promise.withResolvers<void>();
      setTimeout(wake, 100);
      await nap;
    }
  }

  /** Publishes one audio producer so the egress pipeline has an input. */
  async function publishAudio(socket: Socket): Promise<void> {
    const transportCreated = waitFor<{
      transportId: string;
      direction: string;
    }>(socket, 'sfu:transport-created');
    socket.emit('sfu:create-send-transport');
    const transport = await transportCreated;
    expect(transport.direction).toBe('send');
    const producerCreated = waitFor<{ requestId: string }>(
      socket,
      'sfu:producer-created',
    );
    socket.emit('sfu:produce', {
      requestId: 'req-audio',
      transportId: transport.transportId,
      kind: 'audio',
      rtpParameters: { codecs: [], headerExtensions: [] },
    });
    await producerCreated;
  }

  beforeAll(async () => {
    const { promise: listening, resolve } = Promise.withResolvers<void>();
    webhookServer.listen(0, '127.0.0.1', () => resolve());
    await listening;
    const webhookPort = (webhookServer.address() as { port: number }).port;
    webhookUrl = `http://127.0.0.1:${webhookPort}/webhook`;

    const keyRecord = {
      id: 'key-e2e-egress',
      keyHash: generatedKey.keyHash,
      prefix: generatedKey.prefix,
      projectId: 'project-e2e',
      revokedAt: null as Date | null,
    };

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
          findUnique: jest.fn(({ where }: { where: { id: string } }) => {
            if (where.id !== 'project-e2e') return null;
            return {
              id: 'project-e2e',
              webhookUrl: projectWebhook.url,
              webhookSecret: projectWebhook.secret,
            };
          }),
        },
        room: {
          findUnique: jest.fn(({ where }: { where: { id: string } }) => {
            const room = rooms.get(where.id);
            if (!room) return null;
            // The dispatcher's single enqueue query folds the owning
            // project (webhook config) into the room read.
            const project = projectWebhook
              ? {
                  id: 'project-e2e',
                  webhookUrl: projectWebhook.url,
                  webhookSecret: projectWebhook.secret,
                }
              : null;
            return { ...room, messages: [], project };
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
          findMany: jest.fn(() => [...rooms.values()]),
          create: jest.fn(({ data }: { data: Partial<TestRoom> }) => {
            const room: TestRoom = {
              id: `room-${rooms.size + 1}`,
              slug: data.slug ?? `slug-${rooms.size + 1}`,
              projectId: data.projectId ?? null,
              ownerId: data.ownerId ?? null,
              name: data.name ?? null,
              status: 'active',
              maxParticipants: data.maxParticipants ?? 10,
            };
            rooms.set(room.id, room);
            return room;
          }),
          update: jest.fn(),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        egress: {
          findFirst: jest.fn(
            ({
              where,
            }: {
              where: { roomId: string; status?: { in: string[] } };
            }) => {
              const statuses = where.status?.in;
              return (
                [...egressRows.values()].find(
                  (row) =>
                    row.roomId === where.roomId &&
                    (!statuses || statuses.includes(row.status)),
                ) ?? null
              );
            },
          ),
          findUnique: jest.fn(
            async ({ where }: { where: { id: string } }) =>
              egressRows.get(where.id) ?? null,
          ),
          findUniqueOrThrow: jest.fn(
            async ({ where }: { where: { id: string } }) =>
              egressRows.get(where.id),
          ),
          findMany: jest.fn(() => [...egressRows.values()]),
          create: jest.fn(({ data }: { data: Partial<TestEgressRow> }) => {
            egressCounter += 1;
            const row: TestEgressRow = {
              id: `egress-${egressCounter}`,
              roomId: data.roomId ?? '',
              projectId: data.projectId ?? '',
              outputs: (data.outputs as TestEgressRow['outputs']) ?? {
                rtmpEndpoints: [],
                hls: false,
                record: false,
              },
              status: 'starting',
              endedReason: null,
              error: null,
              recordingSizeBytes: null,
              recordingFinalizedAt: null,
              startedAt: new Date(),
              endedAt: null,
            };
            egressRows.set(row.id, row);
            return row;
          }),
          update: jest.fn(
            async ({
              where,
              data,
            }: {
              where: { id: string };
              data: Partial<TestEgressRow>;
            }) => {
              const row = egressRows.get(where.id);
              if (!row) throw new Error('missing egress row');
              Object.assign(row, data);
              return row;
            },
          ),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      })
      .overrideProvider(WorkerManager)
      .useValue({
        createRouter: jest.fn(),
        getRtpCapabilities: jest.fn(() => ({
          codecs: [],
          headerExtensions: [],
        })),
        getRouter: jest.fn(() => ({
          createPlainTransport: jest.fn().mockResolvedValue({
            connect: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            consume: jest.fn().mockResolvedValue({
              id: 'egress-consumer-e2e',
              rtpParameters: {
                codecs: [
                  {
                    mimeType: 'audio/opus',
                    payloadType: 96,
                    clockRate: 48000,
                    channels: 2,
                    parameters: {},
                    rtcpFeedback: [],
                  },
                ],
                headerExtensions: [],
              },
              on: jest.fn(),
              close: jest.fn(),
            }),
          }),
          createWebRtcTransport: jest.fn().mockResolvedValue({
            id: 'send-transport-e2e',
            produce: jest.fn().mockResolvedValue({
              id: 'producer-audio-e2e',
              kind: 'audio',
              paused: false,
              appData: { source: 'camera' },
              on: jest.fn(),
              close: jest.fn(),
            }),
            close: jest.fn(),
          }),
        })),
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

    projectWebhook = { url: webhookUrl, secret: 'whsec-e2e' };
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app.close();
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    webhookServer.close(() => resolve());
    await closed;
  });

  it('denies egress control without the matching capability', async () => {
    const viewerToken = await mintToken({ name: 'Viewer', role: 'viewer' });
    const viewer = connectSocket();
    await joinWithToken(viewer, viewerToken);

    const denial = await emitAck(viewer, 'egress:start', { record: true });
    expect(denial).toEqual({
      ok: false,
      code: 'MISSING_CAPABILITY',
      message: expect.any(String),
    });
  });

  it('starts, mirrors, and stops a recording from the room socket', async () => {
    const hostToken = await mintToken({ name: 'Host', role: 'host' });
    const host = connectSocket();
    const hostCapabilities = await joinWithToken(host, hostToken);
    expect(hostCapabilities).toContain('start-recording');

    await publishAudio(host);

    const viewerToken = await mintToken({ name: 'Viewer', role: 'viewer' });
    const viewer = connectSocket();
    await joinWithToken(viewer, viewerToken);

    const viewerStarting = waitFor<{
      status: string;
      outputs: { record: boolean };
    }>(viewer, 'egress:status');
    const start = await emitAck(host, 'egress:start', { record: true });
    expect(start).toEqual({ ok: true });

    // Second concurrent start is a coded conflict.
    const conflict = await emitAck(host, 'egress:start', { record: true });
    expect(conflict).toEqual({
      ok: false,
      code: 'ALREADY_ACTIVE',
      message: expect.any(String),
    });

    const starting = await viewerStarting;
    expect(starting.status).toBe('starting');
    expect(starting.outputs.record).toBe(true);

    const liveFrame = await waitFor(viewer, 'egress:status', 15_000).then(
      (frame: { status: string }) => frame,
    );
    expect(liveFrame.status).toBe('live');

    const stop = await emitAck(host, 'egress:stop');
    expect(stop).toEqual({ ok: true });

    const endedFrame = await waitFor(viewer, 'egress:status').then(
      (frame: { status: string }) => frame,
    );
    expect(endedFrame.status).toBe('ended');

    // Stopping with nothing active is a coded denial, not a crash.
    const notActive = await emitAck(host, 'egress:stop');
    expect(notActive).toEqual({
      ok: false,
      code: 'NOT_ACTIVE',
      message: expect.any(String),
    });

    // The webhooks: started, stopped, then the finalized recording.
    const startedData = await waitForWebhook('egress.started');
    expect(startedData.egress).toEqual(
      expect.objectContaining({
        outputs: { rtmpEndpoints: [], hls: false, record: true },
      }),
    );
    await waitForWebhook('egress.stopped');

    const readyData = await waitForWebhook('egress.recording_ready');
    expect(readyData.egress).toEqual(
      expect.objectContaining({ id: expect.stringMatching(/^egress-/) }),
    );
    expect(readyData.recordingUrl).toMatch(
      /^\/v1\/recordings\/egress-\d+\/file$/,
    );
    expect(typeof readyData.recordingSizeBytes).toBe('number');
    expect(readyData.recordingSizeBytes as number).toBeGreaterThan(0);
  });
});
