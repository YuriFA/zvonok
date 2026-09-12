jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import * as Y from 'yjs';

import { WhiteboardService } from './whiteboard.service';
import type { RoomPresence } from 'src/sfu/room-presence.port';

function elementUpdate(id: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('elements').set(id, { id });
  return Y.encodeStateAsUpdate(doc);
}

describe('WhiteboardService', () => {
  let service: WhiteboardService;
  let roomClosedHandler: () => void;
  let unsubscribe: jest.Mock;
  const presence = {
    onRoomClosed: jest.fn((_roomId: string, handler: () => void) => {
      roomClosedHandler = handler;
      return unsubscribe;
    }),
  } as unknown as RoomPresence;

  beforeEach(() => {
    jest.clearAllMocks();
    unsubscribe = jest.fn();
    service = new WhiteboardService(presence);
  });

  describe('getBoard', () => {
    it('returns a blank owner-only board for unknown rooms without storing it', () => {
      const board = service.getBoard('room-1');
      expect(board.mode).toBe('owner');
      expect(board.doc.getMap('elements').size).toBe(0);
      expect(presence.onRoomClosed).not.toHaveBeenCalled();
    });
  });

  describe('applyUpdate', () => {
    it('merges an update into a lazily created board', () => {
      const result = service.applyUpdate('room-1', elementUpdate('el:1'));
      expect(result).toBe('applied');
      expect(
        service.getBoard('room-1').doc.getMap('elements').get('el:1'),
      ).toEqual({ id: 'el:1' });
      expect(presence.onRoomClosed).toHaveBeenCalledWith(
        'room-1',
        expect.any(Function),
      );
    });

    it('accumulates updates from different participants', () => {
      service.applyUpdate('room-1', elementUpdate('el:1'));
      service.applyUpdate('room-1', elementUpdate('el:2'));
      const elements = service.getBoard('room-1').doc.getMap('elements');
      expect(elements.size).toBe(2);
    });

    it('rejects oversized updates without creating a board', () => {
      const oversized = new Uint8Array(512 * 1024 + 1);
      expect(service.applyUpdate('room-1', oversized)).toBe('too-large');
      expect(presence.onRoomClosed).not.toHaveBeenCalled();
      expect(service.getBoard('room-1').doc.getMap('elements').size).toBe(0);
    });

    it('rejects undecodable frames without touching the document', () => {
      service.applyUpdate('room-1', elementUpdate('el:1'));
      expect(service.applyUpdate('room-1', new Uint8Array(0))).toBe('invalid');
      expect(
        service.getBoard('room-1').doc.getMap('elements').has('el:1'),
      ).toBe(true);
    });
  });

  describe('setMode', () => {
    it('defaults to owner-only and persists changes', () => {
      expect(service.getBoard('room-1').mode).toBe('owner');
      expect(service.setMode('room-1', 'open')).toBe('open');
      expect(service.getBoard('room-1').mode).toBe('open');
    });
  });

  describe('room teardown', () => {
    it('drops the board when the room closes', () => {
      service.applyUpdate('room-1', elementUpdate('el:1'));
      const dropped = service.getBoard('room-1').doc;
      roomClosedHandler();
      expect(service.getBoard('room-1').doc).not.toBe(dropped);
      expect(service.getBoard('room-1').doc.getMap('elements').size).toBe(0);
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('dropBoard unsubscribes and removes state', () => {
      service.applyUpdate('room-1', elementUpdate('el:1'));
      service.dropBoard('room-1');
      expect(unsubscribe).toHaveBeenCalled();
      expect(service.getBoard('room-1').doc.getMap('elements').size).toBe(0);
    });

    it('dropAll clears every board', () => {
      service.applyUpdate('room-1', elementUpdate('el:1'));
      service.applyUpdate('room-2', elementUpdate('el:2'));
      service.dropAll();
      expect(service.getBoard('room-1').doc.getMap('elements').size).toBe(0);
      expect(service.getBoard('room-2').doc.getMap('elements').size).toBe(0);
    });
  });
});
