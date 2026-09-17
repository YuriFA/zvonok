/**
 * Actions unit of the SFU manager: request-side host controls, egress
 * control, and the ephemeral data channel, each settling on the server's
 * acknowledgement. Owns the broadcast and guest-request callback
 * registries. Session termination (kick/room-ended teardown) stays with
 * the manager facade.
 */

import type { Socket } from "socket.io-client";

import type {
  SfuBroadcastErrorCode,
  SfuBroadcastMessage,
  SfuEgressActionErrorCode,
  SfuEgressOutputRequest,
  SfuEgressStatusPayload,
  SfuGuestJoinRequestPayload,
  SfuHostActionErrorCode,
  SfuState,
} from "./types.js";
import { SfuHostActionError, SfuEgressActionError, SfuBroadcastError } from "./types.js";

/** How the unit reaches the socket and the shared manager state. */
export interface SfuActionsHost {
  getSocket(): Socket | null;
  updateState(partial: Partial<SfuState>): void;
}

export class SfuActions {
  private readonly host: SfuActionsHost;
  private broadcastCallbacks = new Set<(message: SfuBroadcastMessage) => void>();
  private guestJoinRequestCallbacks = new Set<(payload: SfuGuestJoinRequestPayload) => void>();

  constructor(host: SfuActionsHost) {
    this.host = host;
  }

  // ISfuHostControls
  mutePeer(userId: string, options?: { timeoutMs?: number }): Promise<void> {
    return this.emitHostAction("sfu:mute-peer", { userId }, options?.timeoutMs);
  }

  muteAll(options?: { timeoutMs?: number }): Promise<void> {
    return this.emitHostAction("sfu:mute-all", {}, options?.timeoutMs);
  }

  lockRoom(locked: boolean, options?: { timeoutMs?: number }): Promise<void> {
    return this.emitHostAction("sfu:lock-room", { locked }, options?.timeoutMs);
  }

  kickPeer(userId: string, options?: { timeoutMs?: number }): Promise<void> {
    return this.emitHostAction("sfu:kick-peer", { userId }, options?.timeoutMs);
  }

  /** How long to wait for a host-action acknowledgement before failing. */
  private static readonly HOST_ACTION_TIMEOUT_MS = 10_000;

  /**
   * Emits a host-control event and settles on the server's acknowledgement
   * through {@link SfuActions.emitAck}.
   */
  private emitHostAction(
    event: "sfu:mute-peer" | "sfu:mute-all" | "sfu:lock-room" | "sfu:kick-peer",
    payload: Record<string, string | boolean>,
    timeoutMs?: number,
  ): Promise<void> {
    return this.emitAck<SfuHostActionErrorCode>({
      event,
      payload,
      timeoutMs: timeoutMs ?? SfuActions.HOST_ACTION_TIMEOUT_MS,
      timeoutCode: "HOST_ACTION_TIMEOUT",
      fallbackCode: "MISSING_CAPABILITY",
      disconnectedMessage: "Join the room before using host controls",
      makeError: (code, message) => new SfuHostActionError(code, message),
    });
  }

  /**
   * The single request primitive behind every acknowledgement-settled
   * action: emits `event` with `payload`; `{ok: true}` resolves;
   * `{ok: false, code, message}` rejects with `makeError(code ??
   * fallbackCode, message ?? "Server denied <event>")`; no acknowledgement
   * within `timeoutMs` rejects with `timeoutCode`; no socket rejects with
   * DISCONNECTED. The host, egress, and broadcast vocabularies share this
   * contract.
   */
  private emitAck<C extends string>(options: {
    event: string;
    payload: Record<string, unknown>;
    timeoutMs: number;
    timeoutCode: C;
    fallbackCode: C;
    disconnectedMessage: string;
    makeError: (code: C, message: string) => Error;
  }): Promise<void> {
    const socket = this.host.getSocket();
    if (!socket) {
      return Promise.reject(options.makeError("DISCONNECTED" as C, options.disconnectedMessage));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          options.makeError(
            options.timeoutCode,
            `Server did not acknowledge ${options.event} within ${options.timeoutMs}ms`,
          ),
        );
      }, options.timeoutMs);
      socket.emit(options.event, options.payload, (ack: unknown) => {
        clearTimeout(timer);
        const { ok, code, message } = (ack ?? {}) as {
          ok?: boolean;
          code?: string;
          message?: string;
        };
        if (ok === true) {
          resolve();
          return;
        }
        reject(
          options.makeError(
            (code as C) ?? options.fallbackCode,
            message ?? `Server denied ${options.event}`,
          ),
        );
      });
    });
  }

  // Egress control (client-initiated sessions; RTMP stays server-side)
  startEgress(outputs: SfuEgressOutputRequest, options?: { timeoutMs?: number }): Promise<void> {
    return this.emitEgressAction(
      "egress:start",
      { record: outputs.record === true, hls: outputs.hls === true },
      options?.timeoutMs,
    );
  }

  stopEgress(options?: { timeoutMs?: number }): Promise<void> {
    return this.emitEgressAction("egress:stop", {}, options?.timeoutMs);
  }

  /** How long to wait for an egress acknowledgement before failing. */
  private static readonly EGRESS_ACTION_TIMEOUT_MS = 10_000;

  /**
   * Emits an egress control event and settles on the server's
   * acknowledgement through {@link SfuActions.emitAck}.
   */
  private emitEgressAction(
    event: "egress:start" | "egress:stop",
    payload: Record<string, boolean>,
    timeoutMs?: number,
  ): Promise<void> {
    return this.emitAck<SfuEgressActionErrorCode>({
      event,
      payload,
      timeoutMs: timeoutMs ?? SfuActions.EGRESS_ACTION_TIMEOUT_MS,
      timeoutCode: "EGRESS_ACTION_TIMEOUT",
      fallbackCode: "EGRESS_UNAVAILABLE",
      disconnectedMessage: "Join the room before controlling egress",
      makeError: (code, message) => new SfuEgressActionError(code, message),
    });
  }

  // Data channel (ephemeral topic-scoped broadcasts)
  sendBroadcast(topic: string, payload: unknown, options?: { timeoutMs?: number }): Promise<void> {
    return this.emitAck<SfuBroadcastErrorCode>({
      event: "sfu:broadcast",
      payload: { topic, payload },
      timeoutMs: options?.timeoutMs ?? SfuActions.BROADCAST_TIMEOUT_MS,
      timeoutCode: "BROADCAST_TIMEOUT",
      fallbackCode: "MISSING_CAPABILITY",
      disconnectedMessage: "Join the room before broadcasting",
      makeError: (code, message) => new SfuBroadcastError(code, message),
    });
  }

  /** How long to wait for a broadcast acknowledgement before failing. */
  private static readonly BROADCAST_TIMEOUT_MS = 10_000;

  onBroadcast(callback: (message: SfuBroadcastMessage) => void): () => void {
    this.broadcastCallbacks.add(callback);
    return () => this.broadcastCallbacks.delete(callback);
  }

  handleBroadcast(message: SfuBroadcastMessage): void {
    // The server never echoes a sender's own message, so every relay that
    // lands here came from another participant.
    this.host.updateState({ lastBroadcast: message });
    for (const callback of this.broadcastCallbacks) {
      callback(message);
    }
  }

  handleEgressStatus(payload: SfuEgressStatusPayload): void {
    this.host.updateState({ egress: payload });
  }

  onGuestJoinRequest(callback: (payload: SfuGuestJoinRequestPayload) => void): () => void {
    this.guestJoinRequestCallbacks.add(callback);
    return () => this.guestJoinRequestCallbacks.delete(callback);
  }

  handleGuestJoinRequest(payload: SfuGuestJoinRequestPayload): void {
    for (const cb of this.guestJoinRequestCallbacks) {
      cb(payload);
    }
  }
}
