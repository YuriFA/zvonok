# Design: add-client-egress-control

## Context

Egress sessions exist only behind `/v1` API-key auth; the recording
finalization moment is observable only by polling. Change A
(add-roles-and-capabilities) ships the `start-recording`/`start-broadcast`
capability ids and the socket acknowledgement pattern this change builds on.

## Goals / Non-Goals

Goals:
- In-call start/stop for record + HLS with capability gating.
- Egress state mirrored into SDK/hooks; prebuilt record button.
- Push notification of recording readiness.

Non-Goals:
- Client-specifiable RTMP endpoints (SSRF boundary; server-only via `/v1`).
- Egress for user-owned rooms (egress stays project-scoped).
- Client-initiated session inspection/detail views (REST keeps those).

## Decisions

### D1: Signalling events, not a browser REST path

The browser holds a room token, not the project API key, so `/v1` is
unreachable. `egress:start`/`egress:stop` ride the existing `/sfu` socket
and reuse change A's ack shape (`{ok, code?, message?}`). The handlers
delegate to the same egress service the REST controller uses - one session
machine, two front doors.

### D2: Per-output capability gating

`record` requires `start-recording`, `hls` requires `start-broadcast`;
requesting both requires both. This lets a future project grant
recording-without-broadcasting without contract changes. Denials are coded
authorization errors in the ack, consistent with host actions.

### D3: Room broadcast of session status

A single `egress:status` event to the room on every session transition
(started/live/stopped/ended/failed), carrying `{sessionId, outputs, status}`.
The SDK mirrors the latest status into manager state; `isRecording` and
`isLive` derive from it (session with record output and non-terminal status).
Consumers never parse raw signalling for this.

### D4: `egress.recording_ready` fires from the finalization path

The event is emitted where parts are consolidated into the final MP4 (the
same code that computes `recordingFinalizedAt`), not on session end - which
removes the stopped/ready race by construction. Failed sessions emit
nothing; their parts remain reachable through the recordings API as today.

### D5: Prebuilt gating uses server-delivered capabilities

The record button's visibility reads `useOwnCapabilities()` (change A); no
client-side role string checks. This keeps the component correct under any
future grant configuration.

## Risks / Trade-offs

- [Two front doors drift (REST vs signalling validation)] -> Shared service
  layer owns validation; controllers only adapt transport. Tests assert
  identical outcomes for equivalent requests.
- [Status broadcast fan-out on big rooms] -> One small event per transition,
  not per tick; acceptable for room sizes the product supports.
- [Client starts egress in a room the project never intended] -> Capability
  grants are the policy point; hosts without the capability simply cannot.

## Migration Plan

Additive after change A: new events, new hooks, new webhook type. No
existing contract changes beyond what A already breaks. Rollback: revert
release tag; sessions started via signalling are ordinary sessions.

## Open Questions

None.
