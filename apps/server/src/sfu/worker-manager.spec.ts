import { WorkerManager, workerPoolSize } from './worker-manager';

/**
 * Exercises the real mediasoup worker pool (subprocess spawn, death signal,
 * router recovery) - the one part of the SFU that unit doubles cannot cover.
 */

jest.setTimeout(20_000);

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Condition not met within timeout');
};

describe('WorkerManager pool (real mediasoup workers)', () => {
  beforeAll(() => {
    // Two workers: enough to observe least-loaded placement without
    // spawning a core-count of subprocesses.
    process.env.MEDIASOUP_WORKERS = '2';
  });

  it('reports a pool size of at least one and honors the override', () => {
    expect(workerPoolSize()).toBe(2);
    delete process.env.MEDIASOUP_WORKERS;
    expect(workerPoolSize()).toBeGreaterThanOrEqual(1);
    process.env.MEDIASOUP_WORKERS = '2';
  });

  it('spreads routers across the pool and reuses a room router', async () => {
    const manager = new WorkerManager();
    await manager.onModuleInit();
    try {
      const routerA = await manager.createRouter('room-a');
      const routerB = await manager.createRouter('room-b');

      expect(manager.getRouter('room-a')).toBe(routerA);
      expect(await manager.createRouter('room-a')).toBe(routerA);

      const pidA = manager.getWorkerPid('room-a');
      const pidB = manager.getWorkerPid('room-b');
      expect(pidA).not.toBeNull();
      expect(pidB).not.toBeNull();
      // Least-loaded placement on a 2-worker pool: distinct workers.
      expect(pidA).not.toBe(pidB);
      expect(manager.getRtpCapabilities('room-a')).toBeDefined();
      void routerB;
    } finally {
      await manager.onModuleDestroy();
    }
  });

  it('replaces a dead worker, recovers its rooms, and notifies subscribers', async () => {
    const manager = new WorkerManager();
    await manager.onModuleInit();
    const lostBatches: string[][] = [];
    manager.onRoutersLost((roomIds) => lostBatches.push(roomIds));
    try {
      await manager.createRouter('room-dies');
      await manager.createRouter('room-survives');
      const deadPid = manager.getWorkerPid('room-dies');
      const survivorPid = manager.getWorkerPid('room-survives');
      expect(deadPid).not.toBe(survivorPid);

      process.kill(deadPid as number, 'SIGKILL');

      await waitFor(() => lostBatches.length > 0);

      // Only the dead worker's room lost media and got a new router.
      expect(lostBatches).toEqual([['room-dies']]);
      const recovered = manager.getRouter('room-dies');
      expect(recovered).toBeDefined();
      expect(recovered?.closed).toBe(false);
      expect(manager.getWorkerPid('room-dies')).not.toBe(deadPid);
      // The other worker's router is untouched.
      expect(manager.getWorkerPid('room-survives')).toBe(survivorPid);
      expect(manager.getRouter('room-survives')?.closed).toBe(false);
    } finally {
      await manager.onModuleDestroy();
    }
  });
});
