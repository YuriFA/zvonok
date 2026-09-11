# Proposal: add-list-pagination

## Why

The platform gap audit (docs/research/platform-gap-audit.md, Gap 3) confirmed
every list surface is an unpaginated newest-first full scan: `/v1/rooms`,
`/v1/rooms/:id/egress`, `/v1/recordings`, and the developer console lists.
Payloads grow without bound as a project accumulates rooms and recordings -
every list consumer breaks silently. Both vendors paginate (VideoSDK
`page`/`perPage`; Stream cursor `next`). Cheap now, contract-breaking later.

This is change 3 of the coordinated 0.4.0 wave (1: active-speaker hooks →
2: participant metadata → 3: list pagination → 4: data channel →
5: SDK reconnection).

## What Changes

1. **Cursor pagination on every list (breaking)**. All list endpoints -
   `GET /v1/rooms`, `GET /v1/rooms/:id/egress`, `GET /v1/recordings`, and
   the developer console's project rooms, recordings, and projects lists -
   accept `limit` (default 50, max 100) and `cursor` (opaque) and return the
   envelope `{ items, next }` where `next` is the cursor for the following
   page or `null` when exhausted. Bare-array responses are gone; this rides
   the coordinated 0.4.0 release as a documented breaking change.
2. **Stable cursors.** A cursor encodes the sort tuple of the last emitted
   item (order column plus id, base64-encoded). Pages remain stable while
   new records are inserted, unlike offset pagination; `next` is derived
   from the last item actually returned, so it can never skip.
3. **Ordering unchanged.** Newest-first ordering per list is preserved
   exactly as today; pagination only slices it.
4. **Invalid input.** `limit` outside 1-100 is rejected with 400; an unknown
   or malformed cursor is rejected with 400, not an empty page.

## Capabilities

### Modified Capabilities

- `platform-api`: List rooms, egress list, and recordings list requirements
  move to the cursor envelope.
- `developer`: projects listing and media views move to the same envelope.

## Impact

- **apps/server**: shared cursor helper (encode/decode + Prisma cursor
  predicates), three `/v1` list services + controllers, developer service
  lists; unit + e2e coverage.
- **apps/client**: developer console API calls updated for the envelope.
- **Docs**: `docs/api-reference.md` list endpoints + envelope description.
- **Breaking**: response shape change for all list endpoints (0.4.0).
