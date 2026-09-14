jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Socket } from 'socket.io';
import { RoomPresenceService } from './room-presence.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.service';
import { RoomTokenHelper } from '../platform/room-token.helper';
import { capabilitiesForRole } from './capabilities';
import type { TestingModule } from '@nestjs/testing';

/**
 * Room Presence tested through its port with plain fake sockets: no
 * WorkerManager, no mediasoup - admission, grace, kick terminality and lock
 * need none of it.
 */
describe('RoomPresenceService', () => {
  let service: RoomPresenceService;
  let roomTokenHelper: { verify: jest.Mock };
  let jwtService: { verify: jest.Mock };
  let prisma: {
    apiKey: { findUnique: jest.Mock };
    room: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let webhooks: {
    roomStarted: jest.Mock;
    participantJoined: jest.Mock;
    participantLeft: jest.Mock;
    roomEnded: jest.Mock;
  };

  const makeSocket = (
    id: string,
    opts: { token?: string; cookie?: string } = {},
  ) =>
    ({
      id,
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      handshake: {
        auth: opts.token ? { token: opts.token } : {},
        headers: opts.cookie ? { cookie: opts.cookie } : {},
      },
    }) as unknown as Socket;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomPresenceService,
        { provide: RoomTokenHelper, useValue: { verify: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: WebhookDispatcher, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = module.get(RoomPresenceService);
    roomTokenHelper = module.get(RoomTokenHelper);
    jwtService = module.get(JwtService);
    prisma = module.get(PrismaService);
    webhooks = module.get(WebhookDispatcher);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh room lifetime per test: clear every presence map and timer.
    service.onModuleDestroy();
    roomTokenHelper.verify = jest.fn();
    jwtService.verify = jest.fn();
    prisma.apiKey = { findUnique: jest.fn() };
    prisma.room = { findUnique: jest.fn() };
    prisma.user = { findUnique: jest.fn() };
    webhooks.roomStarted = jest.fn();
    webhooks.participantJoined = jest.fn();
    webhooks.participantLeft = jest.fn();
    webhooks.roomEnded = jest.fn();
    // Default DB world: room-1 owned by user-1 (alice).
    prisma.room.findUnique.mockResolvedValue({
      slug: 'abc123',
      ownerId: 'user-1',
    });
    prisma.user.findUnique.mockResolvedValue({ username: 'alice' });
  });

  describe('admission', () => {
    it('admits a room-token join from verified claims only', async () => {
      roomTokenHelper.verify.mockReturnValue({
        ok: true,
        claims: {
          roomId: 'room-1',
          keyId: 'key-1',
          participantId: 'participant-1',
          name: 'Alice',
          role: 'participant',
        },
      });
      prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

      const socket = makeSocket('socket-1');
      const outcome = await service.join(socket, {
        roomId: 'room-1',
        token: 'signed-token',
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          roomId: 'room-1',
          userId: 'participant-1',
          username: 'Alice',
          capabilities: capabilitiesForRole('participant'),
          restoredSeat: false,
        }),
      );
      expect(webhooks.roomStarted).toHaveBeenCalledWith('room-1', undefined);
      expect(webhooks.participantJoined).toHaveBeenCalledWith(
        'room-1',
        undefined,
        { id: 'participant-1', displayName: 'Alice' },
      );
    });

    it('rejects a token minted for another room', async () => {
      roomTokenHelper.verify.mockReturnValue({
        ok: true,
        claims: { roomId: 'room-2', keyId: 'key-1', participantId: 'p1' },
      });

      const socket = makeSocket('socket-1');
      const outcome = await service.join(socket, {
        roomId: 'room-1',
        token: 'signed-token',
      });

      expect(outcome).toBeNull();
      expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
        code: 'ROOM_TOKEN_ROOM_MISMATCH',
        message: expect.any(String),
      });
    });

    it('derives a user join from the verified JWT, not payload fields', async () => {
      jwtService.verify.mockReturnValue({ id: 'user-2' });

      const socket = makeSocket('socket-1', { token: 'access-jwt' });
      const outcome = await service.join(socket, {
        roomId: 'room-1',
      });

      expect(outcome).toEqual(
        expect.objectContaining({
          userId: 'user-2',
          capabilities: capabilitiesForRole('participant'),
        }),
      );
      expect(outcome && 'ownsRoom' in outcome && outcome.ownsRoom).toBeFalsy();
    });

    it('marks the DB owner as host and anchors ownership in the room row', async () => {
      jwtService.verify.mockReturnValue({ id: 'user-1' });

      const socket = makeSocket('socket-1', { token: 'access-jwt' });
      const outcome = await service.join(socket, { roomId: 'room-1' });

      expect(outcome?.capabilities).toEqual(capabilitiesForRole('host'));
    });

    it('refuses a join whose guest cookie does not verify', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      const socket = makeSocket('socket-1', {
        cookie: 'zvonok_guest_abc123=guest-jwt',
      });
      const outcome = await service.join(socket, { roomId: 'room-1' });

      expect(outcome).toBeNull();
      expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
        code: 'SFU_JOIN_UNAUTHORIZED',
        message: expect.any(String),
      });
    });
  });

  describe('grace and kick terminality', () => {
    it('restores a held seat silently inside the grace window', async () => {
      jwtService.verify.mockReturnValue({ id: 'user-2' });
      const socket = makeSocket('socket-1', { token: 'access-jwt' });
      await service.join(socket, { roomId: 'room-1' });

      service.rejoinGraceMs = 10;
      service.holdSeat('socket-1');
      expect(service.contextOf('socket-1')).toBeNull();

      const rejoiner = makeSocket('socket-2', { token: 'access-jwt' });
      const outcome = await service.join(rejoiner, { roomId: 'room-1' });

      expect(outcome).toEqual(
        expect.objectContaining({ userId: 'user-2', restoredSeat: true }),
      );
      // The first arrival fired it once; the silent restore adds nothing.
      expect(webhooks.participantJoined).toHaveBeenCalledTimes(1);
    });

    it('announces the departure and fires the disconnect webhook on expiry', async () => {
      service.rejoinGraceMs = 10;
      jwtService.verify.mockReturnValue({ id: 'user-2' });
      const socket = makeSocket('socket-1', { token: 'access-jwt' });
      const other = makeSocket('socket-2', { token: 'other-jwt' });
      jwtService.verify.mockReturnValueOnce({ id: 'user-3' });
      await service.join(socket, { roomId: 'room-1' });
      await service.join(other, { roomId: 'room-1' });

      const detached: string[] = [];
      service.onPeerDetach('socket-1', () => detached.push('socket-1'));
      service.holdSeat('socket-1');
      expect(detached).toEqual(['socket-1']);

      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(webhooks.participantLeft).toHaveBeenCalledWith(
        'room-1',
        undefined,
        expect.objectContaining({ id: 'user-3' }),
        'disconnect',
      );
      expect(service.contextOf('socket-1')).toBeNull();
    });

    it('makes kicks terminal for the room lifetime', async () => {
      jwtService.verify.mockReturnValue({ id: 'user-1' });
      const owner = makeSocket('socket-owner', { token: 'host-jwt' });
      jwtService.verify.mockReturnValueOnce({ id: 'user-1' });
      await service.join(owner, { roomId: 'room-1' });
      jwtService.verify.mockReturnValue({ id: 'user-2' });
      const target = makeSocket('socket-target', { token: 'target-jwt' });
      await service.join(target, { roomId: 'room-1' });

      const ack = await service.kick('socket-owner', 'user-2');
      expect(ack).toEqual({ ok: true });
      expect(target.emit).toHaveBeenCalledWith('sfu:kicked', {
        roomId: 'room-1',
      });
      expect(target.disconnect).toHaveBeenCalled();

      const rejoiner = makeSocket('socket-target-2', { token: 'target-jwt' });
      const outcome = await service.join(rejoiner, { roomId: 'room-1' });
      expect(outcome).toBeNull();
      expect(rejoiner.emit).toHaveBeenCalledWith('sfu:join-error', {
        code: 'KICKED_FROM_ROOM',
        message: expect.any(String),
      });
    });
  });

  describe('lock and room lifetime', () => {
    const joinHost = async () => {
      jwtService.verify.mockReturnValueOnce({ id: 'user-1' });
      const socket = makeSocket('socket-owner', { token: 'host-jwt' });
      await service.join(socket, { roomId: 'room-1' });
      return socket;
    };

    it('locks against new joins and broadcasts once per change', async () => {
      await joinHost();
      jwtService.verify.mockReturnValue({ id: 'user-2' });
      const participant = makeSocket('socket-2', { token: 'p-jwt' });
      await service.join(participant, { roomId: 'room-1' });

      expect(await service.lockRoom('socket-owner', true)).toEqual({
        ok: true,
      });
      expect(participant.emit).toHaveBeenCalledWith('sfu:room-locked', {
        locked: true,
      });

      const latecomer = makeSocket('socket-3', { token: 'late-jwt' });
      expect(await service.join(latecomer, { roomId: 'room-1' })).toBeNull();
      expect(latecomer.emit).toHaveBeenCalledWith('sfu:join-error', {
        code: 'ROOM_LOCKED',
        message: expect.any(String),
      });

      expect(await service.lockRoom('socket-owner', true)).toEqual({
        ok: true,
      });
      await service.endRoom('room-1');
      expect(service.contextOf('socket-3')).toBeNull();

      // A recreated room is a fresh lifetime: joinable again.
      jwtService.verify.mockReturnValue({ id: 'user-4' });
      const fresh = makeSocket('socket-4', { token: 'fresh-jwt' });
      expect(await service.join(fresh, { roomId: 'room-1' })).not.toBeNull();
    });

    it('ends the room: announces once per peer, then room.ended', async () => {
      const owner = await joinHost();
      jwtService.verify.mockReturnValue({ id: 'user-2' });
      const participant = makeSocket('socket-2', { token: 'p-jwt' });
      await service.join(participant, { roomId: 'room-1' });

      await service.endRoom('room-1');

      expect(owner.emit).toHaveBeenCalledWith('sfu:room-ended', {
        roomId: 'room-1',
      });
      expect(participant.emit).toHaveBeenCalledWith('sfu:room-ended', {
        roomId: 'room-1',
      });
      expect(webhooks.participantLeft).toHaveBeenCalledTimes(2);
      expect(webhooks.roomEnded).toHaveBeenCalledWith('room-1', undefined);
      expect(service.contextOf('socket-owner')).toBeNull();
    });

    it('fires room-closed once while membership is still resolvable', async () => {
      await joinHost();
      const sizes: number[] = [];
      service.onRoomClosed('room-1', () => {
        sizes.push(service.listPeerSockets('room-1').length);
      });

      await service.leave('socket-owner', 'leave');
      await service.endRoom('room-1');

      // Natural-empty fires it exactly once: the departing member is already
      // gone from the set, but the room row still exists (not yet deleted),
      // so subscribers resolve the room. The later endRoom is a no-op.
      expect(sizes).toEqual([0]);
    });
  });
});
