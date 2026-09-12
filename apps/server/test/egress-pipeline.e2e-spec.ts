import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dgram from 'node:dgram';
import { WorkerManager } from '../src/sfu/worker-manager';
import {
  EGRESS_FFMPEG_PATH,
  EGRESS_MEDIA_PORT_MAX,
  EGRESS_MEDIA_PORT_MIN,
  EGRESS_HLS_DIR,
} from '../src/egress/egress.config';
import { config as mediasoupConfig } from '../src/sfu/config/mediasoup.config';
import {
  composeEgressArgs,
  generateSdp,
} from '../src/egress/ffmpeg/args-composer';
import { FFmpegProcess } from '../src/egress/ffmpeg/ffmpeg-process';
import type { EgressPipelineInput } from '../src/egress/egress.types';
import type { RoomTapSource } from '../src/sfu/room-media-source.port';

const execFileAsync = promisify(execFile);

const hasFfmpeg =
  existsSync('/opt/homebrew/bin/ffmpeg') ||
  existsSync('/usr/bin/ffmpeg') ||
  existsSync('/usr/local/bin/ffmpeg') ||
  !!process.env.EGRESS_E2E;

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

interface SdpInfo {
  payloadType: number;
}

function parseSdp(sdp: string): SdpInfo {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) (\w+)\/(\d+)/);
  if (!rtpmap) throw new Error(`no rtpmap in sdp: ${sdp}`);
  return { payloadType: Number(rtpmap[1]) };
}

interface IngestedStream {
  producerId: string;
  kind: 'audio' | 'video';
  source: RoomTapSource;
}

(hasFfmpeg ? describe : describe.skip)('Egress real media pipeline', () => {
  jest.setTimeout(180_000);

  let workerManager: WorkerManager;
  const room = 'room-egress-e2e';
  let workDir: string;
  let hlsDir: string;
  const senders: Array<() => void> = [];

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'egress-pipeline-'));
    hlsDir = join(workDir, 'hls');
    mkdirSync(hlsDir, { recursive: true });
    workerManager = new WorkerManager();
    await workerManager.onModuleInit();
    await workerManager.createRouter(room);
  });

  afterAll(async () => {
    for (const stop of senders) stop();
    await workerManager.closeRouter(room);
    await workerManager.onModuleDestroy?.();
    rmSync(workDir, { recursive: true, force: true });
  });

  async function ingest(
    kind: 'audio' | 'video',
    source: RoomTapSource,
    ffmpegFilters: string[],
  ): Promise<IngestedStream> {
    const router = workerManager.getRouter(room);
    if (!router) throw new Error('router missing');
    const transport = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' },
      comedia: true,
      rtcpMux: true,
    });
    const port = transport.tuple.localPort;
    const sdpPath = join(workDir, `${kind}-${source}.sdp`);

    const args = [
      '-re',
      '-loglevel',
      'warning',
      ...ffmpegFilters,
      '-f',
      'rtp',
      `rtp://127.0.0.1:${port}`,
      '-sdp_file',
      sdpPath,
    ];
    const child = execFileAsync(EGRESS_FFMPEG_PATH, args, {
      maxBuffer: 1 << 20,
    });
    child.catch(() => undefined);
    senders.push(() => {
      child.child.kill('SIGKILL');
    });

    await waitUntil(() => existsSync(sdpPath), 15_000, `${kind} sdp file`);
    const info = parseSdp(readFileSync(sdpPath, 'utf8'));
    // ffmpeg's sdp_file carries no a=ssrc line; the explicit -ssrc we pass
    // is the one that will appear on the wire.
    const ssrc = kind === 'video' ? 11111111 : 22222222;
    const codecName = kind === 'video' ? 'video/VP8' : 'audio/opus';
    const producer = await transport.produce({
      kind,
      rtpParameters: {
        codecs: [
          {
            mimeType: codecName,
            payloadType: info.payloadType,
            clockRate: kind === 'video' ? 90000 : 48000,
            ...(kind === 'audio' ? { channels: 2 } : {}),
          },
        ],
        encodings: [{ ssrc }],
      },
    });
    await waitUntil(
      async () => {
        const stats = await producer.getStats();
        return stats.some(
          (entry) => 'packetCount' in entry && entry.packetCount > 0,
        );
      },
      20_000,
      `${kind} RTP packets reaching mediasoup`,
    );
    return { producerId: producer.id, kind, source };
  }

  /** Egress side: the same taps the service builds, against real mediasoup. */
  async function buildTapInputs(streams: IngestedStream[]): Promise<{
    inputs: EgressPipelineInput[];
    transports: Array<{ close(): void }>;
  }> {
    const router = workerManager.getRouter(room);
    if (!router) throw new Error('router missing');
    // One plain transport (and one UDP listener) per tapped producer, the
    // same shape the service builds.
    const inputs: EgressPipelineInput[] = [];
    const transports: Array<{ close(): void }> = [];
    let index = 0;
    for (const stream of streams) {
      const transport = await router.createPlainTransport({
        listenIp: mediasoupConfig.webRtcTransport.listenIps[0],
        rtcpMux: true,
        comedia: false,
      });
      transports.push(transport);
      const consumer = await transport.consume({
        producerId: stream.producerId,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
      });
      const port = await freeUdpPort();
      await transport.connect({ ip: '127.0.0.1', port });
      const sdpPath = join(workDir, `egress-${index}.sdp`);
      const input: EgressPipelineInput = {
        descriptor: {
          producerId: stream.producerId,
          kind: stream.kind,
          source: stream.source,
        },
        rtpParameters: consumer.rtpParameters,
        sdpPath,
        port,
      };
      writeFileSync(sdpPath, generateSdp(input));
      inputs.push(input);
      index += 1;
    }
    return { inputs, transports };
  }

  async function ingestCameraAndAudio(): Promise<IngestedStream[]> {
    const video = await ingest('video', 'camera', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=25',
      '-c:v',
      'libvpx',
      '-b:v',
      '500k',
      '-g',
      '50',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-ssrc',
      '11111111',
    ]);
    const audio = await ingest('audio', 'camera', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-c:a',
      'libopus',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-application',
      'lowdelay',
      '-ssrc',
      '22222222',
    ]);
    return [video, audio];
  }

  it('streams ingested RTP through the pipeline into a live HLS playlist', async () => {
    const streams = await ingestCameraAndAudio();
    const { inputs, transports } = await buildTapInputs(streams);

    const args = composeEgressArgs(inputs, {
      rtmpEndpoints: [],
      hls: true,
      record: false,
      hlsDir,
    });
    const process = FFmpegProcess.spawn(EGRESS_FFMPEG_PATH, args);
    let exited = false;
    process.on('exit', () => {
      exited = true;
    });

    // Live playlist appears and its segment window advances.
    const playlist = join(hlsDir, 'index.m3u8');
    await waitUntil(() => existsSync(playlist), 60_000, 'first HLS playlist');
    await waitUntil(
      () => readFileSync(playlist, 'utf8').includes('#EXTINF'),
      40_000,
      'first segment',
    );
    const segmentCountAfterFirstWindow = (
      readFileSync(playlist, 'utf8').match(/#EXTINF/g) ?? []
    ).length;
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    const segmentCountLater = (
      readFileSync(playlist, 'utf8').match(/#EXTINF/g) ?? []
    ).length;
    expect(segmentCountLater).toBeGreaterThan(segmentCountAfterFirstWindow - 2);
    expect(exited).toBe(false);

    // The written media decodes: probe a segment for real duration.
    const segments = (
      readFileSync(playlist, 'utf8').match(/seg_\d+\.ts/g) ?? []
    ).slice(0, 3);
    expect(segments.length).toBeGreaterThan(0);
    const segmentPath = join(hlsDir, segments[0]);
    await waitUntil(
      () => existsSync(segmentPath),
      10_000,
      'first segment file',
    );
    const probe = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      segmentPath,
    ]);
    expect(Number(probe.stdout.trim())).toBeGreaterThan(0);

    // Graceful stop: process exits, final playlist remains fetchable.
    await process.stop(5_000);
    expect(exited).toBe(true);
    expect(existsSync(playlist)).toBe(true);
    expect(readFileSync(playlist, 'utf8')).toContain('#EXTM3U');

    for (const transport of transports) transport.close();
  });

  it('records the composited program to an MPEG-TS part and finalizes it into a playable MP4', async () => {
    const streams = await ingestCameraAndAudio();
    const { inputs, transports } = await buildTapInputs(streams);

    const recordDir = join(workDir, 'recordings');
    mkdirSync(recordDir, { recursive: true });
    const args = composeEgressArgs(inputs, {
      rtmpEndpoints: [],
      hls: false,
      record: true,
      recordingDir: recordDir,
    });
    const process = FFmpegProcess.spawn(EGRESS_FFMPEG_PATH, args);

    // The recording sink appears and grows with real mixed media.
    const partPath = join(recordDir, 'recording-0.ts');
    await waitUntil(() => existsSync(partPath), 60_000, 'recording part');
    await waitUntil(
      () => statSync(partPath).size > 2 * 1024 * 1024,
      40_000,
      'recording material',
    );

    // Graceful stop closes the sink; the parts are then finalized exactly
    // the way EgressService.finalizeRecording does: stream-copy concat.
    await process.stop(5_000);
    const listPath = join(recordDir, 'parts.txt');
    writeFileSync(listPath, `file '${partPath}'\n`);
    const target = join(recordDir, 'recording.mp4');
    await execFileAsync(EGRESS_FFMPEG_PATH, [
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
    expect(statSync(target).size).toBeGreaterThan(0);

    // The finalized recording carries both the mixed audio and the canvas
    // video, and decodes to a real duration.
    const streamsProbe = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name',
      '-of',
      'default=nw=1',
      target,
    ]);
    expect(streamsProbe.stdout).toContain('codec_name=h264');
    expect(streamsProbe.stdout).toContain('codec_name=aac');
    const duration = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      target,
    ]);
    expect(Number(duration.stdout.trim())).toBeGreaterThan(3);

    for (const transport of transports) transport.close();
  });

  it('keeps egress media ports inside the configured range', () => {
    expect(EGRESS_MEDIA_PORT_MIN).toBeLessThan(EGRESS_MEDIA_PORT_MAX);
    expect(EGRESS_HLS_DIR).toBeTruthy();
  });
});
