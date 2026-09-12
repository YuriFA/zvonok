import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Binary used to run egress pipelines. Must be ffmpeg >= 5 (tee muxer with
 * onfail, xstack).
 */
export const EGRESS_FFMPEG_PATH = process.env.EGRESS_FFMPEG_PATH || 'ffmpeg';

/**
 * UDP port range FFmpeg binds for RTP ingest. Must not overlap the
 * mediasoup RTC range (RTC_MIN_PORT/RTC_MAX_PORT, default 40000-40099).
 */
export const EGRESS_MEDIA_PORT_MIN = parseInt(
  process.env.EGRESS_MEDIA_PORT_MIN || '42000',
  10,
);
export const EGRESS_MEDIA_PORT_MAX = parseInt(
  process.env.EGRESS_MEDIA_PORT_MAX || '42100',
  10,
);

/** Root directory for HLS segment trees, one subdirectory per egress id. */
export const EGRESS_HLS_DIR =
  process.env.EGRESS_HLS_DIR || join(tmpdir(), 'zvonok-egress-hls');
/**
 * Root directory for session recordings, one subdirectory per egress id.
 * Defaults under the server cwd: recordings are durable artifacts, unlike
 * the transient HLS segment trees.
 */
export const EGRESS_RECORDINGS_DIR =
  process.env.EGRESS_RECORDINGS_DIR ||
  join(process.cwd(), 'data', 'egress-recordings');

/**
 * Development escape hatch: when true, RTMP endpoints on loopback/private
 * addresses (local mediamtx) are accepted. Never enable in production.
 */
export const EGRESS_ALLOW_PRIVATE_TARGETS =
  process.env.EGRESS_ALLOW_PRIVATE_TARGETS === 'true';

/** A session must produce its first output heartbeat within this budget. */
export const EGRESS_START_TIMEOUT_MS = 30_000;

/** Membership changes are coalesced into one pipeline rebuild after this. */
export const EGRESS_RESTART_DEBOUNCE_MS = 2_000;

/**
 * Bounded retry budget: no more than MAX_RESTARTS within this window. Wide
 * enough that a 30 s start-timeout loop cannot slide failures out of the
 * window forever, tight enough that crash loops fail within seconds.
 */
export const EGRESS_RETRY_WINDOW_MS = 300_000;
export const EGRESS_MAX_RESTARTS = 3;

/** Grace period for a graceful (SIGINT) pipeline stop before SIGKILL. */
export const EGRESS_STOP_GRACE_MS = 5_000;

export const MAX_RTMP_ENDPOINTS = 3;

/** Live window of the HLS playlist, in segments. */
export const EGRESS_HLS_SEGMENT_SECONDS = 4;
export const EGRESS_HLS_LIST_SIZE = 6;
