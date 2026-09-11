# Tasks: add-list-pagination

## 1. Shared pagination helper

- [x] 1.1 Create `apps/server/src/platform/pagination.helper.ts`: `encodeCursor`, `decodeCursor` (BadRequest on malformed), limit validation (1-100, default 50), and the Prisma tuple predicate builder; unit tests (encode/decode round-trip, malformed cursor, limit bounds)

## 2. Endpoints

- [x] 2.1 `GET /v1/rooms`: `listQuery` DTO (`limit`, `cursor`), service `findMany` with tuple predicate + `take limit+1` to derive `next`; controller returns envelope; service spec coverage incl. multi-page walk and last-page `next: null`
- [x] 2.2 `GET /v1/rooms/:id/egress` and `GET /v1/recordings`: same migration (order keys `startedAt` and the recordings' existing order column); specs
- [x] 2.3 Developer console lists (projects, project rooms, project recordings): same envelope; specs
- [x] 2.4 e2e: platform e2e walks two pages of rooms with `limit=1` asserting exact coverage, `next: null` end, 400 on `limit=500` and on a garbage cursor

## 3. Consumers and docs

- [x] 3.1 `apps/client` developer console API + stores consume the envelope; tests updated
- [x] 3.2 `docs/api-reference.md`: envelope shape, query params, and a pagination walkthrough on all three list endpoints
- [x] 3.3 Verify: server tsc + unit + e2e suites green; apps/client tsc + vitest + oxlint + oxfmt green
