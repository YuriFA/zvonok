jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WEBHOOK_RETRY_DELAYS_MS } from './webhook-queue';
import { WebhookQueue } from './webhook-queue';
import { WebhookSigner } from './webhook-signer';

interface RecordedRequest {
  headers: IncomingMessage['headers'];
  rawBody: string;
  parsed: {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  };
}

interface StubHandle {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

/**
 * HTTP stub whose per-request policy answers 200 ('ok'), 500 ('fail') or
 * holds the connection open ('hang').
 */
async function startStub(
  policy: (index: number) => 'ok' | 'fail' | 'hang' = () => 'ok',
): Promise<StubHandle> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        requests.push({
          headers: req.headers,
          rawBody,
          parsed: JSON.parse(rawBody),
        });
        const outcome = policy(requests.length - 1);
        if (outcome === 'hang') return;
        res.statusCode = outcome === 'ok' ? 200 : 500;
        res.end();
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function waitForRequests(
  stub: StubHandle,
  count: number,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (stub.requests.length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `Expected ${count} webhook requests, saw ${stub.requests.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Give the response round-trip a moment to complete as well.
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function expectNoRequests(
  stub: StubHandle,
  baseline: number,
  observationMs = 200,
): Promise<void> {
  const deadline = Date.now() + observationMs;
  while (Date.now() < deadline) {
    if (stub.requests.length > baseline) {
      throw new Error('Expected no further webhook requests, but one arrived');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

class FakeQueue extends WebhookQueue {
  readonly delays: number[] = [];
  private resolvers: Array<() => void> = [];

  protected override delay(ms: number): Promise<void> {
    this.delays.push(ms);
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  resolvePendingDelays(): void {
    const pending = this.resolvers.splice(0);
    for (const resolve of pending) resolve();
  }
}

const SECRET = 'dispatcher-test-secret';

function makeDispatcher(prisma: {
  room: { findUnique: jest.Mock };
  project: { findUnique: jest.Mock };
}): { dispatcher: WebhookDispatcher; queue: FakeQueue } {
  const queue = new FakeQueue();
  const dispatcher = new WebhookDispatcher(
    prisma as never,
    queue,
    new WebhookDeliveryService(new WebhookSigner()),
  );
  return { dispatcher, queue };
}

describe('WebhookDispatcher', () => {
  const project = { id: 'project-1', webhookUrl: '', webhookSecret: SECRET };

  let prisma: {
    room: { findUnique: jest.Mock };
    project: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      project: { findUnique: jest.fn() },
    };
    prisma.room.findUnique.mockImplementation(async () => ({
      slug: 'room-slug',
      // Enqueue-time project lookup is folded into the room query; tests
      // configure prisma.project.findUnique and it serves both the enqueue
      // check and the delivery-time config re-read.
      project: await prisma.project.findUnique(),
    }));
    prisma.project.findUnique.mockResolvedValue(project);
  });

  it('delivers a signed payload whose signature covers the exact raw bytes', async () => {
    const stub = await startStub();
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.roomStarted('room-1');
    await waitForRequests(stub, 1);
    await stub.close();

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request.headers['content-type']).toBe('application/json');

    const timestamp = request.headers['x-zvonok-timestamp'] as string;
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(Math.abs(Number(timestamp) - nowSeconds)).toBeLessThanOrEqual(5);

    const expected = `sha256=${createHmac('sha256', SECRET)
      .update(`${timestamp}.${request.rawBody}`)
      .digest('hex')}`;
    expect(request.headers['x-zvonok-signature']).toBe(expected);

    expect(request.parsed.type).toBe('room.started');
    expect(typeof request.parsed.timestamp).toBe('string');
    expect(new Date(request.parsed.timestamp).toISOString()).toBe(
      request.parsed.timestamp,
    );
    expect(request.parsed.data).toEqual({
      roomId: 'room-1',
      roomSlug: 'room-slug',
    });
  });

  it('prefers the roomSlug argument over the stored slug in the payload', async () => {
    const stub = await startStub();
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.participantJoined('room-1', 'payload-slug', {
      id: 'participant-1',
      displayName: 'Alice',
    });
    await waitForRequests(stub, 1);
    await stub.close();

    expect(stub.requests[0].parsed).toMatchObject({
      type: 'participant.joined',
      data: {
        roomId: 'room-1',
        roomSlug: 'payload-slug',
        participant: { id: 'participant-1', displayName: 'Alice' },
      },
    });
  });

  it('delivers participant.left with the departure reason', async () => {
    const stub = await startStub();
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.participantLeft(
      'room-1',
      undefined,
      { id: 'participant-1', displayName: 'Alice' },
      'kick',
    );
    await waitForRequests(stub, 1);
    await stub.close();

    expect(stub.requests[0].parsed).toMatchObject({
      type: 'participant.left',
      data: {
        participant: { id: 'participant-1', displayName: 'Alice' },
        reason: 'kick',
      },
    });
  });

  it('delivers participant events carrying token correlation fields verbatim', async () => {
    const stub = await startStub();
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher } = makeDispatcher(prisma);
    const metadata = { tenant: 'acme', seat: 4 };

    dispatcher.participantJoined('room-1', 'slug-1', {
      id: 'participant-1',
      displayName: 'Alice',
      externalId: 'user-42',
      metadata,
    });
    await waitForRequests(stub, 1);

    expect(stub.requests[0].parsed.data.participant).toEqual({
      id: 'participant-1',
      displayName: 'Alice',
      externalId: 'user-42',
      metadata,
    });
    await stub.close();
  });

  it('retries with the contracted backoff schedule and drops after exhaustion', async () => {
    const stub = await startStub(() => 'fail');
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher, queue } = makeDispatcher(prisma);

    dispatcher.roomEnded('room-1');
    await waitForRequests(stub, 1);

    for (
      let attempt = 2;
      attempt <= WEBHOOK_RETRY_DELAYS_MS.length + 1;
      attempt++
    ) {
      queue.resolvePendingDelays();
      await waitForRequests(stub, attempt);
    }

    await stub.close();
    // Initial attempt + 5 retries, then the delivery is dropped.
    expect(stub.requests).toHaveLength(WEBHOOK_RETRY_DELAYS_MS.length + 1);
    expect(queue.delays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000]);
  });

  it('stops retrying once an attempt succeeds', async () => {
    // First request fails, every later one succeeds.
    const stub = await startStub((index) => (index === 0 ? 'fail' : 'ok'));
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher, queue } = makeDispatcher(prisma);

    dispatcher.roomEnded('room-1');
    await waitForRequests(stub, 1);
    queue.resolvePendingDelays();
    await waitForRequests(stub, 2);
    await stub.close();

    expect(stub.requests).toHaveLength(2);
    expect(queue.delays).toEqual([10_000]);
  });

  it('keeps per-project emission order across retries (FIFO)', async () => {
    // Only the very first request fails; its retry and the following
    // deliveries succeed on the first attempt.
    const stub = await startStub((index) => (index === 0 ? 'fail' : 'ok'));
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher, queue } = makeDispatcher(prisma);

    dispatcher.roomStarted('room-1');
    dispatcher.participantJoined('room-1', undefined, {
      id: 'p1',
      displayName: 'Alice',
    });
    dispatcher.participantLeft(
      'room-1',
      undefined,
      { id: 'p1', displayName: 'Alice' },
      'leave',
    );
    dispatcher.roomEnded('room-1');

    // The first delivery is in flight (failing): nothing else may be
    // attempted until it finishes its whole retry chain.
    await waitForRequests(stub, 1);
    await expectNoRequests(stub, 1, 100);
    expect(stub.requests[0].parsed.type).toBe('room.started');

    queue.resolvePendingDelays();
    await waitForRequests(stub, 5);
    await stub.close();

    expect(stub.requests.map((r) => r.parsed.type)).toEqual([
      'room.started',
      'room.started',
      'participant.joined',
      'participant.left',
      'room.ended',
    ]);
  });

  it('is silent for user-owned rooms', async () => {
    const stub = await startStub();
    prisma.room.findUnique.mockResolvedValue({
      slug: 'user-room-slug',
      project: null,
    });
    await expectNoRequests(stub, 0);
    await stub.close();
  });

  it('is silent for unknown rooms', async () => {
    const stub = await startStub();
    prisma.room.findUnique.mockResolvedValue(null);
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.roomEnded('ghost-room');
    await expectNoRequests(stub, 0);
    await stub.close();
  });

  it('is silent for projects without webhook configuration', async () => {
    const stub = await startStub();
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      webhookUrl: null,
      webhookSecret: null,
    });
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.roomStarted('room-1');
    await expectNoRequests(stub, 0);
    await stub.close();
  });

  it('stops a retry chain immediately when the webhook config is removed', async () => {
    const stub = await startStub(() => 'fail');
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher, queue } = makeDispatcher(prisma);

    dispatcher.roomStarted('room-1');
    await waitForRequests(stub, 1);

    // The developer removes the endpoint before the retry fires.
    prisma.project.findUnique.mockResolvedValue(null);
    queue.resolvePendingDelays();
    await expectNoRequests(stub, 1);
    await stub.close();

    expect(stub.requests).toHaveLength(1);
    expect(queue.delays).toEqual([10_000]);
  });

  it('contains resolver failures instead of throwing into callers', async () => {
    const stub = await startStub();
    prisma.room.findUnique.mockRejectedValue(new Error('db down'));
    const { dispatcher } = makeDispatcher(prisma);

    expect(() => dispatcher.roomStarted('room-1')).not.toThrow();
    await expectNoRequests(stub, 0);
    await stub.close();

    expect(stub.requests).toHaveLength(0);
  });
  it('delivers egress lifecycle events carrying session and reason fields', async () => {
    const stub = await startStub();
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      webhookUrl: stub.url,
    });
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.egressStarted('room-1', 'room-slug', 'egress-1', {
      rtmpEndpoints: ['rtmp://example.com/live'],
      hls: true,
      record: false,
    });
    dispatcher.egressStopped(
      'room-1',
      'room-slug',
      'egress-1',
      { rtmpEndpoints: ['rtmp://example.com/live'], hls: true, record: false },
      'stopped',
    );
    dispatcher.egressFailed(
      'room-1',
      'room-slug',
      'egress-1',
      { rtmpEndpoints: [], hls: true, record: false },
      'pipeline exited unexpectedly',
    );
    await waitForRequests(stub, 3);
    await stub.close();

    expect(stub.requests.map((r) => r.parsed.type)).toEqual([
      'egress.started',
      'egress.stopped',
      'egress.failed',
    ]);
    const outputs = {
      rtmpEndpoints: ['rtmp://example.com/live'],
      hls: true,
      record: false,
    };
    expect(stub.requests[0].parsed.data).toMatchObject({
      roomId: 'room-1',
      roomSlug: 'room-slug',
      egress: { id: 'egress-1', outputs },
    });
    expect(stub.requests[1].parsed.data).toMatchObject({
      egress: { id: 'egress-1' },
      reason: 'stopped',
    });
    expect(stub.requests[2].parsed.data).toMatchObject({
      egress: { id: 'egress-1' },
      error: 'pipeline exited unexpectedly',
    });
  });

  it('is silent for egress events on user-owned rooms', async () => {
    const stub = await startStub();
    prisma.room.findUnique.mockResolvedValue({
      slug: 'user-room-slug',
      projectId: null,
    });
    const { dispatcher } = makeDispatcher(prisma);

    dispatcher.egressStarted('room-1', 'user-room-slug', 'egress-1', {
      rtmpEndpoints: ['rtmp://example.com/live'],
      hls: false,
      record: false,
    });
    await expectNoRequests(stub, 0);
    await stub.close();
  });

  it('does not throw into callers when an egress emission fails', async () => {
    prisma.room.findUnique.mockRejectedValue(new Error('db down'));
    const { dispatcher } = makeDispatcher(prisma);

    expect(() =>
      dispatcher.egressStarted('room-1', undefined, 'egress-1', {
        rtmpEndpoints: [],
        hls: false,
        record: false,
      }),
    ).not.toThrow();
  });
});
