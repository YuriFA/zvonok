import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { EGRESS_RECORDINGS_DIR } from './egress.config';
import { findOwnedEgressRow } from './egress-ownership';
import type {
  Egress,
  EgressEndedReason,
  EgressStatus,
  Prisma,
} from 'src/generated/prisma/client';
import { paginate, type Page } from 'src/platform/pagination.helper';

/** One listed recording, serialized for the platform API. */
export interface RecordingView {
  id: string;
  roomId: string;
  status: EgressStatus;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: EgressEndedReason | null;
  recordingUrl: string;
  recordingSizeBytes: number | null;
  recordingFinalizedAt: Date | null;
}

/** Everything the controller needs to answer one download request. */
export interface RecordingDownload {
  stream: ReturnType<typeof createReadStream>;
  contentType: string;
  /** Total file size in bytes. */
  size: number;
  /** HTTP 206 partial-content range, or null for a full 200 response. */
  range: { start: number; end: number } | null;
}

/**
 * Parse a single-range `Range: bytes=...` header against `size`.
 * Returns null for an absent header, the inclusive byte range for a
 * satisfiable request, or 'unsatisfiable'.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'unsatisfiable';
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'unsatisfiable';
  if (rawStart === '') {
    // suffix form: last N bytes
    const suffix = parseInt(rawEnd, 10);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = parseInt(rawStart, 10);
  if (start >= size) return 'unsatisfiable';
  const end =
    rawEnd === '' ? size - 1 : Math.min(parseInt(rawEnd, 10), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Recordings of the key's project, newest first, optional room filter. */
  async list(
    projectId: string,
    roomId?: string,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<Page<RecordingView>> {
    const result = await paginate<Egress>({
      limit: page.limit,
      cursor: page.cursor,
      orderKey: 'startedAt',
      scope: {
        projectId,
        ...(roomId ? { roomId } : {}),
        outputs: { path: ['record'], equals: true },
      },
      findPage: (query) =>
        // Generated Prisma arg types cannot express the dynamic order key.
        this.prisma.egress.findMany(
          query as unknown as Prisma.EgressFindManyArgs,
        ),
    });
    return {
      items: result.items.map((row) => this.toView(row)),
      next: result.next,
    };
  }

  /**
   * Stream one session's recording. The finalized MP4 is preferred; sessions
   * that failed before finalization serve their raw MPEG-TS part(s), with
   * `part` selecting among multiple restart parts (default 0).
   */
  async download(
    projectId: string,
    egressId: string,
    options: { part?: number; rangeHeader?: string } = {},
  ): Promise<RecordingDownload> {
    const row = await this.findRecordingRow(projectId, egressId);
    const dir = join(EGRESS_RECORDINGS_DIR, row.id);

    let file: { path: string; contentType: string };
    const finalized = join(dir, 'recording.mp4');
    if (existsSync(finalized)) {
      file = { path: finalized, contentType: 'video/mp4' };
    } else {
      const parts = await this.listParts(dir);
      if (parts.length === 0) {
        throw new NotFoundException('Recording not found');
      }
      const part = options.part ?? 0;
      if (part < 0 || part >= parts.length) {
        throw new NotFoundException('Recording part not found');
      }
      file = {
        path: join(dir, `recording-${part}.ts`),
        contentType: 'video/mp2t',
      };
    }

    const { size } = await stat(file.path);
    const range = parseRange(options.rangeHeader, size);
    if (range === 'unsatisfiable') {
      throw new HttpException('Range not satisfiable', 416);
    }
    return {
      stream: createReadStream(file.path, range ?? undefined),
      contentType: file.contentType,
      size,
      range,
    };
  }

  /** Delete one session's stored recording files and metadata. */
  async remove(projectId: string, egressId: string): Promise<void> {
    await this.findRecordingRow(projectId, egressId);
    await rm(join(EGRESS_RECORDINGS_DIR, egressId), {
      recursive: true,
      force: true,
    });
    await this.prisma.egress.update({
      where: { id: egressId },
      data: { recordingSizeBytes: null, recordingFinalizedAt: null },
    });
    this.logger.log(`Recording ${egressId} deleted`);
  }

  private async findRecordingRow(
    projectId: string,
    egressId: string,
  ): Promise<Egress> {
    const row = await findOwnedEgressRow(this.prisma, projectId, egressId);
    const outputs = row.outputs as { record?: boolean };
    if (!outputs.record) {
      throw new NotFoundException('Recording not found');
    }
    return row;
  }

  private async listParts(dir: string): Promise<string[]> {
    try {
      const names = await readdir(dir);
      return names.filter((name) => /^recording-\d+\.ts$/.test(name)).sort();
    } catch {
      return [];
    }
  }

  private toView(row: Egress): RecordingView {
    return {
      id: row.id,
      roomId: row.roomId,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      endedReason: row.endedReason,
      recordingUrl: `/v1/recordings/${row.id}/file`,
      recordingSizeBytes:
        row.recordingSizeBytes === null ? null : Number(row.recordingSizeBytes),
      recordingFinalizedAt: row.recordingFinalizedAt,
    };
  }
}
