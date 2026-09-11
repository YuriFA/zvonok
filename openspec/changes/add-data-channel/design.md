# Design: add-data-channel

## Decisions

1. **Ephemeral first.** No persistence, no replay, no late-joiner backfill.
   The vendor-persisted variant is a queue with retention and replay
   semantics - a separate future proposal if a use case demands it. The
   relay is a fire-and-forget `socket.to(room).emit` after validation, like
   the existing egress status broadcast.
2. **Ack-based, like every 0.3.0 mutation.** `sfu:broadcast` answers on the
   requesting socket: `{ok: true}` or `{ok: false, code}` with
   `MISSING_CAPABILITY | PAYLOAD_TOO_LARGE | INVALID_TOPIC`. No denial
   broadcast events. The SDK promise settles on the ack
   (10s default timeout, per-call override - the wave's established
   pattern).
3. **Size measured on the wire.** Cap = `Buffer.byteLength(JSON.stringify(payload))`
   server-side <= 8192. JSON-only envelope: the relay carries the payload
   verbatim inside the event; no binary transport in this change.
4. **Capability, not role, at the handler.** The gateway checks
   `peer.capabilities.includes("send-data-message")`, exactly like produce
   guards. `capabilities.ts` adds the id to the vocabulary and to the
   `host`/`participant` bundles; `viewer` gets it nowhere.
5. **Topic is a contract, not config.** Fixed charset `[A-Za-z0-9._-]`,
   1-64 chars. Topics are not created or declared - filtering happens
   client-side in the receive hook; the server relay is unfiltered to the
   room (minus the sender).
6. **No echo to sender.** Matches both vendors' PubSub semantics for
   send-to-others; a sender needing local echo applies it in their own UI.
