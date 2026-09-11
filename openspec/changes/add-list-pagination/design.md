# Design: add-list-pagination

## Decisions

1. **Cursor, not offset.** Pages keyed on the sort tuple survive concurrent
   inserts; offset pages skip or repeat rows. Stream's `next`-cursor model,
   not VideoSDK's `page`/`perPage`.
2. **Cursor = opaque base64 of `{ [orderKey], id }`.** Each list orders by
   its own column (`Room.createdAt`, `Egress.startedAt`, recording
   finalization timestamp) descending with id as tiebreaker. The cursor
   stores the last emitted item's tuple; the next page queries
   `tuple < cursor.tuple` lexicographically via Prisma `cursor`+`take` after
   validating the referenced row's existence is not required - instead the
   predicate form `OR: [{orderKey lt}, {orderKey eq, id lt}]` is used so
   deleted rows between pages do not strand the walk.
3. **One shared helper.** `apps/server/src/platform/pagination.helper.ts`:
   `encodeCursor(tuple)`, `decodeCursor(raw)` (throws BadRequest on
   malformed), `paginate(limit)` clamps. All six lists (three `/v1`, three
   developer) call it; no per-endpoint pagination logic.
4. **Envelope always, no compatibility mode.** `{ items, next }` on every
   list including single-page responses; `next: null` when done. A param-
   gated legacy bare-array mode would fork the contract permanently; the
   consumer count is small and 0.4.0 is the coordinated breaking release.
5. **Validation.** `limit` outside 1-100 and undecodable cursors are 400
   with the existing validation error shape - not empty pages, not 404, so
   consumer bugs surface loudly.
6. **Console follows.** The developer console endpoints and `apps/client`
   console code migrate to the envelope in the same change; no internal
   shim layer.
