jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { ConflictException } from '@nestjs/common';
import { EgressSignalGateway } from './egress-signal.gateway';
import type { CapabilityId } from '../sfu/capabilities';

describe('EgressSignalGateway', () => {
  let gateway: EgressSignalGateway;
  let presence: {
    contextOf: jest.Mock;
  };
  let egress: { start: jest.Mock; stop: jest.Mock };
  let prisma: {
    room: { findUnique: jest.Mock };
    egress: { findFirst: jest.Mock };
  };

  const HOST_CAPABILITIES: CapabilityId[] = [
    'send-audio',
    'send-video',
    'send-screenshare',
    'send-data-message',
    'mute-users',
    'remove-participants',
    'lock-room',
    'start-recording',
    'start-broadcast',
  ];
  const PARTICIPANT_CAPABILITIES: CapabilityId[] = [
    'send-audio',
    'send-video',
    'send-screenshare',
    'send-data-message',
  ];

  function socket(id = 'socket-1') {
    return { id } as never;
  }

  beforeEach(() => {
    presence = {
      contextOf: jest.fn().mockReturnValue({
        roomId: 'room-1',
        userId: 'host-1',
        capabilities: HOST_CAPABILITIES,
      }),
    };
    egress = {
      start: jest.fn().mockResolvedValue({ id: 'egress-1' }),
      stop: jest.fn().mockResolvedValue({ id: 'egress-1', status: 'ended' }),
    };
    prisma = {
      room: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: 'project-1',
          status: 'active',
        }),
      },
      egress: {
        findFirst: jest.fn().mockResolvedValue({ id: 'egress-1' }),
      },
    };
    gateway = new EgressSignalGateway(
      presence as never,
      egress as never,
      prisma as never,
    );
  });

  describe('egress:start', () => {
    it('starts a record-only session through the egress service', async () => {
      const ack = await gateway.handleStart(socket(), { record: true });

      expect(ack).toEqual({ ok: true });
      expect(egress.start).toHaveBeenCalledWith('project-1', 'room-1', {
        rtmpEndpoints: [],
        hls: false,
        record: true,
      });
    });

    it('starts an hls session with the broadcast capability', async () => {
      const ack = await gateway.handleStart(socket(), { hls: true });

      expect(ack).toEqual({ ok: true });
      expect(egress.start).toHaveBeenCalledWith('project-1', 'room-1', {
        rtmpEndpoints: [],
        hls: true,
        record: false,
      });
    });

    it('denies record without start-recording', async () => {
      presence.contextOf.mockReturnValue({
        roomId: 'room-1',
        userId: 'user-1',
        capabilities: PARTICIPANT_CAPABILITIES,
      });

      const ack = await gateway.handleStart(socket(), { record: true });

      expect(ack).toEqual({
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: 'Missing start-recording capability',
      });
      expect(egress.start).not.toHaveBeenCalled();
    });

    it('denies hls without start-broadcast', async () => {
      presence.contextOf.mockReturnValue({
        roomId: 'room-1',
        userId: 'user-1',
        capabilities: ['start-recording'],
      });

      const ack = await gateway.handleStart(socket(), { hls: true });

      expect(ack).toEqual({
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: 'Missing start-broadcast capability',
      });
    });

    it('denies a request with no outputs', async () => {
      const ack = await gateway.handleStart(socket(), {});

      expect(ack).toEqual({
        ok: false,
        code: 'INVALID_OUTPUTS',
        message: expect.any(String),
      });
      expect(egress.start).not.toHaveBeenCalled();
    });

    it('denies requests from sockets without a room', async () => {
      presence.contextOf.mockReturnValue(null);

      const ack = await gateway.handleStart(socket(), { record: true });

      expect(ack).toEqual({
        ok: false,
        code: 'NOT_IN_ROOM',
        message: expect.any(String),
      });
    });

    it('denies user-owned rooms', async () => {
      prisma.room.findUnique.mockResolvedValue({ projectId: null });

      const ack = await gateway.handleStart(socket(), { record: true });

      expect(ack).toEqual({
        ok: false,
        code: 'NOT_PROJECT_ROOM',
        message: expect.any(String),
      });
      expect(egress.start).not.toHaveBeenCalled();
    });

    it('surfaces an active session as a coded conflict', async () => {
      egress.start.mockRejectedValue(new ConflictException('active'));

      const ack = await gateway.handleStart(socket(), { record: true });

      expect(ack).toEqual({
        ok: false,
        code: 'ALREADY_ACTIVE',
        message: expect.any(String),
      });
    });

    it('never forwards client RTMP fields', async () => {
      await gateway.handleStart(socket(), {
        record: true,
        rtmpEndpoints: ['rtmp://evil.example/live'],
      } as never);
      expect(egress.start).toHaveBeenCalledWith('project-1', 'room-1', {
        rtmpEndpoints: [],
        hls: false,
        record: true,
      });
    });
  });

  describe('egress:stop', () => {
    it('stops the room active session', async () => {
      const ack = await gateway.handleStop(socket());

      expect(ack).toEqual({ ok: true });
      expect(egress.stop).toHaveBeenCalledWith('project-1', 'egress-1');
    });

    it('denies stop without any egress capability', async () => {
      presence.contextOf.mockReturnValue({
        roomId: 'room-1',
        userId: 'user-1',
        capabilities: PARTICIPANT_CAPABILITIES,
      });

      const ack = await gateway.handleStop(socket());

      expect(ack).toEqual({
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: expect.any(String),
      });
      expect(egress.stop).not.toHaveBeenCalled();
    });

    it('denies stop when no session is active', async () => {
      prisma.egress.findFirst.mockResolvedValue(null);

      const ack = await gateway.handleStop(socket());

      expect(ack).toEqual({
        ok: false,
        code: 'NOT_ACTIVE',
        message: expect.any(String),
      });
      expect(egress.stop).not.toHaveBeenCalled();
    });
  });
});
