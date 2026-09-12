jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import * as Y from 'yjs';
import { Server } from 'socket.io';

import { WhiteboardGateway } from './whiteboard.gateway';
import { WhiteboardService } from './whiteboard.service';
import { RoomService } from 'src/room/room.service';
import type { RoomPresence } from 'src/sfu/room-presence.port';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RoomSocketIdentity } from 'src/auth/helpers/room-socket-auth.helper';
import type { WhiteboardDrawMode } from './whiteboard.types';

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  handshake: Record<string, unknown>;
  emitted: Array<{ event: string; payload: unknown }>;
  joinedRooms: string[];
  disconnected: boolean;
  join: jest.Mock;
  emit: jest.Mock;
  to: jest.Mock;
  disconnect: jest.Mock;
}

function makeSocket(): FakeSocket {
  const socket: FakeSocket = {
    id: 'socket-1',
    data: {},
    handshake: {},
    emitted: [],
    joinedRooms: [],
    disconnected: false,
    join: jest.fn(async (room: string) => socket.joinedRooms.push(room)),
    emit: jest.fn((event: string, payload: unknown) => {
      socket.emitted.push({ event, payload });
    }),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    disconnect: jest.fn(() => {
      socket.disconnected = true;
    }),
  };
  return socket;
}

function makeIdentity(
  type: 'user',
  overrides?: { userId?: string },
): RoomSocketIdentity;
function makeIdentity(
  type: 'guest',
  overrides?: { guestId?: string; roomSlug?: string; displayName?: string },
): RoomSocketIdentity;
function makeIdentity(
  type: 'user' | 'guest',
  overrides:
    | { userId?: string }
    | { guestId?: string; roomSlug?: string; displayName?: string } = {},
): RoomSocketIdentity {
  if (type === 'user') {
    return { type, userId: 'user-1', ...(overrides as { userId?: string }) };
  }
  return {
    type: 'guest',
    guestId: 'guest-1',
    roomSlug: 'room-slug',
    displayName: 'Guest',
    ...(overrides as {
      guestId?: string;
      roomSlug?: string;
      displayName?: string;
    }),
  };
}

describe('WhiteboardGateway', () => {
  let gateway: WhiteboardGateway;
  let client: FakeSocket;
  let jwtService: { verify: jest.Mock };
  let whiteboard: {
    getBoard: jest.Mock;
    applyUpdate: jest.Mock;
    setMode: jest.Mock;
  };
  let roomService: { findBySlug: jest.Mock };
  let sfu: { hasPeerInSlug: jest.Mock };
  let roomBroadcast: { to: jest.Mock; emit: jest.Mock };

  const activeRoom = {
    id: 'room-1',
    slug: 'room-slug',
    ownerId: 'user-1',
    status: 'active',
  };

  beforeEach(() => {
    whiteboard = {
      getBoard: jest.fn().mockReturnValue({ doc: new Y.Doc(), mode: 'owner' }),
      applyUpdate: jest.fn().mockReturnValue('applied'),
      setMode: jest.fn().mockReturnValue('open'),
    };
    roomService = { findBySlug: jest.fn().mockResolvedValue(activeRoom) };
    sfu = { hasPeerInSlug: jest.fn().mockReturnValue(true) };
    jwtService = { verify: jest.fn().mockReturnValue({ id: 'user-1' }) };
    roomBroadcast = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

    gateway = new WhiteboardGateway(
      whiteboard as unknown as WhiteboardService,
      roomService as unknown as RoomService,
      sfu as unknown as RoomPresence,
      jwtService as unknown as JwtService,
      { get: jest.fn() } as unknown as ConfigService,
    );
    gateway.server = roomBroadcast as unknown as Server;
    client = makeSocket();
  });

  describe('handleConnection', () => {
    it('stores the identity of a client with a valid token', () => {
      client.handshake = { headers: { cookie: 'access_token=good' } };
      gateway.handleConnection(client as never);
      expect(client.disconnected).toBe(false);
      expect(client.data.identity).toEqual({ type: 'user', userId: 'user-1' });
    });

    it('disconnects a client that fails authentication', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });
      client.handshake = { headers: { cookie: 'access_token=bad' } };
      gateway.handleConnection(client as never);
      expect(client.disconnected).toBe(true);
      expect(client.data.identity).toBeUndefined();
    });
  });

  describe('whiteboard:join', () => {
    it('admits a room peer, joins by room id, and sends the document state', async () => {
      client.data.identity = makeIdentity('user');
      await gateway.handleJoin(client as never, { roomSlug: 'room-slug' });

      expect(client.joinedRooms).toEqual(['room-1']);
      const joinState = client.emitted[0].payload as {
        roomSlug: string;
        update: Uint8Array;
      };
      expect(client.emitted[0].event).toBe('whiteboard:state');
      expect(joinState).toMatchObject({ roomSlug: 'room-slug' });
      expect(joinState.update).toBeInstanceOf(Uint8Array);
      expect(client.emitted[1]).toEqual({
        event: 'whiteboard:mode',
        payload: { roomSlug: 'room-slug', mode: 'owner' },
      });
      expect(client.data.admission).toEqual({
        roomId: 'room-1',
        roomSlug: 'room-slug',
        isOwner: true,
      });
    });

    it('marks a non-owner participant', async () => {
      client.data.identity = makeIdentity('user', { userId: 'user-2' });
      await gateway.handleJoin(client as never, { roomSlug: 'room-slug' });
      expect(client.data.admission).toMatchObject({ isOwner: false });
    });

    it('rejects a guest whose cookie is bound to another room', async () => {
      client.data.identity = makeIdentity('guest', { roomSlug: 'other-slug' });
      await gateway.handleJoin(client as never, { roomSlug: 'room-slug' });

      expect(client.joinedRooms).toEqual([]);
      expect(client.emitted[0].event).toBe('whiteboard:error');
      expect(client.data.admission).toBeUndefined();
    });

    it('rejects a registered user who is not an active room peer', async () => {
      sfu.hasPeerInSlug.mockReturnValue(false);
      client.data.identity = makeIdentity('user', { userId: 'user-2' });
      await gateway.handleJoin(client as never, { roomSlug: 'room-slug' });

      expect(client.joinedRooms).toEqual([]);
      expect(client.emitted[0].event).toBe('whiteboard:error');
    });

    it('rejects when the room is missing or ended', async () => {
      roomService.findBySlug.mockRejectedValue(new Error('Room not found'));
      client.data.identity = makeIdentity('user');
      await gateway.handleJoin(client as never, { roomSlug: 'gone' });

      expect(client.joinedRooms).toEqual([]);
      expect(client.emitted[0].event).toBe('whiteboard:error');

      roomService.findBySlug.mockResolvedValue({
        ...activeRoom,
        status: 'ended',
      });
      client.emitted.length = 0;
      await gateway.handleJoin(client as never, { roomSlug: 'room-slug' });
      expect(client.joinedRooms).toEqual([]);
      expect(client.emitted[0].event).toBe('whiteboard:error');
    });
  });

  describe('whiteboard:update', () => {
    function admit(isOwner: boolean): void {
      client.data.identity = makeIdentity('user');
      client.data.admission = {
        roomId: 'room-1',
        roomSlug: 'room-slug',
        isOwner,
      };
    }

    function makeUpdate(): Uint8Array {
      const doc = new Y.Doc();
      doc.getMap('elements').set('el:1', { id: 'el:1' });
      return Y.encodeStateAsUpdate(doc);
    }

    it('merges and relays an owner update while drawing is owner-only, excluding the sender', async () => {
      admit(true);
      const update = makeUpdate();
      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update,
      });

      expect(whiteboard.applyUpdate).toHaveBeenCalledWith('room-1', update);
      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client.to('room-1').emit).toHaveBeenCalledWith(
        'whiteboard:update',
        {
          roomSlug: 'room-slug',
          update,
        },
      );
    });

    it('silently drops a locked non-owner update without merging', async () => {
      admit(false);
      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update: makeUpdate(),
      });

      expect(whiteboard.applyUpdate).not.toHaveBeenCalled();
      expect(client.to).not.toHaveBeenCalled();
    });

    it('relays a non-owner update when drawing is open', async () => {
      admit(false);
      whiteboard.getBoard.mockReturnValue({ doc: new Y.Doc(), mode: 'open' });
      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update: makeUpdate(),
      });

      expect(whiteboard.applyUpdate).toHaveBeenCalled();
      expect(client.to('room-1').emit).toHaveBeenCalled();
    });

    it('emits an error when the update is oversized', async () => {
      admit(true);
      whiteboard.applyUpdate.mockReturnValue('too-large');
      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update: makeUpdate(),
      });

      expect(client.emitted[0]).toEqual({
        event: 'whiteboard:error',
        payload: {
          event: 'whiteboard:update',
          message: 'Board update too large',
        },
      });
      expect(client.to).not.toHaveBeenCalled();
    });

    it('emits an error when the update does not decode', async () => {
      admit(true);
      whiteboard.applyUpdate.mockReturnValue('invalid');
      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update: makeUpdate(),
      });

      expect(client.emitted[0]).toEqual({
        event: 'whiteboard:error',
        payload: {
          event: 'whiteboard:update',
          message: 'Board update rejected',
        },
      });
      expect(client.to).not.toHaveBeenCalled();
    });

    it('drops updates without admission, with a foreign room slug, or non-binary payloads', async () => {
      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update: makeUpdate(),
      });
      expect(whiteboard.applyUpdate).not.toHaveBeenCalled();

      admit(true);
      await gateway.handleUpdate(client as never, {
        roomSlug: 'other-slug',
        update: makeUpdate(),
      });
      expect(whiteboard.applyUpdate).not.toHaveBeenCalled();

      await gateway.handleUpdate(client as never, {
        roomSlug: 'room-slug',
        update: 'not-binary' as unknown as Uint8Array,
      });
      expect(whiteboard.applyUpdate).not.toHaveBeenCalled();
    });
  });

  describe('whiteboard:mode', () => {
    function admitAs(userId: string): void {
      client.data.identity = makeIdentity('user', { userId });
      client.data.admission = {
        roomId: 'room-1',
        roomSlug: 'room-slug',
        isOwner: userId === 'user-1',
      };
    }

    it('lets the owner open drawing and broadcasts to the room', async () => {
      admitAs('user-1');
      await gateway.handleMode(client as never, {
        roomSlug: 'room-slug',
        mode: 'open',
      });

      expect(whiteboard.setMode).toHaveBeenCalledWith('room-1', 'open');
      expect(roomBroadcast.to).toHaveBeenCalledWith('room-1');
      expect(roomBroadcast.emit).toHaveBeenCalledWith('whiteboard:mode', {
        roomSlug: 'room-slug',
        mode: 'open',
      });
    });

    it('ignores a non-owner user', async () => {
      admitAs('user-2');
      await gateway.handleMode(client as never, {
        roomSlug: 'room-slug',
        mode: 'open',
      });
      expect(whiteboard.setMode).not.toHaveBeenCalled();
    });

    it('ignores a guest even when they pass an admission record', async () => {
      client.data.identity = makeIdentity('guest');
      client.data.admission = {
        roomId: 'room-1',
        roomSlug: 'room-slug',
        isOwner: true,
      };
      await gateway.handleMode(client as never, {
        roomSlug: 'room-slug',
        mode: 'open',
      });
      expect(whiteboard.setMode).not.toHaveBeenCalled();
    });

    it('re-verifies ownership against current room state', async () => {
      admitAs('user-1');
      roomService.findBySlug.mockResolvedValue({
        ...activeRoom,
        ownerId: 'user-9',
      });
      await gateway.handleMode(client as never, {
        roomSlug: 'room-slug',
        mode: 'open',
      });
      expect(whiteboard.setMode).not.toHaveBeenCalled();

      roomService.findBySlug.mockRejectedValue(new Error('Room not found'));
      await gateway.handleMode(client as never, {
        roomSlug: 'room-slug',
        mode: 'open',
      });
      expect(whiteboard.setMode).not.toHaveBeenCalled();
    });

    it('ignores invalid mode values', async () => {
      admitAs('user-1');
      await gateway.handleMode(client as never, {
        roomSlug: 'room-slug',
        mode: 'everyone' as WhiteboardDrawMode, // deliberate invalid value
      });
      expect(whiteboard.setMode).not.toHaveBeenCalled();
    });
  });
});
