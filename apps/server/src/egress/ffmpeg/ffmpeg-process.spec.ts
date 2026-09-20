import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFmpegProcess } from './ffmpeg-process';

const GRACEFUL_STUB = [
  "process.on('SIGINT', () => {",
  "  require('fs').writeSync(2, 'draining\\n');",
  '  process.exit(0);',
  '});',
  "require('fs').writeSync(2, 'startup\\n');",
  'setInterval(() => {}, 1000000);',
].join('\n');

const IGNORES_SIGINT_STUB = [
  "process.on('SIGINT', () => {",
  '  // deliberately ignore SIGINT so stop() must escalate to SIGKILL',
  '});',
  "require('fs').writeSync(2, 'running\\n');",
  'setInterval(() => {}, 1000000);',
].join('\n');

const VERBOSE_STUB = [
  "const write = (line) => require('fs').writeSync(2, line);",
  "process.on('SIGINT', () => {",
  "  write('done\\n');",
  '  process.exit(0);',
  '});',
  'for (let i = 1; i <= 30; i++) write(`line-${i}\\n`);',
  'setInterval(() => {}, 1000000);',
].join('\n');
const PROGRESS_STUB = [
  "require('fs').writeSync(1, 'frame=1 fps=0.0\\nout_time_ms=1000\\nout_time_ms=2000\\nprogress=continue\\n');",
  'setInterval(() => {}, 1000000);',
].join('\n');

const IMMEDIATE_STUB = 'process.exit(0);';

async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  const { promise: guard, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(message)), 8000);
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

function nextStderrLine(proc: FFmpegProcess): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  proc.once('stderr', resolve);
  return promise;
}

describe('FFmpegProcess', () => {
  let stubsDir: string;

  beforeAll(async () => {
    stubsDir = await mkdtemp(join(tmpdir(), 'ffmpeg-process-spec-'));
    await Promise.all([
      writeFile(join(stubsDir, 'graceful.cjs'), GRACEFUL_STUB),
      writeFile(join(stubsDir, 'ignores-sigint.cjs'), IGNORES_SIGINT_STUB),
      writeFile(join(stubsDir, 'verbose.cjs'), VERBOSE_STUB),
      writeFile(join(stubsDir, 'progressing.cjs'), PROGRESS_STUB),
      writeFile(join(stubsDir, 'immediate.cjs'), IMMEDIATE_STUB),
    ]);
  });

  afterAll(async () => {
    await rm(stubsDir, { recursive: true, force: true });
  });

  it('streams stderr lines, emits exit once and stops gracefully on SIGINT', async () => {
    const proc = FFmpegProcess.spawn(process.execPath, [
      join(stubsDir, 'graceful.cjs'),
    ]);
    const stderrLines: string[] = [];
    let exitEvents = 0;
    let exitInfo: { code: number | null; signal: string | null } | null = null;
    proc.on('stderr', (line: string) => stderrLines.push(line));
    proc.on('exit', (code: number | null, signal: string | null) => {
      exitEvents++;
      exitInfo = { code, signal };
    });

    await nextStderrLine(proc);
    await withTimeout(proc.stop(5000), 'stop() did not settle within 8s');

    expect(exitEvents).toBe(1);
    expect(exitInfo).toEqual({ code: 0, signal: null });
    expect(stderrLines).toEqual(['startup', 'draining']);
    expect(proc.stderrTail).toBe('startup\ndraining');
  }, 15000);

  it('escalates to SIGKILL when the process ignores SIGINT', async () => {
    const proc = FFmpegProcess.spawn(process.execPath, [
      join(stubsDir, 'ignores-sigint.cjs'),
    ]);
    let exitInfo: { code: number | null; signal: string | null } | null = null;
    proc.on('exit', (code: number | null, signal: string | null) => {
      exitInfo = { code, signal };
    });

    await nextStderrLine(proc);
    await withTimeout(
      proc.stop(400),
      'SIGKILL escalation did not settle within 8s',
    );

    expect(exitInfo).toEqual({ code: null, signal: 'SIGKILL' });
  }, 15000);

  it('keeps only the last 20 stderr lines in stderrTail', async () => {
    const proc = FFmpegProcess.spawn(process.execPath, [
      join(stubsDir, 'verbose.cjs'),
    ]);
    const flushed = Promise.withResolvers<void>();
    proc.on('stderr', (line: string) => {
      if (line === 'done') {
        flushed.resolve();
      }
    });
    await nextStderrLine(proc);
    const stopped = withTimeout(
      proc.stop(5000),
      'stop() did not settle within 8s',
    );
    await flushed.promise;
    await stopped;

    const tail = proc.stderrTail.split('\n');
    expect(tail).toHaveLength(20);
    expect(tail[0]).toBe('line-12');
    expect(tail[19]).toBe('done');
  }, 15000);

  it('emits progress events for stdout lines containing out_time_ms only', async () => {
    const proc = FFmpegProcess.spawn(process.execPath, [
      join(stubsDir, 'progressing.cjs'),
    ]);
    const progressLines: string[] = [];
    proc.on('progress', (line: string) => progressLines.push(line));

    const firstProgress = Promise.withResolvers<void>();
    proc.once('progress', firstProgress.resolve);
    await firstProgress.promise;
    const settle = Promise.withResolvers<void>();
    setTimeout(settle.resolve, 50);
    await settle.promise;
    await withTimeout(proc.stop(5000), 'stop() did not settle within 8s');

    expect(progressLines).toEqual(['out_time_ms=1000', 'out_time_ms=2000']);
  }, 15000);

  it('resolves stop() for an already-exited process and stays idempotent', async () => {
    const proc = FFmpegProcess.spawn(process.execPath, [
      join(stubsDir, 'immediate.cjs'),
    ]);
    const exited = Promise.withResolvers<number | null>();
    proc.once('exit', (code: number | null) => exited.resolve(code));
    expect(await exited.promise).toBe(0);

    await withTimeout(proc.stop(1000), 'stop() did not settle within 8s');
    await withTimeout(
      proc.stop(1000),
      'second stop() did not settle within 8s',
    );
  }, 15000);
});
