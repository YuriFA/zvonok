import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/**
 * Sort position of a row inside a paginated list: the order-column value
 * (ISO string for date columns) plus the id tiebreaker. Ordering is always
 * `order DESC, id DESC`, so the tuple identifies one exact row.
 */
export interface PageCursor {
  order: string;
  id: string;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

/** Arguments handed to the underlying `prisma.<model>.findMany` call. */
export interface PageQuery {
  where: Record<string, unknown>;
  orderBy: Record<string, 'desc'>;
  take: number;
}

export interface PaginateOptions<T> {
  limit?: number;
  cursor?: string;
  /** Order column name, e.g. `createdAt` or `startedAt`. */
  orderKey: string;
  /** Equality scope merged with the cursor predicate, e.g. `{ projectId }`. */
  scope?: Record<string, unknown>;
  findPage: (query: PageQuery) => Promise<T[]>;
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isPageCursor(value: unknown): value is PageCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PageCursor).order === 'string' &&
    typeof (value as PageCursor).id === 'string' &&
    (value as PageCursor).id !== ''
  );
}

export function decodeCursor(raw: string): PageCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Malformed pagination cursor');
  }
  if (!isPageCursor(parsed)) {
    throw new BadRequestException('Malformed pagination cursor');
  }
  return { order: parsed.order, id: parsed.id };
}

/**
 * Predicate selecting the rows strictly after a cursor in
 * `order DESC, id DESC` order. A tuple comparison rather than Prisma's
 * `cursor` option: rows deleted between pages must not strand the walk.
 */
export function cursorPredicate(
  orderKey: string,
  cursor: PageCursor,
): Record<string, unknown> {
  return {
    OR: [
      { [orderKey]: { lt: cursor.order } },
      { [orderKey]: cursor.order, id: { lt: cursor.id } },
    ],
  };
}

function cursorValueOf(row: Record<string, unknown>, orderKey: string): string {
  const value = row[orderKey];
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Slice one page from a newest-first list and derive the continuation
 * cursor. Fetches `limit + 1` rows so `next` reflects a row that actually
 * exists - never a skipped position.
 */
export async function paginate<T extends object>(
  options: PaginateOptions<T>,
): Promise<Page<T>> {
  const { limit, cursor, orderKey, scope, findPage } = options;
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT)
  ) {
    throw new BadRequestException(
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
    );
  }
  const effectiveLimit = limit ?? DEFAULT_PAGE_LIMIT;
  const where = cursor
    ? { ...scope, ...cursorPredicate(orderKey, decodeCursor(cursor)) }
    : { ...scope };

  const rows = await findPage({
    where,
    orderBy: { [orderKey]: 'desc', id: 'desc' },
    take: effectiveLimit + 1,
  });

  const items =
    rows.length > effectiveLimit ? rows.slice(0, effectiveLimit) : rows;
  // Dynamic order-key read: rows arrive as model types without index signatures.
  const last = items[items.length - 1] as Record<string, unknown> | undefined;
  const next =
    rows.length > effectiveLimit && last
      ? encodeCursor({
          order: cursorValueOf(last, orderKey),
          id: String(last.id),
        })
      : null;
  return { items, next };
}
