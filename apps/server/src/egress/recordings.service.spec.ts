import { NotFoundException, HttpException } from '@nestjs/common';
import { existsSync, createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { parseRange, RecordingsService } from './recordings.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
}));
jest.mock('node:fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
  rm: jest.fn(),
}));

const mockedExists = existsSync as jest.Mock;
const mockedReaddir = readdir as jest.Mock;
const mockedStat = stat as jest.Mock;
const mockedRm = rm as jest.Mock;
const mockedStream = createReadStream as jest.Mock;

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'egress-1',
    roomId: 'room-1',
    projectId: 'project-1',
    outputs: { rtmpEndpoints: [], hls: false, record: true },
    status: 'ended',
    endedReason: 'stopped',
    error: null,
    recordingSizeBytes: null,
    recordingFinalizedAt: null,
    startedAt: new Date('2026-09-07T10:00:00Z'),
    endedAt: new Date('2026-09-07T11:00:00Z'),
    ...overrides,
  };
}

describe('parseRange', () => {
  it('returns null for an absent header and a full open range', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('clamps explicit ranges and handles the suffix form', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=999-', 1000)).toEqual({ start: 999, end: 999 });
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRange('notabytes=1-2', 1000)).toBe('unsatisfiable');
  });
});

describe('RecordingsService', () => {
  let service: RecordingsService;
  let prisma: {
    egress: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExists.mockReturnValue(false);
    mockedReaddir.mockResolvedValue([]);
    mockedStat.mockResolvedValue({ size: 4096 });
    mockedRm.mockResolvedValue(undefined);
    mockedStream.mockReturnValue({ piped: true });
    prisma = {
      egress: {
        findUnique: jest.fn().mockResolvedValue(makeRow()),
        findMany: jest.fn().mockResolvedValue([makeRow()]),
        update: jest.fn().mockResolvedValue(makeRow()),
      },
    };
    service = new RecordingsService(prisma as never);
  });

  describe('list', () => {
    it('scopes the listing to the key project and record outputs', async () => {
      await service.list('project-1');
      expect(prisma.egress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'project-1',
            outputs: { path: ['record'], equals: true },
          }),
          orderBy: { startedAt: 'desc', id: 'desc' },
          take: 51,
        }),
      );
    });

    it('passes an optional room filter and maps view fields', async () => {
      prisma.egress.findMany.mockResolvedValue([
        makeRow({
          recordingSizeBytes: 5000000n,
          recordingFinalizedAt: new Date(),
        }),
      ]);
      const page = await service.list('project-1', 'room-9');
      expect(prisma.egress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ roomId: 'room-9' }),
          take: 51,
        }),
      );
      expect(page.items[0]).toEqual(
        expect.objectContaining({
          id: 'egress-1',
          recordingUrl: '/v1/recordings/egress-1/file',
          recordingSizeBytes: 5000000,
        }),
      );
    });
  });

  describe('download', () => {
    it('serves the finalized MP4 with full-range 200 metadata', async () => {
      mockedExists.mockReturnValue(true);
      const download = await service.download('project-1', 'egress-1');
      expect(download.contentType).toBe('video/mp4');
      expect(download.size).toBe(4096);
      expect(download.range).toBeNull();
      expect(mockedStream).toHaveBeenCalledWith(
        expect.stringMatching(/recording\.mp4$/),
        undefined,
      );
    });

    it('answers a Range request with a 206 byte slice', async () => {
      mockedExists.mockReturnValue(true);
      const download = await service.download('project-1', 'egress-1', {
        rangeHeader: 'bytes=100-',
      });
      expect(download.range).toEqual({ start: 100, end: 4095 });
      expect(mockedStream).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ start: 100, end: 4095 }),
      );
    });

    it('rejects unsatisfiable ranges with 416', async () => {
      mockedExists.mockReturnValue(true);
      const error = await service
        .download('project-1', 'egress-1', {
          rangeHeader: 'bytes=99999-',
        })
        .catch((e: unknown) => e as HttpException);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(416);
    });

    it('falls back to the raw MPEG-TS part for a crashed session', async () => {
      mockedReaddir.mockResolvedValue(['recording-0.ts']);
      const download = await service.download('project-1', 'egress-1');
      expect(download.contentType).toBe('video/mp2t');
      expect(mockedStream).toHaveBeenCalledWith(
        expect.stringMatching(/recording-0.ts$/),
        undefined,
      );
    });

    it('selects a specific part among multiple raw parts', async () => {
      mockedReaddir.mockResolvedValue(['recording-0.ts', 'recording-1.ts']);
      await service.download('project-1', 'egress-1', { part: 1 });
      expect(mockedStream).toHaveBeenCalledWith(
        expect.stringMatching(/recording-1.ts$/),
        undefined,
      );
      await expect(
        service.download('project-1', 'egress-1', { part: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('hides other projects recordings behind 404', async () => {
      prisma.egress.findUnique.mockResolvedValue(
        makeRow({ projectId: 'other-project' }),
      );
      await expect(service.download('project-1', 'egress-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.download('project-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s sessions that never requested a recording', async () => {
      prisma.egress.findUnique.mockResolvedValue(
        makeRow({ outputs: { rtmpEndpoints: [], hls: true, record: false } }),
      );
      await expect(service.download('project-1', 'egress-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when no recording material exists on disk', async () => {
      mockedReaddir.mockResolvedValue([]);
      await expect(service.download('project-1', 'egress-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the session directory and clears metadata', async () => {
      await service.remove('project-1', 'egress-1');
      expect(mockedRm).toHaveBeenCalledWith(
        expect.stringMatching(/egress-1$/),
        expect.objectContaining({ recursive: true }),
      );
      expect(prisma.egress.update).toHaveBeenCalledWith({
        where: { id: 'egress-1' },
        data: { recordingSizeBytes: null, recordingFinalizedAt: null },
      });
    });

    it('404s foreign projects without touching disk', async () => {
      prisma.egress.findUnique.mockResolvedValue(
        makeRow({ projectId: 'other-project' }),
      );
      await expect(service.remove('project-1', 'egress-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockedRm).not.toHaveBeenCalled();
    });
  });
});
