/**
 * Actions unit of the SFU manager: request-side host controls, egress
 * control, and the ephemeral data channel, each settling on the server's
 * acknowledgement. Owns the broadcast and guest-request callback
 * registries. Session termination (kick/room-ended teardown) stays with
 * the manager facade.
 */

import type { Socket } from "socket.io-client";

import type {
  SfuBroadcastMessage,
  SfuEgressOutputRequest,
  SfuEgressStatusPayload,
  SfuGuestJoinRequestPayload,
  SfuState,
} from "./types.js";

import {
  SfuHostActionError,
  SfuEgressActionError,
  SfuBroadcastError,
} from "./types.js";

/** How the unit reaches the socket and the shared manager state. */
export interface SfuActionsHost {
  getSocket(): Socket | null;
  updateState(partial: Partial<SfuState>): void;
}

export class SfuActions {
  private readonly host: SfuActionsHost;
  private broadcastCallbacks = new Set<(message: SfuBroadcastMessage) => void>();
  private guestJoinRequestCallbacks = new Set<
    (payload: SfuGuestJoinRequestPayload) => void
  >();

  constructor(host: SfuActionsHost) {
    this.host = host;
  }

  // ISfuHostControls
  mutePeer(
    userId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    return this.emitHostAction("sfu:mute-peer", { userId }, options?.timeoutMs);
  }

  muteAll(options?: { timeoutMs?: number }): Promise<void> {
    return this.emitHostAction("sfu:mute-all", {}, options?.timeoutMs);
  }

  lockRoom(
    locked: boolean,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    return this.emitHostAction("sfu:lock-room", { locked }, options?.timeoutMs);
  }

  kickPeer(
    userId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    return this.emitHostAction("sfu:kick-peer", { userId }, options?.timeoutMs);
  }

  /** How long to wait for a host-action acknowledgement before failing. */
  private static readonly HOST_ACTION_TIMEOUT_MS = 10_000;

  /**
   * Emits a host-control event and settles on the server's acknowledgement:
   * `{ok: true}` resolves; `{ok: false, code, message}` rejects with a typed
   * SfuHostActionError carrying the server's code. A missing acknowledgement
   * rejects with HOST_ACTION_TIMEOUT.
   */
  private emitHostAction(
    event: "sfu:mute-peer" | "sfu:mute-all" | "sfu:lock-room" | "sfu:kick-peer",
    payload: Record<string, string | boolean>,
    timeoutMs?: number,
  ): Promise<void> {
    const socket = this.host.getSocket();
    if (!socket) {
      return Promise.reject(
        new SfuHostActionError(
          "DISCONNECTED",
          "Join the room before using host controls",
        ),
      );
    }

    const wait = timeoutMs ?? SfuActions.HOST_ACTION_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SfuHostActionError(
            "HOST_ACTION_TIMEOUT",
            `Server did not acknowledge ${event} within ${wait}ms`,
          ),
        );
      }, wait);
      socket.emit(event, payload, (ack: unknown) => {
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
          new SfuHostActionError(
            (code as SfuHostActionError["code"]) ?? "MISSING_CAPABILITY",
            message ?? `Server denied ${event}`,
          ),
        );
      });
    });
  }

  // Egress control (client-initiated sessions; RTMP stays server-side)
  startEgress(
    outputs: SfuEgressOutputRequest,
    options?: { timeoutMs?: number },
  ): Promise<void> {
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
   * acknowledgement, mirroring the host-action ack contract.
   */
  private emitEgressAction(
    event: "egress:start" | "egress:stop",
    payload: Record<string, boolean>,
    timeoutMs?: number,
  ): Promise<void> {
    const socket = this.host.getSocket();
    if (!socket) {
      return Promise.reject(
        new SfuEgressActionError(
          "DISCONNECTED",
          "Join the room before controlling egress",
        ),
      );
    }

    const wait = timeoutMs ?? SfuActions.EGRESS_ACTION_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SfuEgressActionError(
            "EGRESS_ACTION_TIMEOUT",
            `Server did not acknowledge ${event} within ${wait}ms`,
          ),
        );
      }, wait);
      socket.emit(event, payload, (ack: unknown) => {
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
          new SfuEgressActionError(
            (code as SfuEgressActionError["code"]) ?? "EGRESS_UNAVAILABLE",
            message ?? `Server denied ${event}`,
          ),
        );
      });
    });
  }

  // Data channel (ephemeral topic-scoped broadcasts)
  sendBroadcast(
    topic: string,
    payload: unknown,
    options?: { timeoutMs?: number },
  ): Promise<void> {
    const socket = this.host.getSocket();
    if (!socket) {
      return Promise.reject(
        new SfuBroadcastError(
          "DISCONNECTED",
          "Join the room before broadcasting",
        ),
      );
    }

    const wait = options?.timeoutMs ?? SfuActions.BROADCAST_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SfuBroadcastError(
            "BROADCAST_TIMEOUT",
            `Server did not acknowledge sfu:broadcast within ${wait}ms`,
          ),
        );
      }, wait);
      socket.emit("sfu:broadcast", { topic, payload }, (ack: unknown) => {
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
          new SfuBroadcastError(
            (code as SfuBroadcastError["code"]) ?? "MISSING_CAPABILITY",
            message ?? "Server denied sfu:broadcast",
          ),
        );
      });
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

  onGuestJoinRequest(
    callback: (payload: SfuGuestJoinRequestPayload) => void,
  ): () => void {
    this.guestJoinRequestCallbacks.add(callback);
    return () => this.guestJoinRequestCallbacks.delete(callback);
  }

  handleGuestJoinRequest(payload: SfuGuestJoinRequestPayload): void {
    for (const cb of this.guestJoinRequestCallbacks) {
      cb(payload);
    }
  }
}
