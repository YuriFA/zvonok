import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/bootstrap';
import { WorkerManager } from '../src/sfu/worker-manager';

describe('Developer console surface (e2e)', () => {
  let app: INestApplication<App>;

  const accounts: Array<Record<string, unknown>> = [];
  const users: Array<Record<string, unknown>> = [];
  const projects = new Map<string, Record<string, unknown>>();
  const rooms = new Map<string, Record<string, unknown>>();
  const egresses = new Map<string, Record<string, unknown>>();
  const apiKeys = new Map<string, Record<string, unknown>>();

  let developerToken: string;
  let foreignToken: string;
  let projectId: string;
  let foreignProjectId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        developerAccount: {
          findUnique: jest.fn(({ where }) =>
            where.userId !== undefined
              ? (accounts.find((a) => a.userId === where.userId) ?? null)
              : (accounts.find((a) => a.username === where.username) ?? null),
          ),
          findMany: jest.fn(({ where }) =>
            accounts.filter((a) =>
              (a.username as string).startsWith(
                where.username?.startsWith ?? '\u0000',
              ),
            ),
          ),
          create: jest.fn(({ data }) => {
            const account = {
              id: `dev-${accounts.length + 1}`,
              createdAt: new Date(),
              ...data,
            };
            accounts.push(account);
            return account;
          }),
        },
        user: {
          findUnique: jest.fn(
            ({ where }) =>
              users.find(
                (u) =>
                  u.id === where.id ||
                  u.email === where.email ||
                  u.username === where.username,
              ) ?? null,
          ),
          create: jest.fn(({ data }) => {
            const user = {
              id: `user-${users.length + 1}`,
              role: 'USER',
              tokenVersion: 0,
              failedLoginAttempts: 0,
              lockedUntil: null,
              createdAt: new Date(),
              ...data,
            };
            users.push(user);
            return user;
          }),
          update: jest.fn(({ where, data }) => {
            const user = users.find((u) => u.id === where.id);
            return Object.assign(user ?? {}, data);
          }),
        },
        project: {
          create: jest.fn(({ data }) => {
            const project = {
              id: `project-${projects.size + 1}`,
              webhookUrl: null,
              webhookSecret: null,
              createdAt: new Date(),
              ...data,
            };
            projects.set(project.id, project);
            return project;
          }),
          findFirst: jest.fn(({ where }) => {
            const project = projects.get(where.id);
            if (!project) return null;
            if (
              where.developerAccountId &&
              project.developerAccountId !== where.developerAccountId
            ) {
              return null;
            }
            return project;
          }),
          findMany: jest.fn(({ where, select }) =>
            [...projects.values()]
              .filter(
                (project) =>
                  project.developerAccountId === where.developerAccountId,
              )
              .map((project) => {
                // Prisma computes _count from the owned rooms relation.
                const row = {
                  ...project,
                  _count: {
                    rooms: [...rooms.values()].filter(
                      (room) => room.projectId === project.id,
                    ).length,
                  },
                };
                if (!select) return row;
                const projected: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(select)) {
                  if (key === '_count') {
                    projected._count = row._count;
                  } else if (value) {
                    projected[key] = row[key];
                  }
                }
                return projected;
              }),
          ),
          update: jest.fn(({ where, data }) => {
            const project = projects.get(where.id);
            return Object.assign(project ?? {}, data);
          }),
        },
        room: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn(({ where, select }) =>
            [...rooms.values()]
              .filter((room) => room.projectId === where.projectId)
              .map((room) => {
                if (!select) return room;
                // Mirror Prisma's select projection.
                const projected: Record<string, unknown> = {};
                for (const [key, enabled] of Object.entries(select)) {
                  if (enabled) projected[key] = room[key];
                }
                return projected;
              }),
          ),
        },
        apiKey: {
          create: jest.fn(({ data }) => {
            const key = { id: `key-${apiKeys.size + 1}`, ...data };
            apiKeys.set(key.id, key);
            return key;
          }),
          findMany: jest.fn(({ where }) =>
            [...apiKeys.values()]
              .filter((key) => key.projectId === where.projectId)
              .sort(
                (a, b) =>
                  new Date(b.createdAt as Date).getTime() -
                  new Date(a.createdAt as Date).getTime(),
              ),
          ),
          findFirst: jest.fn(
            ({ where }) =>
              [...apiKeys.values()].find(
                (key) =>
                  key.id === where.id?.keyId &&
                  (key as { project?: unknown }).project,
              ) ?? null,
          ),
        },
        egress: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn(({ where }) =>
            [...egresses.values()].filter(
              (row) =>
                row.projectId === where.projectId &&
                (row.outputs as { record?: boolean }).record === true,
            ),
          ),
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers two developers and returns session tokens', async () => {
    const first = await request(app.getHttpServer())
      .post('/developers/auth/register')
      .send({ username: 'console-dev', password: 'Password1' });
    expect(first.status).toBe(201);
    expect(first.body.token).toBeTruthy();
    developerToken = first.body.token;

    const second = await request(app.getHttpServer())
      .post('/developers/auth/register')
      .send({ username: 'other-dev', password: 'Password1' });
    expect(second.status).toBe(201);
    foreignToken = second.body.token;
  });

  it('creates a project for the developer', async () => {
    const created = await request(app.getHttpServer())
      .post('/developers/projects')
      .set('Authorization', `Bearer ${developerToken}`)
      .send({ name: 'Console E2E' });
    expect(created.status).toBe(201);
    projectId = created.body.id;

    const foreign = await request(app.getHttpServer())
      .post('/developers/projects')
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({ name: 'Foreign' });
    foreignProjectId = foreign.body.id;
  });

  it('lists only the owner projects with room counts', async () => {
    const list = await request(app.getHttpServer())
      .get('/developers/projects')
      .set('Authorization', `Bearer ${developerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: projectId,
      name: 'Console E2E',
      roomCount: 0,
    });
    expect(list.body.items[0]).not.toHaveProperty('webhookSecret');
    expect(list.body.next).toBeNull();
  });

  it('creates and lists an API key for the project', async () => {
    const created = await request(app.getHttpServer())
      .post(`/developers/projects/${projectId}/keys`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(created.status).toBe(201);
    expect(created.body.key).toBeTruthy();

    const list = await request(app.getHttpServer())
      .get(`/developers/projects/${projectId}/keys`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].prefix).toBe(created.body.prefix);
    expect(list.body[0]).not.toHaveProperty('key');
  });

  it('lists project rooms with lifecycle fields', async () => {
    rooms.set('room-e2e', {
      id: 'room-e2e',
      name: 'Standup',
      slug: 'standup',
      projectId,
      status: 'ended',
      createdAt: new Date('2026-09-07T10:00:00Z'),
      endedAt: new Date('2026-09-07T10:30:00Z'),
      messages: [{ id: 'should-not-leak' }],
      ownerId: 'should-not-leak',
    });

    const list = await request(app.getHttpServer())
      .get(`/developers/projects/${projectId}/rooms`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: 'room-e2e',
      status: 'ended',
    });
    expect(list.body.items[0]).not.toHaveProperty('messages');
    expect(list.body.items[0]).not.toHaveProperty('ownerId');
  });

  it('lists project recordings, newest first', async () => {
    egresses.set('egress-e2e', {
      id: 'egress-e2e',
      projectId,
      roomId: 'room-e2e',
      status: 'ended',
      startedAt: new Date('2026-09-07T10:00:00Z'),
      endedAt: new Date('2026-09-07T10:30:00Z'),
      outputs: { record: true },
      recordingSizeBytes: 2048,
      recordingFinalizedAt: new Date('2026-09-07T10:30:05Z'),
    });
    egresses.set('egress-no-record', {
      id: 'egress-no-record',
      projectId,
      roomId: 'room-e2e',
      status: 'ended',
      startedAt: new Date(),
      endedAt: new Date(),
      outputs: { record: false },
    });

    const list = await request(app.getHttpServer())
      .get(`/developers/projects/${projectId}/recordings`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: 'egress-e2e' });
    expect(list.body.next).toBeNull();
  });

  it('hides foreign projects behind 404 on every read', async () => {
    const rooms404 = await request(app.getHttpServer())
      .get(`/developers/projects/${foreignProjectId}/rooms`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(rooms404.status).toBe(404);

    const recordings404 = await request(app.getHttpServer())
      .get(`/developers/projects/${foreignProjectId}/recordings`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(recordings404.status).toBe(404);

    const keys404 = await request(app.getHttpServer())
      .get(`/developers/projects/${foreignProjectId}/keys`)
      .set('Authorization', `Bearer ${developerToken}`);
    expect(keys404.status).toBe(404);
  });

  it('rejects unauthenticated developer reads with 401', async () => {
    const unauthorized = await request(app.getHttpServer()).get(
      '/developers/projects',
    );
    expect(unauthorized.status).toBe(401);
  });

  it('signs an app user into the console through the site session', async () => {
    // App account through the regular site flow.
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'sitedev',
        email: 'sitedev@example.com',
        password: 'Password1',
      });
    expect(registered.status).toBe(201);
    users.push({
      id: 'user-site-1',
      username: 'sitedev',
      passwordHash: 'site-hash',
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sitedev@example.com', password: 'Password1' });
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie'];
    expect(cookies).toBeTruthy();

    const sso = await request(app.getHttpServer())
      .post('/developers/auth/sso')
      .set('Cookie', cookies);
    expect(sso.status).toBe(200);
    expect(sso.body).toMatchObject({
      username: 'sitedev',
      created: true,
    });
    expect(sso.body.token).toBeTruthy();

    // The dev token works on the read surface.
    const list = await request(app.getHttpServer())
      .get('/developers/projects')
      .set('Authorization', `Bearer ${sso.body.token}`);
    expect(list.status).toBe(200);

    // The copied credentials work at the manual login.
    const manual = await request(app.getHttpServer())
      .post('/developers/auth/login')
      .send({ username: 'sitedev', password: 'Password1' });
    expect(manual.status).toBe(200);
    expect(manual.body.token).toBeTruthy();

    // Repeat sign-in reuses the linked account.
    const again = await request(app.getHttpServer())
      .post('/developers/auth/sso')
      .set('Cookie', cookies);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ username: 'sitedev', created: false });
  });

  it('rejects SSO without an app session with 401', async () => {
    const unauthorized = await request(app.getHttpServer()).post(
      '/developers/auth/sso',
    );
    expect(unauthorized.status).toBe(401);
  });
});
