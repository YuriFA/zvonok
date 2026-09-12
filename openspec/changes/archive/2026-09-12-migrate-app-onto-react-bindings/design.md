## Context

`apps/client` joins rooms through a cookie-session identity path and keeps its
own join/publish layer over a `SfuManager` it constructs in
`SfuManagerProvider`; `@zvonok/react` constructs the same manager inside
`useZvonokConnection` and joins only with a room token. The manager already
supports both paths (`joinRoom({ roomId, roomSlug? })` without a token,
`produce(track, { isMobile })`), so the gap is a contract gap in the React
package, not a client-package gap. The app already consumes package leaves
(`RoomTracker`, `createHostControls`, `EMPTY_ROOM_STATE`), and the package
provider already owns a media manager (`createMediaManager()` in
`zvonok-context.tsx`) that the app duplicates with its own context.

Grilling decisions (2026-09-12, architecture review candidate A): full
migration onto the provider + hooks; token-optional cookie join in the
package; guest flow split (event/queue in the package, approve/deny HTTP in
the app); audio playout moved into the package as one deep hook (two real
consumers exist: the app's mixer and ZvonokRoom's hidden `<audio>` elements);
screen share moved into a package hook (same two-consumer situation);
auto-quality stays app-side; one atomic OpenSpec change; deleted layers take
their tests with them, new package paths get socket-level tests.

## Goals / Non-Goals

**Goals:**

- One ownership seam: `@zvonok/react` is the only consumer that orchestrates
  join/recovery; the app renders `ZvonokProvider` and consumes hooks.
- Cookie identity is a first-class package path (app-embedded consumers in
  the sdk spec already promise it; the hook must honor that promise).
- Remote-audio playout exists once, in the package, with per-participant
  volume and output routing; analysis reads the playout graph instead of a
  second sampling pipeline.
- App deletes its parallel layers with their tests; behavior of the room UI
  is unchanged.

**Non-Goals:**

- No auto-quality engine in the package (app-side policy; revisit on external
  demand).
- No HTTP guest approve/deny client in the package (owner cookie session is
  app domain; project-owned rooms have no guest flow).
- No changes to `@zvonok/client` public contract (manager already supports
  everything needed).
- No capture-UX redesign: `features/media` UI survives, only its context
  ownership collapses onto `session.mediaManager`.

## Decisions

- **Token-optional join in `useZvonokConnection`.** Options become
  `{ roomSlug?, roomId?, token? }` with at least one room identifier
  required; the hook builds `manager.joinRoom` payload accordingly. The raw
  `socket.on("sfu:room-locked")` subscription in the hook is the existing
  precedent for hook-level session state and stays; join result keeps using
  the ack waiter (join protocol stays single-owner: the hook, never the app).
  Alternative rejected: app keeps calling `manager.joinRoom` directly - that
  preserves the parallel orchestration the change exists to delete.
- **Playout as `useRemoteAudio`** wrapping the existing
  `@zvonok/client/audio/remote-audio-mixer` (playout graph, per-peer gain,
  `setSink`, per-peer analysers) plus level/active-speaker subscriptions fed
  from those analysers. ZvonokRoom drops its per-tile hidden `<audio>`
  elements and consumes the hook; per-tile muted badges read the same state.
  Alternative rejected: keeping the mixer app-side - that leaves the
  second playout implementation in ZvonokRoom and the analysis duplication.
- **`useScreenShare`** wraps `ScreenShareService` construction
  (`browserDisplayMediaService` default) and exposes
  `{ sharing, blocked, start, stop }`; ZvonokRoom replaces its inline
  `new ScreenShareService(...)` (ZvonokRoom.tsx:273) and the app its
  `use-screen-share`.
- **`useGuestJoinRequests`** wraps `manager.onGuestJoinRequest` and owns the
  pending-queue state; no HTTP. The app context keeps
  `roomApi.guestApprove/guestDeny` and passes removals into the hook.
- **Capture collapse.** `media-manager.context` is deleted; consumers read
  `useZvonokSession().mediaManager` / `useDeviceControls`. The app's device
  settings UI and capture-state UX stay; `useDeviceSwitching` is re-pointed
  at the shared manager.
- **Manager escape hatch stays documented.** Auto-quality
  (`peer-quality.context`) reads the session manager directly
  (`onQualityStats`, `setPreferredLayers`, `onParticipantLeft`); this is the
  one sanctioned bypass, named in the client spec.
- **Session additions.** `roomEnded` mirrors into session status with
  automatic `leaveRoom()` cleanup (today only `room.tsx` subscribes
  `onRoomEnded`); `isMobile` passes through `produceTrack(track, options)`.
- **Deletion with tests.** `use-mediasoup.test.ts`,
  `use-mediasoup-host.test.tsx`, toggle/room-audio tests die with their
  layers. New socket-level tests in `packages/react/src/__tests__/` follow
  the `manager.test.ts` pattern (fake socket emitting real event names):
  cookie join, id-or-slug payload, `roomEnded`, `isMobile` passthrough,
  playout (gain/levels/leave-cleanup), screen share (start/blocked/stop),
  guest queue. ZvonokRoom tests update to mock the new hooks.

## Risks / Trade-offs

- [Public package surface grows (three hooks + join options)] → Mitigated by
  candidate B (seam narrowing) scheduled next; this change only adds
  behavior the app needs, keeping exports explicit in `index.ts`.
- [Cookie join path is hard to unit-test without a real handshake] → Tests
  assert the payload and identity handling at the hook boundary with the
  fake socket; handshake credential verification stays covered by server
  e2e (`sfu-identity`).
- [ZvonokRoom playout refactor touches its tile rendering] → Visual check of
  ZvonokRoom in the existing component tests plus manual run; audio behavior
  (audible remote audio) is covered by a hook-level test, tile code only
  wires state.
- [Two room-entry identifiers (id/slug) widen the hook options] → Required
  by the app's pre-join flow (rooms known by id before slug resolution);
  validated "at least one of" in the hook with a typed error.

## Migration Plan

Single atomic cutover in one branch: package hooks and join contract first
(with new tests green), then app provider switch and deletions in the same
change, ZvonokRoom refactor included. Rollback is reverting the branch; no
data or wire-protocol changes. npm release is deferred until candidate B
narrows the seam (workspace consumes sources directly).

## Open Questions

(none)
