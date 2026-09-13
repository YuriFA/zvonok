/**
 * SFU stats collector.
 * Collects and reports quality statistics for consumers.
 */

import type { Consumer, Transport } from "mediasoup-client/types";

import { createLogger } from "../helpers/logger.js";
import { calculateQualityScore } from "./quality-score.js";
import type { QualityStatsCallback, PeerQualityStats, QualityStats } from "./types.js";

/**
 * Collects quality statistics for SFU consumers.
 */
export class SfuStatsCollector {
  private readonly log = createLogger("stats");
  private interval: ReturnType<typeof setInterval> | null = null;
  private callbacks = new Set<QualityStatsCallback>();
  private getRecvTransport: () => Transport | null;
  private getConsumers: () => Iterable<[string, Consumer]>;
  private getPeerForProducer: (producerId: string) => string | undefined;

  constructor(
    getRecvTransport: () => Transport | null,
    getConsumers: () => Iterable<[string, Consumer]>,
    getPeerForProducer: (producerId: string) => string | undefined,
  ) {
    this.getRecvTransport = getRecvTransport;
    this.getConsumers = getConsumers;
    this.getPeerForProducer = getPeerForProducer;
  }

  /**
   * Start collecting stats at the specified interval.
   */
  start(intervalMs = 2000): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.collect(), intervalMs);
  }

  /**
   * Stop collecting stats.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Subscribe to quality stats updates.
   */
  onStats(callback: QualityStatsCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private async collect(): Promise<void> {
    const recvTransport = this.getRecvTransport();
    if (!recvTransport) return;

    const statsMap = new Map<string, PeerQualityStats>();

    for (const [, consumer] of this.getConsumers()) {
      try {
        const stats = await this.getConsumerStats(recvTransport, consumer);
        if (!stats) continue;

        const userId = this.getPeerForProducer(consumer.producerId);
        if (!userId) continue;

        // Merge stats for the same user (video + audio)
        const existing = statsMap.get(userId);
        if (existing) {
          // Prefer video stats for quality display, merge with existing
          if (consumer.kind === "video") {
            existing.stats = {
              ...existing.stats,
              bitrate: stats.bitrate || existing.stats.bitrate,
              width: stats.width || existing.stats.width,
              height: stats.height || existing.stats.height,
              fps: stats.fps || existing.stats.fps,
              rtt: stats.rtt || existing.stats.rtt,
              packetLoss: stats.packetLoss || existing.stats.packetLoss,
              jitter: stats.jitter || existing.stats.jitter,
            };
            existing.score = calculateQualityScore(existing.stats);
          }
        } else {
          const score = calculateQualityScore(stats);
          statsMap.set(userId, { userId, stats, score });
        }
      } catch (error) {
        this.log.error("Failed to get stats for consumer:", error);
      }
    }

    if (statsMap.size > 0) {
      this.callbacks.forEach((cb) => cb(statsMap));
    }
  }

  private async getConsumerStats(
    transport: Transport,
    consumer: Consumer,
  ): Promise<QualityStats | null> {
    try {
      const transportStats = await transport.getStats();
      let rtt = 0;
      let packetLoss = 0;

      for (const stat of transportStats.values()) {
        if (stat.type === "candidate-pair" && stat.state === "succeeded") {
          rtt = stat.currentRoundTripTime ? stat.currentRoundTripTime * 1000 : 0;
          if (stat.packetsReceived !== undefined && stat.packetsLost !== undefined) {
            const total = stat.packetsReceived + stat.packetsLost;
            packetLoss = total > 0 ? (stat.packetsLost / total) * 100 : 0;
          }
          break;
        }
      }

      // Get video-specific stats if available
      let bitrate = 0;
      let width = 0;
      let height = 0;
      let fps = 0;
      let jitter = 0;

      if (consumer.kind === "video") {
        const consumerStats = await consumer.getStats();
        for (const stat of consumerStats.values()) {
          if (stat.type === "inbound-rtp" && stat.kind === "video") {
            bitrate = stat.bitrate ? stat.bitrate / 1000 : 0; // Convert to kbps
            width = stat.frameWidth || 0;
            height = stat.frameHeight || 0;
            fps = stat.framesPerSecond || 0;
            jitter = (stat.jitter ?? 0) * 1000; // seconds → ms
            break;
          }
        }
      } else {
        // For audio, just get bitrate and jitter
        const consumerStats = await consumer.getStats();
        for (const stat of consumerStats.values()) {
          if (stat.type === "inbound-rtp" && stat.kind === "audio") {
            bitrate = stat.bitrate ? stat.bitrate / 1000 : 0;
            jitter = (stat.jitter ?? 0) * 1000; // seconds → ms
            break;
          }
        }
      }

      return { bitrate, packetLoss, rtt, jitter, width, height, fps };
    } catch (error) {
      this.log.error("Error getting consumer stats:", error);
      return null;
    }
  }
}
