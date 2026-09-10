# Design: add-roles-and-capabilities

## Context

Today the room token carries `publish`/`admin` booleans, the sfu gateway
checks those flags (or room ownership) per event, and `@zvonok/react`
settles host actions on a 3-second denial window (`host-controls.ts`).
See proposal.md - Why. This change is A of the 0.3.0 wave; change C
(client egress) builds on the capability vocabulary introduced here.

## Goals / Non-Goals

Goals:
- One authorization vocabulary enforced server-side per action.
- Server-delivered capabilities on the client (no token decoding).
- Ack-settled host actions for all four controls.

Non-Goals:
- Configurable grants and custom roles (deferred until external consumers
  exist; the vocabulary is shaped so this becomes a mapping table).
- Call types with per-type settings (Stream's full model).
- Consent-based mute (VideoSDK model) - rejected in review; forced mute stays.
- Runtime per-participant grant/revoke mid-session (Stream's
  `updateUserPermissions`) - requires re-broadcast of capabilities; revisit
  with configurable grants.

## Decisions

### D1: Capabilities as a flat id list in the join ack

`capabilities: CapabilityId[]` in the `sfu:join` ack (Stream's
`own_capabilities` pattern). Alternative: a `{can: boolean}` object per
capability - rejected: object shape churns on every vocabulary addition,
while a list extends without touching consumers that don't read the new id.

### D2: Token carries the role id only; bundles resolve server-side at join

`role: 'host' | 'participant' | 'viewer'` is the only permission claim in
the token. A single server module maps role -> capability bundle:
- `viewer`: `[]`
- `participant`: `send-audio`, `send-video`, `send-screenshare`
- `host`: participant's three + `mute-users`, `remove-participants`,
  `lock-room`, `start-recording`, `start-broadcast`

Identity paths that don't use tokens: room owner -> host bundle,
registered users and approved guests -> participant bundle. Future
configurable grants replace this mapping with per-project configuration
without touching the token or the join ack contract.

### D3: Socket.io acknowledgements for host actions; `sfu:host-error` removed

All four events (`sfu:mute-peer`, `sfu:mute-all`, `sfu:lock-room`,
`sfu:kick-peer`) switch to `socket.emit(event, payload, ack)` where `ack`
receives `{ok: true}` or `{ok: false, code, message}`. The current
broadcast denial has a race with parallel actions (two in-flight mutes
cannot tell whose denial arrived) and makes "success" unobservable. The
broadcast event is removed, not deprecated - the wave is a coordinated
breaking release.

Client timeout: the SDK applies a socket.io ack timeout and rejects with a
typed `HOST_ACTION_TIMEOUT` error if the server never answers.

### D4: Kick acknowledgement ordering

The server sends the kick ack after the peer's transports/producers are torn
down and the room notified. This makes the resolved promise a useful
ordering guarantee for consumer UIs (e.g. navigating away after kick).

### D5: Produce guards per kind

`sfu:produce` checks `send-audio` / `send-video` by track kind and
`send-screenshare` for screen share (appData source). This replaces the
single `publish` flag check and is the enforcement point the old
"publish denial" scenario maps to.

### D6: Vocabulary ships `start-recording` / `start-broadcast` before use

Change C introduces client-initiated egress; its guards consume these ids.
Shipping them in the vocabulary now means change C adds no contract churn
to the join ack.

## Risks / Trade-offs

- [Breaking wave coordination: mint consumers and `sfu:host-error`
  listeners break] -> Single coordinated 0.3.0 release; the only current
  consumers are this monorepo's app and docs; migration rides the wave.
- [Capability list grows unbounded] -> Fixed vocabulary constant shared by
  server and `@zvonok/client` types; unknown ids ignored by old clients.
- [Ack timeout chosen too tight on slow links] -> Generous default
  (10s), configurable per action call.

## Migration Plan

1. Server ships role mint + capability guards + acks (all behind the same
   release; no dual-stack - the API has no external consumers).
2. `packages/client` + `packages/react` updated in the same release.
3. `apps/client` migrates: mint UI sends `role`, host-error listener
   removed, host UI gates on `useOwnCapabilities()`.
4. `docs/api-reference.md` + quickstart updated to `role`.
5. Rollback: revert the release tag; no persisted data references roles
   (tokens are short-lived and re-mintable).

## Open Questions

None.
