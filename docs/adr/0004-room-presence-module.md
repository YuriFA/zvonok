# 0004. Room Presence as a named deep module

- Status: accepted
- Date: 2026-09-12
- Context: architecture review candidate C (sfu god-module split)

## Context

`SfuService` performed two roles without a seam between them: room presence
(participants, admission through the verified identity paths, kick
terminality, disconnect grace, room lock, room lifetime, webhooks) and media
lifecycle (transports, producers, consumers, routers, screen-share lock, the
RTP-tap port). Every module that needed "who is in the room" - egress,
platform, room, whiteboard, guest approval - reached into `SfuService`, and
every admission test had to drive the full join flow with a mocked
`WorkerManager`.

## Decision

Room Presence becomes a named deep module behind the `ROOM_PRESENCE` port
(`apps/server/src/sfu/room-presence.port.ts`), implemented by
`RoomPresenceService`.

- Presence owns: identity records, membership, owners, lock, slug registry,
  grace seats, kick terminality, participant/room webhooks, and the
  presence-shaped wire events (`sfu:peer-joined`, `sfu:peer-left`,
  `sfu:existing-peers`, `sfu:kicked`, `sfu:room-locked`, `sfu:room-ended`,
  `sfu:join-error`).
- `SfuService` keeps media only and depends on presence; it learns about
  departures through `onPeerDetach` (fired before the departure is
  announced) and about room death through `onRoomClosed` (fired while the
  room is still resolvable; the router closes on a microtask so other
  subscribers stop first).
- Presence is media-blind: no mediasoup types cross the seam, presence never
  imports the media layer, no reverse dependency can form.
- Consumers (`egress-signal.gateway`, `egress.service`, `platform.service`,
  `room.controller`, `whiteboard.*`, `sfu.gateway` owner lookup) depend on
  `ROOM_PRESENCE`, not on `SfuService`. The second adapter is the
  in-memory fake used by consumer tests and by
  `room-presence.service.spec.ts`, which covers admission, grace, kick and
  lock without any WorkerManager or sockets.
- The wire contract (`sfu:*` events, REST) is unchanged; the `/sfu` gateway
  stays pure delegation.

Rejected: host controls (mute/mute-all) inside presence - they act on
producers, i.e. media; a presence module owning producer teardown would
stop being media-blind. Direct presence-to-media calls were rejected over
subscriptions to avoid a dependency cycle.

## Consequences

- Admission, grace, kick and lock are testable through a small interface
  with plain fake sockets; the sfu spec no longer needs WorkerManager mocks
  to assert identity behavior.
- Cross-module presence questions have one named place to change; the
  former god-module surface shrinks to media lifecycle plus the tap port.
- Future capabilities named in the platform research (Stream-like runtime
  grant/revoke, REST participant readers) land in Room Presence, not in
  `SfuService`.
