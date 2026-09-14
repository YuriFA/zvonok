import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { WorkerManager } from '../src/sfu/worker-manager';
import { Role } from '../src/generated/prisma/enums';
import { RoomCleanupService } from '../src/room/cleanup.service';

interface RoomRow {
  id: string;
  name: string | null;
  slug: string;
  ownerId: string | null;
  projectId: string | null;
  status: string;
  createdAt: Date;
  endedAt: Date | null;
}

interface MessageRow {
  id: string;
  content: string;
  userId: string | null;
  roomId: string;
  createdAt: Date;
  user?: { username: string } | null;
}

describe('Meeting history (e2e)', () => {
  let app: INestApplication<App>;
  let nextId: number;
  let hostToken: string;
  let roomRows: Map<string, RoomRow>;
  let messageRows: MessageRow[];
  let recordRows: Map<string, Record<string, unknown>>;

  beforeAll(async () => {
    nextId = 1;
    roomRows = new Map();
    messageRows = [];
    recordRows = new Map();

    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
      room: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row: RoomRow = {
            id: `room-${nextId++}`,
            name: (data.name as string) ?? null,
            slug: data.slug as string,
            ownerId: (data.ownerId as string) ?? null,
            projectId: (data.projectId as string) ?? null,
            status: 'active',
            createdAt: new Date('2026-09-07T10:00:00Z'),
            endedAt: null,
          };
          roomRows.set(row.id, row);
          return row;
        }),
        findUnique: jest.fn(
          ({ where }: { where: { id?: string; slug?: string } }) => {
            let row: RoomRow | null | undefined;
            if (where.id) {
              row = roomRows.get(where.id);
            } else {
              for (const candidate of roomRows.values()) {
                if (candidate.slug === where.slug) {
                  row = candidate;
                  break;
                }
              }
            }
            if (!row) return null;
            return {
              ...row,
              messages: messageRows
                .filter((message) => message.roomId === row.id)
                .map((message) => ({
                  ...message,
                  user: message.userId ? { username: 'host' } : null,
                })),
            };
          },
        ),
        update: jest.fn(
          ({ where, data }: { where: { id: string }; data: object }) => {
            const row = roomRows.get(where.id);
            return Object.assign(row ?? {}, data);
          },
        ),
        deleteMany: jest.fn(() => {
          // The hourly cleanup sweep: removes ended rooms, messages cascade.
          let count = 0;
          for (const [id, row] of roomRows) {
            if (row.status === 'ended') {
              roomRows.delete(id);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        }),
      },
      egress: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => {
          if (where.id === 'host-1') {
            return {
              id: 'host-1',
              username: 'host',
              email: 'host@example.com',
              tokenVersion: 0,
            };
          }
          return null;
        }),
      },
      message: {
        create: jest.fn(
          ({
            data,
          }: {
            data: { content: string; userId: string; roomId: string };
          }) => {
            const row: MessageRow = {
              id: `message-${nextId++}`,
              content: data.content,
              userId: data.userId,
              roomId: data.roomId,
              createdAt: new Date('2026-09-07T10:05:00Z'),
            };
            messageRows.push(row);
            return { ...row, user: { id: data.userId, username: 'host' } };
          },
        ),
        findMany: jest.fn(({ where }: { where: { roomId: string } }) =>
          messageRows
            .filter((row) => row.roomId === where.roomId)
            .map((row) => ({
              ...row,
              user: row.userId ? { id: row.userId, username: 'host' } : null,
            })),
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      callRecord: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = {
            ...data,
            id: `record-${nextId++}`,
          };
          recordRows.set(row.id, row);
          return row;
        }),
        findUnique: jest.fn(({ where }: { where: { id: string } }) => {
          return recordRows.get(where.id) ?? null;
        }),
        findMany: jest.fn(({ where }: { where: { ownerId: string } }) =>
          [...recordRows.values()]
            .filter((row) => row.ownerId === where.ownerId)
            .sort(
              (a, b) =>
                new Date(b.endedAt as Date).getTime() -
                new Date(a.endedAt as Date).getTime(),
            )
            // The list query selects without the messages payload; the
            // mock must honor that projection like the real Prisma does.
            .map((row) => {
              const { messages: _omitted, ...summary } = row;
              void _omitted;
              return summary;
            }),
        ),
        delete: jest.fn(({ where }: { where: { id: string } }) => {
          const row = recordRows.get(where.id) ?? null;
          recordRows.delete(where.id);
          return row;
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(WorkerManager)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        createRouter: jest.fn(),
        getRouter: jest.fn(),
        closeRouter: jest.fn(),
        onRoutersLost: jest.fn(() => jest.fn()),
        getRtpCapabilities: jest.fn(() => ({
          codecs: [],
          headerExtensions: [],
        })),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    // A real access token for the mocked user: the same JWT secret and
    // strategy validate it exactly as in production.
    const configService = app.get(ConfigService);
    const jwtService = app.get(JwtService);
    hostToken = jwtService.sign(
      {
        id: 'host-1',
        email: 'host@example.com',
        role: Role.HOST,
        tokenVersion: 0,
      },
      { secret: configService.get<string>('JWT_ACCESS_SECRET') },
    );
  });

  it('snapshots a ended user call and serves it after the room is cleaned up', async () => {
    const created = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ name: 'Weekly sync' });
    expect(created.status).toBe(201);
    const roomId = created.body.id as string;
    const roomSlug = created.body.slug as string;

    const message = await request(app.getHttpServer())
      .post('/messages')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ roomId, content: 'see you next week' });
    expect(message.status).toBe(201);

    const ended = await request(app.getHttpServer())
      .delete(`/rooms/${roomId}`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(ended.status).toBe(204);

    // Run the real cleanup sweep: the ended room and its messages are gone.
    // cleanupOldRooms is private; the sweep shape is exercised, not typing.
    const cleanup = app.get(RoomCleanupService);
    await cleanup.cleanupOldRooms();
    const list = await request(app.getHttpServer())
      .get('/rooms/history')
      .set('Authorization', `Bearer ${hostToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      roomName: 'Weekly sync',
      roomSlug,
      messageCount: 1,
    });
    expect(list.body[0].messages).toBeUndefined();

    const detail = await request(app.getHttpServer())
      .get(`/rooms/history/${list.body[0].id}`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages).toEqual([
      {
        author: 'host',
        content: 'see you next week',
        createdAt: '2026-09-07T10:05:00.000Z',
      },
    ]);

    const deleted = await request(app.getHttpServer())
      .delete(`/rooms/history/${list.body[0].id}`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(deleted.status).toBe(204);
    const gone = await request(app.getHttpServer())
      .get(`/rooms/history/${list.body[0].id}`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(gone.status).toBe(404);
  });

  it('hides foreign call records', async () => {
    const foreignId = 'record-foreign';
    recordRows.set(foreignId, {
      id: foreignId,
      ownerId: 'someone-else',
      roomName: 'x',
      roomSlug: 'x',
      startedAt: new Date(),
      endedAt: new Date(),
      messageCount: 0,
      messages: [],
    });

    const list = await request(app.getHttpServer())
      .get('/rooms/history')
      .set('Authorization', `Bearer ${hostToken}`);
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: string }) => row.id)).not.toContain(
      foreignId,
    );

    const detail = await request(app.getHttpServer())
      .get(`/rooms/history/${foreignId}`)
      .set('Authorization', `Bearer ${hostToken}`);
    expect(detail.status).toBe(404);
    recordRows.delete(foreignId);
  });
});
