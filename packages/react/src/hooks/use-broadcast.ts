/**
 * Data channel hooks: an ack-settled send action and a topic-filtered
 * receive surface over the room's ephemeral broadcast channel. Sends
 * settle on the server's acknowledgement; denials reject with
 * ZvonokBroadcastError carrying the server's coded error. Received
 * messages never include the local consumer's own broadcasts - the server
 * does not echo senders.
 */

import { useEffect, useMemo, useState } from "react";

import type { SfuManager } from "@zvonok/client/sfu/manager";
import { SfuBroadcastError } from "@zvonok/client/sfu/types";
import type { SfuBroadcastMessage } from "@zvonok/client/sfu/types";

import { ZvonokBroadcastError } from "../errors.js";
import { useZvonokSession } from "../contexts/zvonok-context.js";

export interface UseBroadcastResult {
  send(topic: string, payload: unknown): Promise<void>;
}

/** Re-exposes the core's typed broadcast error as the SDK error type. */
function toZvonokBroadcastError(error: unknown): ZvonokBroadcastError {
  if (error instanceof SfuBroadcastError) {
    return new ZvonokBroadcastError(error.code, error.message);
  }
  return new ZvonokBroadcastError(
    "BROADCAST_FAILED",
    error instanceof Error ? error.message : "Broadcast failed",
  );
}

export function useBroadcast(): UseBroadcastResult {
  const session = useZvonokSession();

  return useMemo(() => {
    const send = (topic: string, payload: unknown): Promise<void> => {
      const manager = session.manager;
      if (!manager) {
        return Promise.reject(
          new ZvonokBroadcastError(
            "DISCONNECTED",
            "Join the room before broadcasting",
          ),
        );
      }
      return manager.sendBroadcast(topic, payload).catch((error: unknown) => {
        throw toZvonokBroadcastError(error);
      });
    };

    return { send };
  }, [session.manager]);
}

export interface UseBroadcastsResult {
  /** Messages received on the subscribed topic, oldest first. */
  messages: SfuBroadcastMessage[];
}

/**
 * Receive surface for one topic: delivers only broadcasts other
 * participants sent on that topic. Ephemeral by design - the list starts
 * empty on every mount and never replays past messages.
 */
export function useBroadcasts(topic: string): UseBroadcastsResult {
  const session = useZvonokSession();
  const [messages, setMessages] = useState<SfuBroadcastMessage[]>([]);

  useEffect(() => {
    const manager: SfuManager | null = session.manager;
    if (!manager) {
      setMessages([]);
      return;
    }
    return manager.onBroadcast((message) => {
      if (message.topic !== topic) return;
      setMessages((previous) => [...previous, message]);
    });
  }, [session.manager, topic]);

  return { messages };
}
