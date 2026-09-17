/**
 * ParticipantRegistry: the single owner of remote participant state for a
 * room. The facade (participant lifecycle events) and the subscribe unit
 * (producer attach) both go through this module, so the merge, detach, and
 * reattach invariants live in one place. Pure state: the notification
 * registries stay with the facade.
 */

import type { SfuMediaSource, SfuParticipantInfo } from "./types.js";

/** Producer metadata attached to a participant when media is announced. */
export interface ParticipantProducerInfo {
  kind: "audio" | "video";
  paused?: boolean;
  source?: SfuMediaSource;
}

/** Lifecycle input shared by the peer-joined and existing-peers payloads. */
export interface ParticipantLifecycleInput {
  userId: string;
  username?: string;
  externalId?: string;
  metadata?: unknown;
}

export class ParticipantRegistry {
  private peers = new Map<string, SfuParticipantInfo>();

  /**
   * Inserts or updates a participant from a lifecycle payload. A new record
   * starts with no media state; an update refreshes a supplied username and
   * marks media live again (a (re)join after a detach).
   */
  upsert(input: ParticipantLifecycleInput): {
    peer: SfuParticipantInfo;
    created: boolean;
  } {
    let peer = this.peers.get(input.userId);
    if (!peer) {
      peer = {
        userId: input.userId,
        username: input.username || "",
        externalId: input.externalId,
        metadata: input.metadata,
        producers: new Map(),
      };
      this.peers.set(input.userId, peer);
      return { peer, created: true };
    }
    if (input.username) {
      peer.username = input.username;
    }
    peer.mediaConnected = true;
    return { peer, created: false };
  }

  /**
   * Attaches an announced producer to the participant and marks their media
   * live: media from this participant is flowing. No-op for an unknown
   * participant (callers upsert first).
   */
  attachProducer(userId: string, producerId: string, info: ParticipantProducerInfo): void {
    const peer = this.peers.get(userId);
    if (!peer) {
      return;
    }
    peer.producers.set(producerId, info);
    peer.mediaConnected = true;
  }

  /**
   * Marks the participant's media detached. Returns the record only when a
   * detach transition happened: unknown users and already-detached
   * participants return undefined so callers do not re-notify.
   */
  markMediaDetached(userId: string): SfuParticipantInfo | undefined {
    const peer = this.peers.get(userId);
    if (!peer || peer.mediaConnected === false) {
      return undefined;
    }
    peer.mediaConnected = false;
    return peer;
  }

  /** Removes the participant; returns their record (producers included). */
  remove(userId: string): SfuParticipantInfo | undefined {
    const peer = this.peers.get(userId);
    if (peer) {
      this.peers.delete(userId);
    }
    return peer;
  }

  get(userId: string): SfuParticipantInfo | undefined {
    return this.peers.get(userId);
  }

  /** Shallow copy of the registry; records are shared by reference. */
  snapshot(): Map<string, SfuParticipantInfo> {
    return new Map(this.peers);
  }

  /**
   * Finds the participant carrying this producer id, with the producer's
   * announcement info. Undefined when no participant announced it.
   */
  findProducer(producerId: string): { userId: string; info: ParticipantProducerInfo } | undefined {
    for (const [userId, peer] of this.peers) {
      const info = peer.producers.get(producerId);
      if (info) {
        return { userId, info };
      }
    }
    return undefined;
  }

  /** Drops every participant (session teardown and media reset). */
  clear(): void {
    this.peers.clear();
  }
}
