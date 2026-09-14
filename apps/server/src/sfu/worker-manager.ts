import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { availableParallelism } from 'node:os';
import * as mediasoup from 'mediasoup';
import { config } from './config/mediasoup.config';
import type {
  Worker as MediasoupWorker,
  Router as MediasoupRouter,
  RtpCapabilities,
} from 'mediasoup/types';

/** Delay before replacing a dead worker, and between replacement retries. */
const WORKER_RESTART_DELAY_MS = 2000;

/**
 * Pool size: one worker per core keeps the data plane saturated while
 * leaving one core for the Node control plane (mediasoup guidance: routers
 * distributed over up to numCpus-1 workers). MEDIASOUP_WORKERS overrides,
 * e.g. to reserve cores for egress ffmpeg pipelines on small hosts.
 */
export function workerPoolSize(): number {
  const override = parseInt(process.env.MEDIASOUP_WORKERS || '', 10);
  if (Number.isFinite(override) && override >= 1) {
    return override;
  }
  return Math.max(1, availableParallelism() - 1);
}

/** One live mediasoup worker subprocess and the rooms whose routers sit on it. */
interface PoolEntry {
  worker: MediasoupWorker;
  roomIds: Set<string>;
}

/**
 * Pool of mediasoup workers with one router per room placed on the
 * least-loaded worker. A dead worker is replaced, its rooms' routers are
 * recreated on the replacement, and subscribers are told which rooms lost
 * their media so they can notify participants.
 */
@Injectable()
export class WorkerManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerManager.name);
  private readonly entries: PoolEntry[] = [];
  private readonly routers = new Map<string, MediasoupRouter>();
  private readonly routersLostHandlers = new Set<(roomIds: string[]) => void>();
  private isClosing = false;

  async onModuleInit(): Promise<void> {
    const size = workerPoolSize();
    await Promise.all(
      Array.from({ length: size }, () => this.createPoolEntry()),
    );
    this.logger.log(`mediasoup worker pool ready (${size} worker(s))`);
  }

  /**
   * Subscribe to media loss: invoked with the room ids whose routers died
   * with a worker, after the replacement worker and their new routers exist.
   * Returns the unsubscribe function.
   */
  onRoutersLost(handler: (roomIds: string[]) => void): () => void {
    this.routersLostHandlers.add(handler);
    return () => {
      this.routersLostHandlers.delete(handler);
    };
  }

  private async createPoolEntry(): Promise<PoolEntry> {
    const worker = await mediasoup.createWorker(config.worker);
    const entry: PoolEntry = { worker, roomIds: new Set() };
    this.entries.push(entry);

    worker.on('died', () => {
      this.logger.error(`mediasoup Worker died (pid: ${worker.pid})`);
      void this.handleWorkerDeath(entry);
    });

    this.logger.log(`mediasoup Worker created (pid: ${worker.pid})`);
    return entry;
  }

  /**
   * Replace one dead worker: drop its entry, start a replacement (retrying
   * on failure - a missing worker binary must not brick the pool silently),
   * recreate the lost routers, then announce which rooms lost media.
   */
  private async handleWorkerDeath(dead: PoolEntry): Promise<void> {
    if (this.isClosing) {
      return;
    }

    const lostRoomIds = [...dead.roomIds];
    for (const roomId of lostRoomIds) {
      this.routers.delete(roomId);
    }
    const index = this.entries.indexOf(dead);
    if (index !== -1) {
      this.entries.splice(index, 1);
    }

    let entry: PoolEntry | null = null;
    while (!entry && !this.isClosing) {
      try {
        entry = await this.createPoolEntry();
      } catch (error) {
        this.logger.error(
          'Failed to replace mediasoup Worker, retrying...',
          error,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, WORKER_RESTART_DELAY_MS),
        );
      }
    }
    if (!entry) {
      return;
    }

    const recoveredRoomIds: string[] = [];
    for (const roomId of lostRoomIds) {
      if (this.routers.has(roomId)) {
        // A joiner recreated the router on the new entry first.
        continue;
      }
      try {
        await this.createRouterOn(entry, roomId);
        recoveredRoomIds.push(roomId);
      } catch (error) {
        this.logger.error(
          `Failed to recreate router for room ${roomId}`,
          error,
        );
      }
    }

    for (const handler of this.routersLostHandlers) {
      handler(recoveredRoomIds);
    }
  }

  async createRouter(roomId: string): Promise<MediasoupRouter> {
    const existingRouter = this.routers.get(roomId);
    if (existingRouter && !existingRouter.closed) {
      return existingRouter;
    }

    const entry = this.leastLoadedEntry();
    if (!entry) {
      throw new Error('No worker available');
    }
    return this.createRouterOn(entry, roomId);
  }

  private async createRouterOn(
    entry: PoolEntry,
    roomId: string,
  ): Promise<MediasoupRouter> {
    this.logger.log(`Creating router for room ${roomId}`);
    const router = await entry.worker.createRouter({
      mediaCodecs: config.router.mediaCodecs,
    });
    this.routers.set(roomId, router);
    entry.roomIds.add(roomId);
    this.logger.log(`Router created for room ${roomId}`);
    return router;
  }

  private leastLoadedEntry(): PoolEntry | null {
    let best: PoolEntry | null = null;
    for (const entry of this.entries) {
      if (!best || entry.roomIds.size < best.roomIds.size) {
        best = entry;
      }
    }
    return best;
  }

  getRouter(roomId: string): MediasoupRouter | undefined {
    return this.routers.get(roomId);
  }

  /** Diagnostics: OS pid of the worker hosting the room's router. */
  getWorkerPid(roomId: string): number | null {
    for (const entry of this.entries) {
      if (entry.roomIds.has(roomId)) return entry.worker.pid;
    }
    return null;
  }

  getRtpCapabilities(roomId: string): RtpCapabilities | null {
    const router = this.routers.get(roomId);
    if (!router) {
      return null;
    }
    return router.rtpCapabilities;
  }

  async closeRouter(roomId: string): Promise<void> {
    const router = this.routers.get(roomId);
    if (router && !router.closed) {
      router.close();
      this.logger.log(`Router closed for room ${roomId}`);
    }
    this.routers.delete(roomId);
    for (const entry of this.entries) {
      entry.roomIds.delete(roomId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.isClosing = true;
    this.logger.log('Closing WorkerManager...');

    for (const [roomId, router] of this.routers) {
      if (!router.closed) {
        router.close();
        this.logger.log(`Router closed for room ${roomId}`);
      }
    }
    this.routers.clear();

    for (const entry of this.entries) {
      if (!entry.worker.closed) {
        entry.worker.close();
        this.logger.log(`mediasoup Worker closed (pid: ${entry.worker.pid})`);
      }
    }
    this.entries.length = 0;
  }
}
