import { createHmac } from 'node:crypto';
import type {
  WorkerSettings,
  RouterOptions,
  WebRtcTransportOptions,
} from 'mediasoup/types';

/**
 * Simulcast encoding layers for video producers.
 * Clients pass these when creating a video producer so the SFU receives
 * three spatial layers: low (quarter resolution, 15 fps), mid (half, 24 fps),
 * and high (full resolution, up to 2 Mbps).
 */
export interface SimulcastEncoding {
  rid: string;
  maxBitrate: number;
  scaleResolutionDownBy?: number;
  maxFramerate?: number;
}

export const SIMULCAST_ENCODINGS: SimulcastEncoding[] = [
  {
    rid: 'low',
    maxBitrate: 150_000,
    scaleResolutionDownBy: 4,
    maxFramerate: 15,
  },
  {
    rid: 'mid',
    maxBitrate: 500_000,
    scaleResolutionDownBy: 2,
    maxFramerate: 24,
  },
  { rid: 'high', maxBitrate: 2_000_000 },
];

/**
 * ICE server entry sent to clients for RTCPeerConnection configuration.
 * Matches the browser RTCIceServer interface.
 */
export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * TTL for ephemeral TURN credentials: 6 hours. Generous enough for long
 * meetings (an allocation survives past its expiry), short enough that a
 * leaked credential stops working within hours.
 */
export const TURN_CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

/**
 * coturn REST auth-secret password (draft-uberti-rtcweb-turn-rest):
 * base64(HMAC-SHA1(secret, username)).
 */
export function mintTurnPassword(secret: string, username: string): string {
  return createHmac('sha1', secret).update(username).digest('base64');
}

/**
 * Build ICE servers list from environment variables.
 * Always includes Google public STUN as a baseline.
 * Appends a TURN entry only when both TURN_URL and TURN_AUTH_SECRET are set:
 * the entry then carries ephemeral credentials (username
 * `<unix-expiry>:zvonok`, TTL below) that coturn verifies via
 * use-auth-secret. A credential-less `turn:` URL is rejected by the browser
 * RTCConfiguration ("Both username and credential are required..."), so an
 * unauthenticated development coturn cannot be advertised - clients fall
 * back to STUN and host candidates.
 */
export function getIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ];

  const turnUrl = process.env.TURN_URL;
  const turnsUrl = process.env.TURNS_URL;
  const authSecret = process.env.TURN_AUTH_SECRET;

  if (turnUrl && authSecret) {
    const expiry = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiry}:zvonok`;
    servers.push({
      urls: turnsUrl ? [turnUrl, turnsUrl] : [turnUrl],
      username,
      credential: mintTurnPassword(authSecret, username),
    });
  }

  return servers;
}

export const config = {
  worker: {
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    // Default 500 ports (~250 concurrent transports incl. egress taps);
    // must stay disjoint from EGRESS_MEDIA_PORT_MIN/MAX (42000-42100).
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000', 10),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '40499', 10),
  } satisfies WorkerSettings,

  webRtcTransport: {
    listenIps: [
      {
        ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1',
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  } satisfies WebRtcTransportOptions,

  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  } satisfies RouterOptions,
};

/**
 * Production cannot work with loopback media addresses: remote clients get
 * candidates they can never reach. Fail fast at boot instead of debugging
 * one-way audio after deploy.
 */
export function assertProductionMediaConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const listenIp = process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1';
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP;
  if (listenIp === '127.0.0.1' || !announcedIp) {
    throw new Error(
      'Production media config invalid: set MEDIASOUP_ANNOUNCED_IP to the server public IP and MEDIASOUP_LISTEN_IP to a non-loopback address',
    );
  }
}
