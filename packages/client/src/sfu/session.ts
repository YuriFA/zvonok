/**
 * Session unit of the SFU manager: join lifecycle and automatic recovery.
 * Owns the accepted join payload, the rejoin rate limit, the one-shot
 * token refresh, and the join/reconnect error callback registries. The
 * mediasoup device, the transports, and the teardown orchestration stay
 * with the manager facade (they are shared with the publish and subscribe
 * units) and are reached through the narrow host interface below.
 */

import type { RtpCapabilities } from "mediasoup-client/types";
import type { Socket } from "socket.io-client";

import { createLogger } from "../helpers/logger.js";
import type {
  SfuJoinErrorPayload,
  SfuJoinedPayload,
  SfuJoinOptions,
  SfuJoinPayload,
  SfuKickedPayload,
  SfuState,
} from "./types.js";
import { SfuJoinError, SfuReconnectError } from "./types.js";

/** Rejoin storm guard: no more than this many rejoins per sliding window. */
const REJOIN_WINDOW_MS = 30_000;
const REJOIN_MAX_PER_WINDOW = 5;

/** How the unit rebuilds media and reaches the shared manager state. */
export interface SfuSessionHost {
  getSocket(): Socket | null;
  updateState(partial: Partial<SfuState>): void;
  setLocalUserId(userId: string | null): void;
  /** Loads a fresh device and requests new transports (join/media reset). */
  loadDevice(routerRtpCapabilities: RtpCapabilities): Promise<void>;
  /** Full media teardown: producers, consumers, transports, peers. */
  closeAll(): void;
  /** Post-teardown media reset: device dropped, producer buffer cleared. */
  resetMediaState(): void;
  /** Holds live local tracks and produce intents across a blip. */
  retainLocalProduces(): void;
  /** Replays retained local produces after the pipeline is rebuilt. */
  replayRetainedProduces(): void;
  /** Drops retained produce intents: the session is intentionally over. */
  clearRetainedLocalProduces(): void;
  /** Terminal kick handling: callbacks, socket and router teardown. */
  handleKicked(payload: SfuKickedPayload): void;
}

export class SfuSession {
  private readonly log = createLogger("sfu");
  private readonly host: SfuSessionHost;
  private joinErrorCallbacks = new Set<(error: SfuJoinError) => void>();
  private reconnectErrorCallbacks = new Set<
    (error: SfuReconnectError) => void
  >();
  // Automatic recovery: the last accepted join payload is replayed after a
  // signalling drop, so the session survives blips without consumer action.
  private lastJoinPayload: SfuJoinPayload | null = null;
  /** True once a join succeeded; disconnects then enter recovery. */
  private sessionEstablished = false;
  private joinOptions: SfuJoinOptions | null = null;
  /** One token refresh attempt per rejoin. */
  private tokenRefreshAttempted = false;
  /** Timestamps of recent rejoins for the sliding-window rate limit. */
  private rejoinTimes: number[] = [];

  constructor(host: SfuSessionHost) {
    this.host = host;
  }

  // ISfuRoomMembership
  async joinRoom(
    payload: SfuJoinPayload,
    options?: SfuJoinOptions,
  ): Promise<void> {
    const socket = this.host.getSocket();
    if (!socket) {
      throw new Error("Socket not connected");
    }
    this.joinOptions = options ?? this.joinOptions;
    this.lastJoinPayload = payload;
    // The room token is authoritative: its `sub` claim is the room id the
    // server minted it for. Callers frequently only know the room slug, and
    // sending a slug as roomId fails verification with
    // ROOM_TOKEN_ROOM_MISMATCH whenever slug !== id.
    const tokenRoomId = payload.token
      ? readRoomIdFromToken(payload.token)
      : null;
    socket.emit("sfu:join", {
      ...payload,
      roomId: tokenRoomId ?? payload.roomId,
    });
  }

  /** True once a join succeeded and the session was not terminated; a
   * connected socket with this false still needs an explicit joinRoom. */
  hasJoinedSession(): boolean {
    return this.sessionEstablished;
  }

  /** True when a join succeeded and its payload can be replayed after a
   * signalling drop (recovery and media-reset decisions). */
  hasRecoverableSession(): boolean {
    return this.sessionEstablished && this.lastJoinPayload !== null;
  }

  // Event handlers
  handleConnected(): void {
    this.log.info("[SFU] Connected");
    if (this.sessionEstablished && this.lastJoinPayload) {
      // socket.io reconnected mid-session: replay the join pipeline and
      // keep the reconnecting status until the join ack lands. A
      // sliding-window rate limit stops endless flapping from looping the
      // rejoin forever; exceeding it fails recovery like a socket
      // exhaustion would.
      if (!this.allowRejoin()) {
        this.failRecovery(
          new SfuReconnectError(
            "RECONNECT_EXHAUSTED",
            "Too many rejoin attempts in a short window",
          ),
        );
        return;
      }
      this.tokenRefreshAttempted = false;
      void this.joinRoom(this.lastJoinPayload).catch(() => undefined);
      return;
    }
    this.host.updateState({ connectionState: "connected" });
  }

  /** Sliding-window rejoin budget; false when this rejoin exceeds it. */
  private allowRejoin(): boolean {
    const now = Date.now();
    this.rejoinTimes = this.rejoinTimes.filter((t) => now - t < REJOIN_WINDOW_MS);
    if (this.rejoinTimes.length >= REJOIN_MAX_PER_WINDOW) {
      this.log.warn("[SFU] Rejoin rate limit reached, giving up recovery");
      return false;
    }
    this.rejoinTimes.push(now);
    return true;
  }

  handleDisconnected(): void {
    this.log.info("[SFU] Disconnected");
    const recovering = this.sessionEstablished && this.lastJoinPayload !== null;
    this.host.updateState({
      connectionState: recovering ? "reconnecting" : "connecting",
    });
    if (recovering) {
      this.host.retainLocalProduces();
    }
    this.host.closeAll();
    this.host.resetMediaState();
  }

  handleReconnectFailed(): void {
    this.log.warn("[SFU] Reconnect failed");
    if (this.sessionEstablished && this.lastJoinPayload) {
      this.failRecovery(
        new SfuReconnectError(
          "RECONNECT_EXHAUSTED",
          "Could not re-establish the signalling connection",
        ),
      );
      return;
    }
    this.host.updateState({ connectionState: "failed" });
  }

  async handleJoined(payload: SfuJoinedPayload): Promise<void> {
    this.log.info("[SFU] Joined room, loading device...");
    // The server echoes back the verified identity and the effective
    // capabilities; payload identity is never trusted and rights are never
    // decoded from the token client-side.
    this.host.setLocalUserId(payload.participant?.id ?? null);
    this.host.updateState({ capabilities: payload.capabilities ?? [] });
    if (this.sessionEstablished) {
      // Recovery complete: back to connected; retained tracks re-produce
      // through the rebuilt pipeline (buffered until the transport exists).
      this.host.updateState({ connectionState: "connected" });
      this.host.replayRetainedProduces();
    }
    this.sessionEstablished = true;
    await this.host.loadDevice(payload.routerRtpCapabilities);
  }

  handleJoinError(payload: SfuJoinErrorPayload): void {
    this.log.error("[SFU] Join error:", payload.code, payload.message);
    const error = new SfuJoinError(payload.code, payload.message);

    if (this.sessionEstablished && this.lastJoinPayload) {
      // A rejoin denial during recovery: kicked is terminal, an expired
      // token retries once through the provider, anything else stops.
      if (payload.code === "KICKED_FROM_ROOM") {
        this.host.handleKicked({ roomId: this.lastJoinPayload.roomId });
        return;
      }
      if (payload.code === "ROOM_TOKEN_EXPIRED") {
        void this.refreshTokenAndRejoin(error);
        return;
      }
      this.failRecovery(error);
      return;
    }

    for (const cb of this.joinErrorCallbacks) {
      cb(error);
    }
  }

  /** One provider retry per rejoin; any further denial fails typed. */
  private async refreshTokenAndRejoin(error: SfuJoinError): Promise<void> {
    const provider = this.joinOptions?.tokenProvider;
    if (!provider || this.tokenRefreshAttempted) {
      this.failRecovery(error);
      return;
    }
    this.tokenRefreshAttempted = true;
    try {
      const token = await provider();
      if (!this.lastJoinPayload) return;
      this.lastJoinPayload = { ...this.lastJoinPayload, token };
      await this.joinRoom(this.lastJoinPayload);
    } catch (providerError) {
      this.failRecovery(
        new SfuJoinError(
          "ROOM_TOKEN_EXPIRED",
          `Token provider failed: ${providerError instanceof Error ? providerError.message : "unknown error"}`,
        ),
      );
    }
  }

  /** Terminal recovery failure: stop retrying, fail typed, release state. */
  private failRecovery(error: SfuJoinError | SfuReconnectError): void {
    this.clearSession();
    this.host.closeAll();
    this.host.updateState({ connectionState: "failed" });
    if (error instanceof SfuJoinError) {
      for (const cb of this.joinErrorCallbacks) {
        cb(error);
      }
      return;
    }
    for (const cb of this.reconnectErrorCallbacks) {
      cb(error);
    }
  }

  /** Drops all recovery bookkeeping: the session is intentionally over. */
  clearSession(): void {
    this.sessionEstablished = false;
    this.lastJoinPayload = null;
    this.tokenRefreshAttempted = false;
    this.rejoinTimes = [];
    this.host.clearRetainedLocalProduces();
  }

  /** Subscribe to server-refused joins (invalid token, unauthenticated
   * session, forbidden room). Returns an unsubscribe function. */
  onJoinError(callback: (error: SfuJoinError) => void): () => void {
    this.joinErrorCallbacks.add(callback);
    return () => this.joinErrorCallbacks.delete(callback);
  }

  /** Subscribe to automatic-recovery failures (exhausted retries,
   * terminal rejoin denials). Returns an unsubscribe function. */
  onReconnectError(callback: (error: SfuReconnectError) => void): () => void {
    this.reconnectErrorCallbacks.add(callback);
    return () => this.reconnectErrorCallbacks.delete(callback);
  }
}

/**
 * Reads the room id (`sub` claim) from an unverified room token. The server
 * verifies the signature; this only routes the join to the right room.
 */
export function readRoomIdFromToken(token: string): string | null {
  try {
    const [, payloadPart] = token.split(".");
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}
