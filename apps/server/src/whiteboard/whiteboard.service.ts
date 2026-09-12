import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { ROOM_PRESENCE } from 'src/sfu/room-presence.port';
import type { RoomPresence } from 'src/sfu/room-presence.port';

import {
  WHITEBOARD_UPDATE_MAX_BYTES,
  WhiteboardDrawMode,
} from './whiteboard.types';

export type ApplyUpdateResult = 'applied' | 'too-large' | 'invalid';

interface BoardState {
  doc: Y.Doc;
  mode: WhiteboardDrawMode;
  unsubscribeRoomClosed: () => void;
}

/**
 * In-memory whiteboard state per room: the authoritative Yjs document plus
 * the host draw-lock mode. Clients send incremental Yjs updates, the server
 * merges them and relays them to the room, and late joiners receive the full
 * encoded state. Boards are intentionally not persisted; a server restart
 * blanks them.
 */
@Injectable()
export class WhiteboardService {
  private readonly logger = new Logger(WhiteboardService.name);
  private readonly boards = new Map<string, BoardState>();

  constructor(@Inject(ROOM_PRESENCE) private readonly presence: RoomPresence) {}

  /** The room document and mode; a board that never drew starts blank. */
  getBoard(roomId: string): { doc: Y.Doc; mode: WhiteboardDrawMode } {
    const state = this.boards.get(roomId);
    if (state) return { doc: state.doc, mode: state.mode };
    return { doc: new Y.Doc(), mode: 'owner' };
  }

  /**
   * Merge a participant's update into the room document. Returns null-worthy
   * results without touching the document: oversized updates are refused,
   * not truncated, and undecodable payloads leave the board untouched.
   */
  applyUpdate(roomId: string, update: Uint8Array): ApplyUpdateResult {
    if (update.byteLength > WHITEBOARD_UPDATE_MAX_BYTES) return 'too-large';
    const state = this.boards.get(roomId) ?? this.createBoard(roomId);
    try {
      Y.applyUpdate(state.doc, update);
      return 'applied';
    } catch {
      return 'invalid';
    }
  }

  setMode(roomId: string, mode: WhiteboardDrawMode): WhiteboardDrawMode {
    const state = this.boards.get(roomId) ?? this.createBoard(roomId);
    state.mode = mode;
    return state.mode;
  }

  dropBoard(roomId: string): void {
    const state = this.boards.get(roomId);
    if (!state) return;
    state.unsubscribeRoomClosed();
    state.doc.destroy();
    this.boards.delete(roomId);
    this.logger.log(`Whiteboard dropped for room ${roomId}`);
  }

  dropAll(): void {
    for (const [roomId] of this.boards) this.dropBoard(roomId);
  }

  private createBoard(roomId: string): BoardState {
    const state: BoardState = {
      doc: new Y.Doc(),
      mode: 'owner',
      unsubscribeRoomClosed: this.presence.onRoomClosed(roomId, () => {
        this.dropBoard(roomId);
      }),
    };
    this.boards.set(roomId, state);
    return state;
  }
}
