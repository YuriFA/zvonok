import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaService } from 'src/prisma/prisma.service';
import { SfuService } from 'src/sfu/sfu.service';
import { WebhookDispatcher } from 'src/webhooks/webhook-dispatcher.service';
import { composeEgressArgs, generateSdp } from './ffmpeg/args-composer';
import { FFmpegProcess } from './ffmpeg/ffmpeg-process';
import { findOwnedEgressRow } from './egress-ownership';
import {
  EGRESS_ALLOW_PRIVATE_TARGETS,
  EGRESS_FFMPEG_PATH,
  EGRESS_HLS_DIR,
  EGRESS_MAX_RESTARTS,
  EGRESS_MEDIA_PORT_MAX,
  EGRESS_MEDIA_PORT_MIN,
  EGRESS_RECORDINGS_DIR,
  EGRESS_RESTART_DEBOUNCE_MS,
  EGRESS_RETRY_WINDOW_MS,
  EGRESS_START_TIMEOUT_MS,
  EGRESS_STOP_GRACE_MS,
} from './egress.config';
import type {
  EgressEndReason,
  EgressOutputs,
  EgressPipelineInput,
  EgressSessionView,
  EgressTap,
} from './egress.types';
import type {
  Egress,
  EgressEndedReason,
  EgressStatus,
  Prisma,
} from 'src/generated/prisma/client';
import { paginate, type Page } from 'src/platform/pagination.helper';

const ACTIVE_STATUSES: EgressStatus[] = ['starting', 'live', 'stopping'];

interface ActiveSession {
  id: string;
  projectId: string;
  roomId: string;
  roomSlug: string | undefined;
  outputs: EgressOutputs;
  hlsDir: string;
  /** Recording sink directory when `outputs.record` is set, else null. */
  recordingDir: string | null;
  /** Index of the MPEG-TS part the pipeline currently writes. */
  recordingPart: number;
  sdpDir: string;
  status: 'starting' | 'live' | 'stopping';
  /** Whether the `live` transition (and its webhook) already happened. */
  liveEmitted: boolean;
  taps: EgressTap[];
  process: FFmpegProcess | null;
  restartTimes: number[];
  unsubscribeProducerAdded?: () => void;
  unsubscribeRoomClosed?: () => void;
  startTimer?: NodeJS.Timeout;
  restartTimer?: NodeJS.Timeout;
}

/** Private/special-purpose IP ranges rejected as RTMP targets by default. */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return false;
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }
  return true;
}

@Injectable()
export class EgressService implements OnModuleInit {
  private readonly logger = new Logger(EgressService.name);
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly portsInUse = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sfu: SfuService,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  /**
   * Pipelines are in-process only: after a server restart nothing is running,
   * so non-terminal rows are reconciled to a failed state.
   */
  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.egress.updateMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      data: {
        status: 'failed',
        error: 'server-restarted',
        endedAt: new Date(),
      },
    });
    if (count > 0) {
      this.logger.warn(`Reconciled ${count} orphaned egress session(s)`);
    }
  }

  async start(
    projectId: string,
    roomId: string,
    outputs: EgressOutputs,
  ): Promise<EgressSessionView> {
    if (outputs.rtmpEndpoints.length === 0 && !outputs.hls && !outputs.record) {
      throw new BadRequestException('At least one output is required');
    }
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.projectId !== projectId) {
      throw new NotFoundException('Room not found');
    }
    if (room.status !== 'active') {
      throw new BadRequestException('Room is not active');
    }
    const running = await this.prisma.egress.findFirst({
      where: { roomId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (running) {
      throw new ConflictException('Egress already active for this room');
    }
    await this.assertEndpointsAllowed(outputs.rtmpEndpoints);

    const row = await this.prisma.egress.create({
      data: {
        roomId,
        projectId,
        outputs: {
          rtmpEndpoints: outputs.rtmpEndpoints,
          hls: outputs.hls,
          record: outputs.record,
        },
      },
    });

    const session: ActiveSession = {
      id: row.id,
      projectId,
      roomId,
      roomSlug: room.slug,
      outputs,
      hlsDir: join(EGRESS_HLS_DIR, row.id),
      recordingDir: outputs.record ? join(EGRESS_RECORDINGS_DIR, row.id) : null,
      recordingPart: 0,
      sdpDir: join(tmpdir(), 'zvonok-egress-sdp', row.id),
      status: 'starting',
      liveEmitted: false,
      taps: [],
      process: null,
      restartTimes: [],
    };
    this.sessions.set(row.id, session);
    this.notifyStatus(session, 'starting');
    session.unsubscribeProducerAdded = this.sfu.onRoomProducerAdded(
      roomId,
      () => this.scheduleMembershipRestart(session),
    );
    session.unsubscribeRoomClosed = this.sfu.onRoomClosed(roomId, () => {
      void this.finalize(session, 'room-ended');
    });

    try {
      await mkdir(session.hlsDir, { recursive: true });
      if (session.recordingDir) {
        await mkdir(session.recordingDir, { recursive: true });
      }
      await mkdir(session.sdpDir, { recursive: true });
      await this.startPipeline(session);
    } catch (error) {
      this.logger.warn(
        `Egress ${row.id} initial pipeline failed: ${String(error)}`,
      );
      await this.failSession(
        session,
        `pipeline failed to start: ${String(error)}`,
      );
    }
    return this.view(row);
  }

  async listForRoom(
    projectId: string,
    roomId: string,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<Page<EgressSessionView>> {
    const result = await paginate<Egress>({
      limit: page.limit,
      cursor: page.cursor,
      orderKey: 'startedAt',
      scope: { roomId, projectId },
      findPage: (query) =>
        // Generated Prisma arg types cannot express the dynamic order key.
        this.prisma.egress.findMany(
          query as unknown as Prisma.EgressFindManyArgs,
        ),
    });
    return {
      items: result.items.map((row) => this.view(row)),
      next: result.next,
    };
  }

  async get(projectId: string, egressId: string): Promise<EgressSessionView> {
    const row = await findOwnedEgressRow(this.prisma, projectId, egressId);
    return this.view(row);
  }

  async stop(projectId: string, egressId: string): Promise<EgressSessionView> {
    const row = await findOwnedEgressRow(this.prisma, projectId, egressId);
    if (row.status === 'ended' || row.status === 'failed') {
      throw new ConflictException('Egress session is not active');
    }
    const session = this.sessions.get(egressId);
    if (!session) {
      // Non-terminal row without runtime: same reconciliation as boot.
      const ended = await this.prisma.egress.update({
        where: { id: egressId },
        data: {
          status: 'ended',
          endedReason: 'stopped',
          endedAt: new Date(),
        },
      });
      return this.view(ended);
    }
    void 0;
    await this.finalize(session, 'stopped');
    const ended = await this.prisma.egress.findUniqueOrThrow({
      where: { id: egressId },
    });
    return this.view(ended);
  }

  /**
   * SSRF guard: RTMP targets must not point at the server itself or private
   * infrastructure unless explicitly allowed for development.
   */
  private async assertEndpointsAllowed(endpoints: string[]): Promise<void> {
    if (EGRESS_ALLOW_PRIVATE_TARGETS) return;
    for (const endpoint of endpoints) {
      let host: string;
      try {
        host = new URL(endpoint).hostname;
      } catch {
        throw new BadRequestException(`Invalid RTMP endpoint: ${endpoint}`);
      }
      const addresses =
        isIP(host) !== 0
          ? [host]
          : (await lookup(host, { all: true })).map((a) => a.address);
      if (addresses.some((address) => isPrivateAddress(address))) {
        throw new BadRequestException(
          `RTMP endpoint host ${host} is not allowed`,
        );
      }
    }
  }

  private async startPipeline(session: ActiveSession): Promise<void> {
    this.closeRuntime(session);
    clearTimeout(session.startTimer);

    const descriptors = this.sfu.listRoomProducers(session.roomId);
    session.taps = [];
    const inputs: EgressPipelineInput[] = [];
    let index = 0;
    for (const descriptor of descriptors) {
      const transport = await this.sfu.createEgressTransport(session.roomId);
      const { consumer, rtpParameters } = await this.sfu.createEgressConsumer(
        session.roomId,
        transport,
        descriptor.producerId,
      );
      const port = this.allocatePort();
      // Point the plain transport at FFmpeg's UDP listener before any
      // consumer resumes, so RTP flows from the first packet.
      await transport.connect({ ip: '127.0.0.1', port });
      const tap: EgressTap = {
        descriptor,
        transport,
        consumer,
        port,
      };
      tap.consumer.on('producerclose', () => {
        this.scheduleMembershipRestart(session);
      });
      session.taps.push(tap);
      const sdpPath = join(session.sdpDir, `${index}.sdp`);
      await writeFile(
        sdpPath,
        generateSdp({ descriptor, rtpParameters, sdpPath, port }),
      );
      inputs.push({ descriptor, rtpParameters, sdpPath, port });
      index += 1;
    }

    const process = FFmpegProcess.spawn(
      EGRESS_FFMPEG_PATH,
      composeEgressArgs(inputs, {
        rtmpEndpoints: session.outputs.rtmpEndpoints,
        hls: session.outputs.hls,
        record: session.outputs.record,
        hlsDir: session.hlsDir,
        recordingDir: session.recordingDir ?? undefined,
        recordingPart: session.recordingPart,
      }),
    );
    session.process = process;
    process.on('progress', () => this.markLive(session));
    process.on('exit', (code, signal) =>
      this.onProcessExit(session, code, signal),
    );

    session.startTimer = setTimeout(() => {
      if (!session.liveEmitted) {
        this.logger.warn(`Egress ${session.id} start timeout`);
        void this.onPipelineFailure(
          session,
          'timed out before producing output',
        );
      }
    }, EGRESS_START_TIMEOUT_MS);
  }

  private markLive(session: ActiveSession): void {
    if (session.liveEmitted || session.status !== 'starting') return;
    session.liveEmitted = true;
    clearTimeout(session.startTimer);
    void this.prisma.egress
      .update({ where: { id: session.id }, data: { status: 'live' } })
      .then(() => {
        this.webhooks.egressStarted(
          session.roomId,
          session.roomSlug,
          session.id,
          session.outputs,
        );
        this.notifyStatus(session, 'live');
        this.logger.log(`Egress ${session.id} is live`);
      })
      .catch((error) =>
        this.logger.error(
          `Egress ${session.id} live update failed: ${String(error)}`,
        ),
      );
  }

  /** Process exit while not stopping: bounded retry, then terminal failure. */
  private onProcessExit(
    session: ActiveSession,
    code: number | null,
    signal: string | null,
  ): void {
    if (session.status === 'stopping') return;
    this.logger.warn(
      `Egress ${session.id} pipeline exited (code=${code}, signal=${signal})`,
    );
    void this.onPipelineFailure(
      session,
      `pipeline exited unexpectedly (code=${code}, signal=${signal})`,
    );
  }

  private async onPipelineFailure(
    session: ActiveSession,
    reason: string,
  ): Promise<void> {
    const now = Date.now();
    session.restartTimes = session.restartTimes.filter(
      (time) => now - time < EGRESS_RETRY_WINDOW_MS,
    );
    session.restartTimes.push(now);
    if (session.restartTimes.length > EGRESS_MAX_RESTARTS) {
      await this.failSession(session, reason);
      return;
    }
    if (session.recordingDir) session.recordingPart += 1;
    try {
      await this.startPipeline(session);
    } catch (error) {
      await this.failSession(session, `restart failed: ${String(error)}`);
    }
  }

  private scheduleMembershipRestart(session: ActiveSession): void {
    if (session.status === 'stopping') return;
    if (session.restartTimer) {
      clearTimeout(session.restartTimer);
      session.restartTimer = undefined;
    }
    session.restartTimer = setTimeout(() => {
      session.restartTimer = undefined;
      if (session.status === 'stopping') return;
      if (session.recordingDir) session.recordingPart += 1;
      void this.startPipeline(session).catch((error) => {
        this.logger.warn(
          `Egress ${session.id} membership restart failed: ${String(error)}`,
        );
      });
    }, EGRESS_RESTART_DEBOUNCE_MS);
  }

  /** Graceful terminal stop: 'stopped' via API or 'room-ended' on teardown. */
  private async finalize(
    session: ActiveSession,
    reason: EgressEndReason,
  ): Promise<void> {
    if (session.status === 'stopping') return;
    session.status = 'stopping';
    clearTimeout(session.restartTimer);
    clearTimeout(session.startTimer);
    await this.closeRuntime(session);
    this.sessions.delete(session.id);

    await this.prisma.egress.update({
      where: { id: session.id },
      data: {
        status: 'ended',
        endedReason: reason === 'room-ended' ? 'roomEnded' : 'stopped',
        endedAt: new Date(),
      },
    });
    this.webhooks.egressStopped(
      session.roomId,
      session.roomSlug,
      session.id,
      session.outputs,
      reason,
    );
    if (session.recordingDir) {
      await this.finalizeRecording(session);
    }
    await rm(session.sdpDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    this.notifyStatus(session, 'ended');
    this.logger.log(`Egress ${session.id} ended (${reason})`);
  }

  private async failSession(
    session: ActiveSession,
    error: string,
  ): Promise<void> {
    session.status = 'stopping';
    clearTimeout(session.restartTimer);
    clearTimeout(session.startTimer);
    // Raw recording parts stay on disk so a failed session keeps its material.
    void this.closeRuntime(session);
    this.sessions.delete(session.id);

    await this.prisma.egress.update({
      where: { id: session.id },
      data: { status: 'failed', error, endedAt: new Date() },
    });
    this.webhooks.egressFailed(
      session.roomId,
      session.roomSlug,
      session.id,
      session.outputs,
      error,
    );
    this.notifyStatus(session, 'failed');
    this.logger.warn(`Egress ${session.id} failed: ${error}`);
  }

  /** Tell the room's connected participants about a session state change. */
  private notifyStatus(
    session: ActiveSession,
    status: 'starting' | 'live' | 'ended' | 'failed',
  ): void {
    this.sfu.broadcastToRoom(session.roomId, 'egress:status', {
      sessionId: session.id,
      outputs: {
        record: session.outputs.record,
        hls: session.outputs.hls,
      },
      status,
    });
  }

  /**
   * Kill the pipeline process and close every tap transport/consumer.
   * Resolves once the pipeline process has fully exited, so its sinks are
   * safely closed for whoever awaits (finalization); fire-and-forget callers
   * ignore the promise.
   */
  private closeRuntime(session: ActiveSession): Promise<void> {
    session.unsubscribeProducerAdded?.();
    session.unsubscribeProducerAdded = undefined;
    session.unsubscribeRoomClosed?.();
    session.unsubscribeRoomClosed = undefined;
    let stopped: Promise<void> = Promise.resolve();
    if (session.process) {
      const process = session.process;
      session.process = null;
      stopped = process.stop(EGRESS_STOP_GRACE_MS);
    }
    for (const tap of session.taps) {
      try {
        tap.consumer.close();
      } catch {
        // already closed by its transport or the dead pipeline path
      }
      try {
        tap.transport.close();
      } catch {
        // ditto
      }
      this.portsInUse.delete(tap.port);
    }
    session.taps = [];
    return stopped;
  }

  /**
   * Losslessly remux the written MPEG-TS parts into one seekable MP4 and
   * persist the finalized size. On remux failure the raw parts remain and
   * are served as-is; no material is ever silently dropped.
   */
  private async finalizeRecording(session: ActiveSession): Promise<void> {
    const dir = session.recordingDir;
    if (!dir) return;
    const parts: string[] = [];
    for (let part = 0; part <= session.recordingPart; part += 1) {
      const candidate = join(dir, `recording-${part}.ts`);
      try {
        await stat(candidate);
        parts.push(candidate);
      } catch {
        // The pipeline died before ever opening this part's sink.
      }
    }
    if (parts.length === 0) {
      this.logger.warn(`Egress ${session.id} recording produced no material`);
      return;
    }

    const listPath = join(dir, 'parts.txt');
    await writeFile(
      listPath,
      parts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join('\n') +
        '\n',
    );
    const target = join(dir, 'recording.mp4');
    const finalizer = FFmpegProcess.spawn(EGRESS_FFMPEG_PATH, [
      '-nostdin',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      target,
    ]);
    const exitCode = await new Promise<number | null>((resolve) => {
      finalizer.on('exit', resolve);
    });
    if (exitCode !== 0) {
      this.logger.warn(
        `Egress ${session.id} recording finalization failed ` +
          `(code=${exitCode}); keeping raw parts: ${finalizer.stderrTail}`,
      );
      return;
    }

    const { size } = await stat(target);
    await this.prisma.egress.update({
      where: { id: session.id },
      data: {
        recordingSizeBytes: BigInt(size),
        recordingFinalizedAt: new Date(),
      },
    });
    await rm(listPath, { force: true });
    for (const part of parts) {
      await rm(part, { force: true });
    }
    this.webhooks.recordingReady(
      session.roomId,
      session.roomSlug,
      session.id,
      session.outputs,
      `/v1/recordings/${session.id}/file`,
      size,
    );
    this.logger.log(`Egress ${session.id} recording finalized (${size} bytes)`);
  }

  private allocatePort(): number {
    for (
      let port = EGRESS_MEDIA_PORT_MIN;
      port <= EGRESS_MEDIA_PORT_MAX;
      port++
    ) {
      if (!this.portsInUse.has(port)) {
        this.portsInUse.add(port);
        return port;
      }
    }
    throw new Error('No egress media ports available');
  }

  private view(row: Egress): EgressSessionView {
    const outputs = row.outputs as unknown as EgressOutputs;
    return {
      id: row.id,
      roomId: row.roomId,
      status: row.status,
      outputs,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      endedReason: this.endReasonDto(row.endedReason),
      error: row.error,
      hlsUrl: outputs.hls ? `/egress/hls/${row.id}/index.m3u8` : null,
      recordingUrl: outputs.record ? `/v1/recordings/${row.id}/file` : null,
      recordingSizeBytes:
        row.recordingSizeBytes === null ? null : Number(row.recordingSizeBytes),
    };
  }

  private endReasonDto(reason: EgressEndedReason | null) {
    if (!reason) return null;
    return reason === 'roomEnded' ? 'room-ended' : reason;
  }
}
