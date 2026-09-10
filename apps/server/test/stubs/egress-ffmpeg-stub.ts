/**
 * Stub FFmpeg binary for the client-egress e2e flow.
 *
 * Import this module BEFORE anything that pulls `egress.config` - it sets
 * EGRESS_FFMPEG_PATH at require time so the service spawns the stub.
 *
 * Pipeline mode: writes the recording part sink if one appears in the args,
 * prints a progress heartbeat on stdout, then idles until stopped.
 * Finalizer mode (args contain `-f concat`): writes the target MP4 and exits.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stubDir = join(tmpdir(), 'zvonok-e2e-egress-stub');
mkdirSync(stubDir, { recursive: true });

const script = `#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const args = process.argv.slice(2);


if (args.includes('concat')) {
  const target = args[args.length - 1];
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from('fake-mp4-material-0123456789'));
  process.exit(0);
}

const tsArg = args.find((arg) => /recording-\\d+\\.ts$/.test(arg));
if (tsArg) {
  const target = tsArg.replace(/\\[f=[^\\]]+\\]/, '');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from('fake-ts-part'));
}

process.stdout.write('out_time_ms=1\\n');
setInterval(() => {}, 1 << 30);
`;

const stubPath = join(stubDir, 'ffmpeg-stub.js');
writeFileSync(stubPath, script, { mode: 0o755 });
chmodSync(stubPath, 0o755);

process.env.EGRESS_FFMPEG_PATH = stubPath;
process.env.EGRESS_RECORDINGS_DIR = join(stubDir, 'recordings');
process.env.EGRESS_HLS_DIR = join(stubDir, 'hls');

export const EGRESS_STUB_PATH = stubPath;
