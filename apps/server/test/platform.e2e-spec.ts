import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ApiKeyHelper } from '../src/developer/api-key.helper';
import { WorkerManager } from '../src/sfu/worker-manager';
import { SfuService } from '../src/sfu/sfu.service';
import { EGRESS_RECORDINGS_DIR } from '../src/egress/egress.config';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server as NetServer } from 'node:net';

jest.mock('../src/egress/ffmpeg/ffmpeg-process', () => ({
  FFmpegProcess: {
    spawn: jest.fn(() => ({
      on: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));
jest.mock('../src/egress/ffmpeg/args-composer', () => ({
  generateSdp: jest.fn(() => 'sdp'),
  composeEgressArgs: jest.fn(() => ['-nostdin']),
}));

interface TestRoom {
  createdAt?: Date;
  id: string;
  name?: string;
  slug: string;
  ownerId?: string;
  projectId?: string;
  status: string;
  maxParticipants: number;
}

describe('Developer platform (e2e)', () => {
  let app: INestApplication<App>;
  let httpUrl: string;
  const sockets: Socket[] = [];

  const generatedKey = ApiKeyHelper.generate();
  const keyRecord = {
    id: 'key-e2e',
    keyHash: generatedKey.keyHash,
    prefix: generatedKey.prefix,
    projectId: 'project-e2e',
    revokedAt: null as Date | null,
  };
  const rooms = new Map<string, TestRoom>();
  const egresses = new Map<
    string,
    Record<string, unknown> & { id: string; roomId: string; status: string }
  >();

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
          findUnique: jest.fn(
            async ({ where }) => egresses.get(where.id) ?? null,
          ),
          findUniqueOrThrow: jest.fn(async ({ where }) =>
            egresses.get(where.id),
          ),
          findFirst: jest.fn(({ where }) => {
            for (const row of egresses.values()) {
              if (row.roomId !== where.roomId) continue;
              if (where.status?.in?.includes(row.status)) return row;
            }
            return null;
          }),
          findMany: jest.fn(() =>
            [...egresses.values()].filter(
              (row) => row.projectId === 'project-e2e',
            ),
          ),
          create: jest.fn(({ data }) => {
            const row = {
              id: `egress-${egresses.size + 1}`,
              status: 'starting',
              endedReason: null,
              error: null,
              startedAt: new Date(),
              endedAt: null,
              ...data,
            };
            egresses.set(row.id, row);
            return row;
          }),
          update: jest.fn(({ where, data }) => {
            const next = { ...(egresses.get(where.id) ?? {}), ...data };
            egresses.set(where.id, next);
            return next;
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        room: {
          findUnique: jest.fn(({ where }) => rooms.get(where.id) ?? null),
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
          findMany: jest.fn(
            ({
              where,
              take,
            }: {
              where?: {
                OR?: Array<{
                  createdAt?: { lt?: string };
                  id?: { lt?: string };
                }>;
              };
              take?: number;
            }) => {
              let rows = [...rooms.values()].filter(
                (room) => room.projectId === 'project-e2e',
              );
              // Mirror Prisma tuple-cursor semantics for the paginated list.
              const [ltBranch, eqBranch] = where?.OR ?? [];
              const orderLt = ltBranch?.createdAt?.lt;
              if (orderLt !== undefined) {
                rows = rows.filter((room) => {
                  const iso = (room.createdAt ?? new Date(0)).toISOString();
                  const idLt = eqBranch?.id?.lt ?? '';
                  return iso < orderLt || (iso === orderLt && room.id < idLt);
                });
              }
              rows.sort((a, b) => {
                const at = (a.createdAt ?? new Date(0)).getTime();
                const bt = (b.createdAt ?? new Date(0)).getTime();
                if (bt !== at) return bt - at;
                return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
              });
              return take !== undefined ? rows.slice(0, take) : rows;
            },
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
              createdAt: new Date(),
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
      // The suite fires dozens of /v1 calls inside one throttle window;
      // rate limiting itself is covered elsewhere. A passthrough storage
      // keeps both real guards active but never blocks.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        storage: new Map(),
        increment: async () => ({
          totalHits: 0,
          timeFrameNextRefresh: 0,
          isBlocked: false,
          blockDurationNextRefresh: 0,
        }),
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
  });

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app.close();
  });

  const bearer = { Authorization: `Bearer ${generatedKey.key}` };

  it('rejects /v1 requests without an API key', async () => {
    const response = await request(app.getHttpServer()).get('/v1/rooms');

    expect(response.status).toBe(401);
  });

  it('creates a project room via the public API', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({ maxParticipants: 5 });

    expect(response.status).toBe(201);
    expect(response.body.slug).toEqual(expect.any(String));
    (globalThis as Record<string, unknown>).__e2eRoomId = response.body.id;
  });

  it('joins via room token and receives peer events', async () => {
    const roomId = (globalThis as Record<string, unknown>)
      .__e2eRoomId as string;
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set(bearer)
      .send({ name: 'Alice' });

    expect(mint.status).toBe(201);
    expect(mint.body.token).toEqual(expect.any(String));
    expect(mint.body.expiresAt).toEqual(expect.any(String));

    const first = connectSocket();
    const joined = waitFor<{ routerRtpCapabilities: unknown }>(
      first,
      'sfu:joined',
    );
    first.emit('sfu:join', {
      roomId,
      userId: 'should-be-ignored',
      username: 'Ignored',
      token: mint.body.token,
    });

    const joinedPayload: { routerRtpCapabilities: unknown } = await joined;
    expect(joinedPayload.routerRtpCapabilities).toBeDefined();

    const secondMint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set(bearer)
      .send({ name: 'Bob' });

    const second = connectSocket();
    const peerJoined = waitFor<{ username?: string }>(first, 'sfu:peer-joined');
    const existing = waitFor<Array<{ username?: string }>>(
      second,
      'sfu:existing-peers',
    );
    second.emit('sfu:join', {
      roomId,
      userId: 'ignored-2',
      username: 'Ignored2',
      token: secondMint.body.token,
    });

    const peerJoinedPayload: { username?: string } = await peerJoined;
    expect(peerJoinedPayload.username).toBe('Bob');

    const existingPayload = await existing;
    expect(existingPayload).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: 'Alice' })]),
    );
  });

  it('relays data-channel broadcasts with coded denials', async () => {
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({});
    const roomId = room.body.id as string;

    const mintFor = async (body: Record<string, unknown>) => {
      const mint = await request(app.getHttpServer())
        .post(`/v1/rooms/${roomId}/tokens`)
        .set(bearer)
        .send(body);
      expect(mint.status).toBe(201);
      return mint.body.token as string;
    };

    const joinWith = async (token: string) => {
      const socket = connectSocket();
      const joined = waitFor(socket, 'sfu:joined');
      socket.emit('sfu:join', { roomId, token });
      await joined;
      return socket;
    };

    const alice = await joinWith(await mintFor({ name: 'Alice' }));
    const bob = await joinWith(await mintFor({ name: 'Bob' }));
    const viewer = await joinWith(
      await mintFor({ name: 'Watch', role: 'viewer' }),
    );
    let aliceBroadcasts = 0;
    alice.on('sfu:broadcast', () => {
      aliceBroadcasts += 1;
    });
    const relayed = waitFor<{
      senderId: string;
      topic: string;
      payload: unknown;
      timestamp: string;
    }>(bob, 'sfu:broadcast');
    const viewerRelay = waitFor(viewer, 'sfu:broadcast');

    const ack = new Promise<Record<string, unknown>>((resolve) => {
      alice.emit(
        'sfu:broadcast',
        { topic: 'reactions', payload: { emoji: 'wave' } },
        resolve,
      );
    });
    expect(await ack).toEqual({ ok: true });

    const message = await relayed;
    expect(message).toEqual({
      senderId: expect.any(String),
      topic: 'reactions',
      payload: { emoji: 'wave' },
      timestamp: expect.any(String),
    });
    // The viewer is a participant of the room and receives the relay too;
    // only the sender is skipped.
    expect(await viewerRelay).toEqual(message);
    expect(aliceBroadcasts).toBe(0);

    // Viewer-role denial: coded ack, nothing relayed.
    const viewerAck = new Promise<Record<string, unknown>>((resolve) => {
      viewer.emit('sfu:broadcast', { topic: 'reactions', payload: 1 }, resolve);
    });
    expect(await viewerAck).toEqual({
      ok: false,
      code: 'MISSING_CAPABILITY',
      message: expect.any(String),
    });

    // Oversized payload: coded ack, nothing relayed.
    const bigAck = new Promise<Record<string, unknown>>((resolve) => {
      alice.emit(
        'sfu:broadcast',
        { topic: 'blob', payload: { data: 'x'.repeat(8193) } },
        resolve,
      );
    });
    expect(await bigAck).toEqual({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: expect.any(String),
    });

    // Malformed topic: coded ack.
    const topicAck = new Promise<Record<string, unknown>>((resolve) => {
      alice.emit('sfu:broadcast', { topic: 'has space', payload: 1 }, resolve);
    });
    expect(await topicAck).toEqual({
      ok: false,
      code: 'INVALID_TOPIC',
      message: expect.any(String),
    });
  });

  it('recovers blips through the grace window and keeps kicks terminal', async () => {
    const sfuService = app.get(SfuService);
    const previousGrace = sfuService.rejoinGraceMs;
    sfuService.rejoinGraceMs = 400;

    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const collect = (socket: Socket, event: string) => {
      const seen: Array<Record<string, unknown>> = [];
      socket.on(event, (payload: Record<string, unknown>) =>
        seen.push(payload),
      );
      return seen;
    };

    try {
      const room = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set(bearer)
        .send({});
      const roomId = room.body.id as string;

      const mintFor = async (body: Record<string, unknown>) => {
        const mint = await request(app.getHttpServer())
          .post(`/v1/rooms/${roomId}/tokens`)
          .set(bearer)
          .send(body);
        expect(mint.status).toBe(201);
        return mint.body.token as string;
      };
      const joinWith = async (token: string) => {
        const socket = connectSocket();
        const joined = waitFor(socket, 'sfu:joined');
        socket.emit('sfu:join', { roomId, token });
        const payload = (await joined) as { participant?: { id?: string } };
        return { socket, participantId: payload.participant?.id as string };
      };

      const host = await joinWith(
        await mintFor({ name: 'Host', role: 'host' }),
      );
      const bobToken = await mintFor({ name: 'Bob' });
      const bob = await joinWith(bobToken);

      const hostLeft = collect(host.socket, 'sfu:peer-left');
      const hostJoined = collect(host.socket, 'sfu:peer-joined');

      // Blip: bob's socket dies and a fresh socket rejoins with the same
      // token (same participant id) inside the grace window.
      bob.socket.disconnect();
      await sleep(150);
      expect(hostLeft).toHaveLength(0);

      const bobAgain = await joinWith(bobToken);
      expect(hostLeft).toHaveLength(0);
      expect(hostJoined).toHaveLength(0);

      // Grace expiry: a peer that never returns is announced as gone.
      bobAgain.socket.disconnect();
      const departed = await waitFor<{ userId?: string }>(
        host.socket,
        'sfu:peer-left',
      );
      expect(departed.userId).toBe(bob.participantId);

      // Kick terminality: a kicked participant's rejoin is refused with the
      // kick denial even inside what would be their grace window.
      const carolToken = await mintFor({ name: 'Carol' });
      const carol = await joinWith(carolToken);
      const kickAck = new Promise<{ ok?: boolean }>((resolve) => {
        host.socket.emit(
          'sfu:kick-peer',
          { userId: carol.participantId },
          (ack: { ok?: boolean }) => resolve(ack),
        );
      });
      expect(await kickAck).toEqual({ ok: true });
      await sleep(150); // let the kicked socket's disconnect settle

      const carolAgain = connectSocket();
      const joinError = waitFor<{ code?: string }>(
        carolAgain,
        'sfu:join-error',
      );
      carolAgain.emit('sfu:join', { roomId, token: carolToken });
      expect(await joinError).toEqual(
        expect.objectContaining({ code: 'KICKED_FROM_ROOM' }),
      );
    } finally {
      sfuService.rejoinGraceMs = previousGrace;
    }
  });

  it('refuses publishing for a viewer-role token', async () => {
    const roomId = (globalThis as Record<string, unknown>)
      .__e2eRoomId as string;
    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set(bearer)
      .send({ role: 'viewer' });

    const socket = connectSocket();
    const joined = waitFor(socket, 'sfu:joined');
    socket.emit('sfu:join', {
      roomId,
      userId: 'viewer',
      username: 'viewer',
      token: mint.body.token,
    });
    await joined;

    const produceError = waitFor<{ code?: string }>(
      socket,
      'sfu:produce-error',
    );
    socket.emit('sfu:produce', {
      requestId: 'req-e2e-1',
      transportId: 'nonexistent',
      kind: 'video',
      rtpParameters: {},
    });

    const error: { code?: string } = await produceError;
    expect(error.code).toBe('PUBLISH_NOT_ALLOWED');
  });

  it('refuses a token minted for a different room', async () => {
    const otherRoom = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({});

    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${otherRoom.body.id}/tokens`)
      .set(bearer)
      .send({});

    const socket = connectSocket();
    const joinError = waitFor<{ code?: string }>(socket, 'sfu:join-error');
    socket.emit('sfu:join', {
      roomId: (globalThis as Record<string, unknown>).__e2eRoomId as string,
      userId: 'u',
      username: 'u',
      token: mint.body.token,
    });

    const error: { code?: string } = await joinError;
    expect(error.code).toBe('ROOM_TOKEN_ROOM_MISMATCH');
  });

  it('rejects egress start without outputs', async () => {
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({});
    const response = await request(app.getHttpServer())
      .post(`/v1/rooms/${room.body.id}/egress`)
      .set(bearer)
      .send({});

    expect(response.status).toBe(400);
  });

  it('rejects egress start with a non-RTMP endpoint', async () => {
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({});
    const response = await request(app.getHttpServer())
      .post(`/v1/rooms/${room.body.id}/egress`)
      .set(bearer)
      .send({ rtmpEndpoints: ['https://example.com/live'] });

    expect(response.status).toBe(400);
  });

  it('starts, inspects, and stops an egress session', async () => {
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({});
    const roomId = room.body.id as string;

    const started = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/egress`)
      .set(bearer)
      .send({ hls: true });
    expect(started.body.outputs).toEqual({
      rtmpEndpoints: [],
      hls: true,
      record: false,
    });
    expect(started.status).toBe(201);
    expect(started.body.status).toBe('starting');
    expect(started.body.hlsUrl).toBe(
      `/egress/hls/${started.body.id}/index.m3u8`,
    );

    // A second active session for the same room is refused.
    const second = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/egress`)
      .set(bearer)
      .send({ rtmpEndpoints: ['rtmp://example.com/live'] });
    expect(second.status).toBe(409);

    const list = await request(app.getHttpServer())
      .get(`/v1/rooms/${roomId}/egress`)
      .set(bearer);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.next).toBeNull();

    const inspect = await request(app.getHttpServer())
      .get(`/v1/egress/${started.body.id}`)
      .set(bearer);
    expect(inspect.status).toBe(200);
    expect(inspect.body.roomId).toBe(roomId);

    const stopped = await request(app.getHttpServer())
      .post(`/v1/egress/${started.body.id}/stop`)
      .set(bearer);
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe('ended');
    expect(stopped.body.endedReason).toBe('stopped');

    const again = await request(app.getHttpServer())
      .post(`/v1/egress/${started.body.id}/stop`)
      .set(bearer);
    expect(again.status).toBe(409);

    // The room accepts a fresh session after the previous one ended.
    const restarted = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/egress`)
      .set(bearer)
      .send({ hls: true });
    expect(restarted.status).toBe(201);
  });

  it('records, lists, downloads (200/206), and deletes a recording', async () => {
    const room = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set(bearer)
      .send({});
    const roomId = room.body.id as string;

    const started = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/egress`)
      .set(bearer)
      .send({ record: true });
    expect(started.status).toBe(201);
    expect(started.body.outputs).toEqual({
      rtmpEndpoints: [],
      hls: false,
      record: true,
    });
    expect(started.body.recordingUrl).toBe(
      `/v1/recordings/${started.body.id}/file`,
    );
    const egressId = started.body.id as string;

    // Graceful stop finalizes (no media in this mocked harness, so no size).
    const stopped = await request(app.getHttpServer())
      .post(`/v1/egress/${egressId}/stop`)
      .set(bearer);
    expect(stopped.status).toBe(200);

    // Simulate a finalized artifact on disk.
    const sessionDir = join(EGRESS_RECORDINGS_DIR, egressId);
    mkdirSync(sessionDir, { recursive: true });
    const bytes = Buffer.alloc(100, 7);
    writeFileSync(join(sessionDir, 'recording.mp4'), bytes);

    const list = await request(app.getHttpServer())
      .get('/v1/recordings')
      .set(bearer);
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(
      egressId,
    );

    const listByRoom = await request(app.getHttpServer())
      .get(`/v1/recordings?roomId=${roomId}`)
      .set(bearer);
    expect(listByRoom.body.items.map((r: { id: string }) => r.id)).toContain(
      egressId,
    );

    const full = await request(app.getHttpServer())
      .get(`/v1/recordings/${egressId}/file`)
      .set(bearer);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['content-length']).toBe('100');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.body).toEqual(bytes);

    const partial = await request(app.getHttpServer())
      .get(`/v1/recordings/${egressId}/file`)
      .set(bearer)
      .set('Range', 'bytes=10-');
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 10-99/100');
    expect(partial.headers['content-length']).toBe('90');
    expect(partial.body).toEqual(bytes.subarray(10));

    const unsatisfiable = await request(app.getHttpServer())
      .get(`/v1/recordings/${egressId}/file`)
      .set(bearer)
      .set('Range', 'bytes=100000-');
    expect(unsatisfiable.status).toBe(416);

    const deleted = await request(app.getHttpServer())
      .delete(`/v1/recordings/${egressId}`)
      .set(bearer);
    expect(deleted.status).toBe(204);
    const gone = await request(app.getHttpServer())
      .get(`/v1/recordings/${egressId}/file`)
      .set(bearer);
    expect(gone.status).toBe(404);

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('hides another project recording from list and download', async () => {
    const foreignDir = join(EGRESS_RECORDINGS_DIR, 'egress-foreign');
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(join(foreignDir, 'recording.mp4'), Buffer.alloc(8, 1));
    egresses.set('egress-foreign', {
      id: 'egress-foreign',
      roomId: 'room-e2e',
      projectId: 'other-project',
      outputs: { rtmpEndpoints: [], hls: false, record: true },
      status: 'ended',
      endedReason: 'stopped',
      error: null,
      startedAt: new Date(),
      endedAt: new Date(),
      recordingSizeBytes: null,
      recordingFinalizedAt: null,
    });

    const list = await request(app.getHttpServer())
      .get('/v1/recordings')
      .set(bearer);
    expect(list.body.items.map((r: { id: string }) => r.id)).not.toContain(
      'egress-foreign',
    );

    const download = await request(app.getHttpServer())
      .get('/v1/recordings/egress-foreign/file')
      .set(bearer);
    expect(download.status).toBe(404);

    rmSync(foreignDir, { recursive: true, force: true });
  });

  it('paginates the room list with stable cursors', async () => {
    // The suite fired dozens of /v1 calls inside one throttle window; reset
    // the counters so the walk can measure pagination, not budget.
    // The suite has accumulated rooms for this project by now.
    const full = await request(app.getHttpServer())
      .get('/v1/rooms')
      .set(bearer);
    expect(full.status).toBe(200);
    const expectedIds = (full.body.items as Array<{ id: string }>).map(
      (r) => r.id,
    );
    expect(new Set(expectedIds).size).toBe(expectedIds.length);
    expect(full.body.next).toBeNull();

    // Walk one row at a time: exact coverage, newest-first, stable under
    // a concurrent insert after the first page.
    const walked: string[] = [];
    let cursor: string | null = null;
    let insertedBetweenPages = false;
    do {
      const page = await request(app.getHttpServer())
        .get(`/v1/rooms?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
        .set(bearer);
      expect(page.status).toBe(200);
      expect(page.body.items).toHaveLength(1);
      walked.push(page.body.items[0].id);
      cursor = page.body.next;
      if (!insertedBetweenPages) {
        insertedBetweenPages = true;
        const newer = await request(app.getHttpServer())
          .post('/v1/rooms')
          .set(bearer)
          .send({});
        expect(newer.status).toBe(201);
      }
    } while (cursor);

    // The insert happened after page one: the walk keeps covering the
    // previously observed rows exactly once, newest first.
    expect(walked).toEqual(expectedIds);

    // Invalid paging parameters answer 400, never a partial page.
    const badLimit = await request(app.getHttpServer())
      .get('/v1/rooms?limit=500')
      .set(bearer);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.items).toBeUndefined();

    const badCursor = await request(app.getHttpServer())
      .get('/v1/rooms?cursor=not-a-cursor')
      .set(bearer);
    expect(badCursor.status).toBe(400);
  });

  it('ends a room via the public API', async () => {
    const roomId = (globalThis as Record<string, unknown>)
      .__e2eRoomId as string;
    const response = await request(app.getHttpServer())
      .delete(`/v1/rooms/${roomId}`)
      .set(bearer);

    expect(response.status).toBe(204);
    expect(rooms.get(roomId)?.status).toBe('ended');

    const mint = await request(app.getHttpServer())
      .post(`/v1/rooms/${roomId}/tokens`)
      .set(bearer)
      .send({});

    expect(mint.status).toBe(400);
  });
});
