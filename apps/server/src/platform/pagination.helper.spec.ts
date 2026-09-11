import { BadRequestException } from '@nestjs/common';
import {
  MAX_PAGE_LIMIT,
  PageQuery,
  cursorPredicate,
  decodeCursor,
  encodeCursor,
  paginate,
} from './pagination.helper';

interface Row {
  id: string;
  createdAt: Date;
}

function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: `row-${String(count - i).padStart(2, '0')}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, count - i)),
    });
  }
  return rows;
}

function ltString(branch: unknown, key: string): string | undefined {
  if (typeof branch !== 'object' || branch === null || !(key in branch)) {
    return undefined;
  }
  const filter = (branch as Record<string, unknown>)[key];
  if (typeof filter !== 'object' || filter === null || !('lt' in filter)) {
    return undefined;
  }
  const lt = (filter as { lt: unknown }).lt;
  return typeof lt === 'string' ? lt : undefined;
}

/**
 * Fake `findMany` implementing the real predicate semantics the helper
 * relies on: filter by the cursor tuple, sort `order DESC, id DESC`, take.
 * Lets specs assert walk behavior, not Prisma call shapes.
 */
function fakeFindPage(rows: Row[]) {
  return jest.fn(async (query: PageQuery) => {
    const [orderKey] = Object.keys(query.orderBy);
    const branches = Array.isArray(query.where.OR)
      ? (query.where.OR as unknown[])
      : [];
    const orderLt = ltString(branches[0], orderKey);
    const idLt = ltString(branches[1], 'id');
    const matched = rows.filter((row) => {
      if (orderLt === undefined) {
        return true;
      }
      const order = row[orderKey as keyof Row] as Date;
      const orderIso = order.toISOString();
      return (
        orderIso < orderLt || (orderIso === orderLt && row.id < (idLt ?? ''))
      );
    });
    return matched.slice(0, query.take);
  });
}

describe('pagination.helper', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('round-trips a cursor tuple', () => {
      const cursor = { order: '2026-09-01T00:00:00.000Z', id: 'row-1' };
      expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    });

    it('produces url-safe opaque strings', () => {
      expect(encodeCursor({ order: 'x', id: 'y' })).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('rejects garbage input with 400', () => {
      expect(() => decodeCursor('%%%')).toThrow(BadRequestException);
    });

    it('rejects decodable but non-cursor payloads with 400', () => {
      const encoded = (payload: string) =>
        Buffer.from(payload).toString('base64url');
      expect(() => decodeCursor(encoded('{"order":1,"id":"x"}'))).toThrow(
        BadRequestException,
      );
      expect(() => decodeCursor(encoded('["order","id"]'))).toThrow(
        BadRequestException,
      );
      expect(() => decodeCursor(encoded('{"order":"x"}'))).toThrow(
        BadRequestException,
      );
      expect(() => decodeCursor(encoded('{"order":"x","id":""}'))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('cursorPredicate', () => {
    it('selects rows strictly after the tuple in order DESC, id DESC', () => {
      expect(cursorPredicate('createdAt', { order: 'b', id: 'm' })).toEqual({
        OR: [{ createdAt: { lt: 'b' } }, { createdAt: 'b', id: { lt: 'm' } }],
      });
    });
  });

  describe('paginate', () => {
    it('returns the first page and a continuation cursor', async () => {
      const rows = makeRows(3);
      const page = await paginate<Row>({
        limit: 2,
        orderKey: 'createdAt',
        findPage: fakeFindPage(rows),
      });
      expect(page.items).toEqual([rows[0], rows[1]]);
      expect(page.next).toBe(
        encodeCursor({
          order: rows[1].createdAt.toISOString(),
          id: rows[1].id,
        }),
      );
    });

    it('defaults to 50 per page and reports null at exhaustion', async () => {
      const rows = makeRows(2);
      const page = await paginate<Row>({
        orderKey: 'createdAt',
        findPage: fakeFindPage(rows),
      });
      expect(page.items).toEqual(rows);
      expect(page.next).toBeNull();
    });

    it('walks every row exactly once in newest-first order', async () => {
      const rows = makeRows(7);
      const findPage = fakeFindPage(rows);
      const seen: Row[] = [];
      let cursor: string | undefined;
      do {
        const page = await paginate<Row>({
          limit: 3,
          cursor,
          orderKey: 'createdAt',
          findPage,
        });
        seen.push(...page.items);
        cursor = page.next ?? undefined;
      } while (cursor);
      expect(seen).toEqual(rows);
    });

    it('does not skip or repeat when rows are inserted mid-walk', async () => {
      const rows = makeRows(5);
      const findPage = fakeFindPage(rows);
      const first = await paginate<Row>({
        limit: 2,
        orderKey: 'createdAt',
        findPage,
      });
      // A newer row lands after page one was served: the walk continues
      // from the cursor's position and never sees it again.
      const remaining = rows.slice(2);
      const inserted = {
        id: 'row-99',
        createdAt: new Date(Date.UTC(2026, 8, 2)),
      };
      rows.unshift(inserted);
      const rest: Row[] = [];
      let cursor = first.next ?? undefined;
      while (cursor) {
        const page = await paginate<Row>({
          limit: 2,
          cursor,
          orderKey: 'createdAt',
          findPage,
        });
        rest.push(...page.items);
        cursor = page.next ?? undefined;
      }
      expect(rest).toEqual(remaining);
      expect(rest).not.toContainEqual(inserted);
    });

    it('keeps walking past rows deleted between pages', async () => {
      const rows = makeRows(5);
      const findPage = fakeFindPage(rows);
      const first = await paginate<Row>({
        limit: 2,
        orderKey: 'createdAt',
        findPage,
      });
      // The row the cursor points at disappears; the predicate still
      // selects everything older than its tuple.
      rows.splice(2, 1);
      const second = await paginate<Row>({
        limit: 2,
        cursor: first.next ?? undefined,
        orderKey: 'createdAt',
        findPage,
      });
      expect(second.items).toEqual([rows[2], rows[3]]);
    });

    it('applies the scope filter to every page', async () => {
      const findPage = fakeFindPage(makeRows(2));
      await paginate<Row>({
        scope: { projectId: 'project-1' },
        orderKey: 'createdAt',
        findPage,
      });
      expect(findPage.mock.calls[0][0].where).toMatchObject({
        projectId: 'project-1',
      });
    });

    it('rejects limits outside 1..100 with 400', async () => {
      const findPage = fakeFindPage([]);
      await expect(
        paginate<Row>({ limit: 0, orderKey: 'createdAt', findPage }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        paginate<Row>({ limit: 101, orderKey: 'createdAt', findPage }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        paginate<Row>({
          limit: MAX_PAGE_LIMIT,
          orderKey: 'createdAt',
          findPage,
        }),
      ).resolves.toEqual({ items: [], next: null });
    });

    it('rejects a malformed cursor with 400 before querying', async () => {
      const findPage = fakeFindPage([]);
      await expect(
        paginate<Row>({
          cursor: Buffer.from('{"nope":true}').toString('base64url'),
          orderKey: 'createdAt',
          findPage,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(findPage).not.toHaveBeenCalled();
    });
  });
});
