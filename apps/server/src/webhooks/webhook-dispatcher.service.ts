import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookQueue } from './webhook-queue';
import type { EgressOutputs } from '../egress/egress.types';

export type WebhookLeaveReason = 'leave' | 'kick' | 'disconnect' | 'room-end';

export type WebhookEventType =
  | 'room.started'
  | 'participant.joined'
  | 'participant.left'
  | 'room.ended'
  | 'egress.started'
  | 'egress.stopped'
  | 'egress.failed'
  | 'egress.recording_ready';

export interface WebhookParticipant {
  id: string;
  displayName: string;
  /** Token-carried consumer correlation fields; absent on non-token paths. */
  externalId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget webhook emission. Resolves the room's owning project and
 * enqueues a signed delivery only for project-owned rooms with a configured
 * webhook endpoint; user-owned rooms and unconfigured projects are silent.
 * Every entry point swallows its own errors so the signalling paths that call
 * it are never delayed or broken by webhook failures.
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WebhookQueue,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  roomStarted(roomId: string, roomSlug?: string): void {
    this.emit(roomId, roomSlug, 'room.started');
  }

  participantJoined(
    roomId: string,
    roomSlug: string | undefined,
    participant: WebhookParticipant,
  ): void {
    this.emit(roomId, roomSlug, 'participant.joined', { participant });
  }

  participantLeft(
    roomId: string,
    roomSlug: string | undefined,
    participant: WebhookParticipant,
    reason: WebhookLeaveReason,
  ): void {
    this.emit(roomId, roomSlug, 'participant.left', { participant, reason });
  }

  roomEnded(roomId: string, roomSlug?: string): void {
    this.emit(roomId, roomSlug, 'room.ended');
  }

  egressStarted(
    roomId: string,
    roomSlug: string | undefined,
    egressId: string,
    outputs: EgressOutputs,
  ): void {
    this.emit(roomId, roomSlug, 'egress.started', {
      egress: { id: egressId, outputs },
    });
  }

  egressStopped(
    roomId: string,
    roomSlug: string | undefined,
    egressId: string,
    outputs: EgressOutputs,
    reason: 'stopped' | 'room-ended',
  ): void {
    this.emit(roomId, roomSlug, 'egress.stopped', {
      egress: { id: egressId, outputs },
      reason,
    });
  }

  egressFailed(
    roomId: string,
    roomSlug: string | undefined,
    egressId: string,
    outputs: EgressOutputs,
    error: string,
  ): void {
    this.emit(roomId, roomSlug, 'egress.failed', {
      egress: { id: egressId, outputs },
      error,
    });
  }

  recordingReady(
    roomId: string,
    roomSlug: string | undefined,
    egressId: string,
    outputs: EgressOutputs,
    recordingUrl: string,
    recordingSizeBytes: number,
  ): void {
    this.emit(roomId, roomSlug, 'egress.recording_ready', {
      egress: { id: egressId, outputs },
      recordingUrl,
      recordingSizeBytes,
    });
  }

  private emit(
    roomId: string,
    roomSlug: string | undefined,
    type: WebhookEventType,
    extra: Record<string, unknown> = {},
  ): void {
    void this.enqueue(roomId, roomSlug, type, extra).catch((error) => {
      this.logger.error(
        `Failed to enqueue webhook ${type} for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async enqueue(
    roomId: string,
    roomSlug: string | undefined,
    type: WebhookEventType,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { slug: true, projectId: true },
    });
    if (!room?.projectId) return;

    const project = await this.prisma.project.findUnique({
      where: { id: room.projectId },
      select: { id: true, webhookUrl: true, webhookSecret: true },
    });
    if (!project?.webhookUrl || !project.webhookSecret) return;

    const body = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      data: {
        roomId,
        roomSlug: roomSlug ?? room.slug,
        ...extra,
      },
    });

    // The endpoint and secret are re-read before every attempt so removing
    // the webhook config (or rotating the secret) takes effect immediately,
    // including for deliveries already waiting in the retry chain.
    this.queue.enqueueDelivery(project.id, async () => {
      const config = await this.prisma.project.findUnique({
        where: { id: project.id },
        select: { webhookUrl: true, webhookSecret: true },
      });
      if (!config?.webhookUrl || !config.webhookSecret) return true;
      return this.delivery.deliver(
        config.webhookUrl,
        body,
        config.webhookSecret,
      );
    });
  }
}
