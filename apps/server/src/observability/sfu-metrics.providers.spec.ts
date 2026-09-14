jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));
jest.mock('src/webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcher: jest.fn(),
}));
import { Registry } from 'prom-client';
import type { Provider } from '@nestjs/common';
import type { Gauge } from 'prom-client';
import { sfuMetricsProviders } from './sfu-metrics.providers';

/** The spec scenario: two active rooms, three plus one connected peers. */
const FAKE_WORKER_MANAGER = { liveRouterCount: () => 2 };
const FAKE_PRESENCE = { peerCount: () => 4 };
const FAKE_SFU = { openTransportCount: () => 8 };

const INJECTED: Record<string, unknown> = {
  WorkerManager: FAKE_WORKER_MANAGER,
  RoomPresenceService: FAKE_PRESENCE,
  SfuService: FAKE_SFU,
};

function buildGauge(provider: Provider): Gauge<string> {
  const { inject, useFactory } = provider as {
    inject: Array<new () => object>;
    useFactory: (...deps: unknown[]) => Gauge<string>;
  };
  const deps = inject.map(
    (token) => INJECTED[(token as { name: string }).name],
  );
  return useFactory(...deps);
}

async function scrape(
  provider: Provider,
): Promise<{ name: string; value: number }> {
  const registry = new Registry();
  registry.registerMetric(buildGauge(provider));
  const [metric] = await registry.getMetricsAsJSON();
  return { name: metric.name, value: metric.values[0].value };
}

describe('sfuMetricsProviders', () => {
  it.each([
    ['zvonok_sfu_active_rooms', 0, 2],
    ['zvonok_sfu_connected_peers', 1, 4],
    ['zvonok_sfu_open_transports', 2, 8],
  ])('scrapes %s from live SFU state', async (name, index, expected) => {
    await expect(scrape(sfuMetricsProviders[index])).resolves.toEqual({
      name,
      value: expected,
    });
  });
});
