## Why

The app - the platform's first consumer per ADR-0002 - bypasses `@zvonok/react`
entirely: it imports zero join/publish hooks and keeps its own join/publish
layer (`use-mediasoup`), duplicated toggle state machines (`use-room-sfu`), a
second audio stack (`room-audio.context` + store + `use-remote-audio`), its own
screen-share wiring, and its own media-manager context. Every SDK fix lands
twice (the reconnection wave touched both stacks), and remote-audio playout
exists in two implementations (the app's `RemoteAudioMixer` and ZvonokRoom's
hidden `<audio>` elements). This is candidate A of the 2026-09-12 architecture
review: make `@zvonok/react` the single bindings layer so the app dogfoods the
exact surface external developers get.

## What Changes

- `@zvonok/react` join contract: `token` becomes optional (the app's
  cookie-session identity path), the join payload accepts `roomId` and/or
  `roomSlug`, `produceTrack` accepts `{ isMobile }`, and the session surfaces
  `roomEnded` with automatic cleanup.
- New package hook `useRemoteAudio`: remote-audio playout as one deep module -
  per-peer audio elements with gain, output routing (`setSink`), and
  level/active-speaker subscriptions fed from the same analysers. Supersedes
  the app's `RemoteAudioMixer` wiring and ZvonokRoom's hidden `<audio>` tiles.
- New package hook `useScreenShare` wrapping `ScreenShareService`; both the
  app and ZvonokRoom consume it.
- New package hook `useGuestJoinRequests`: wraps the `sfu:guest-join-request`
  event and owns the request queue state only. Approve/deny stay app-side
  (HTTP with the owner's cookie session).
- App migration: the room page renders `ZvonokProvider` and consumes package
  hooks. Deleted: `use-mediasoup`, `SfuManagerProvider`, the toggle state
  machines in `use-room-sfu`, the room-audio stack, `use-screen-share`, the
  socket part of `guest-requests.context`, and `media-manager.context`
  (collapsed onto `session.mediaManager` + `useDeviceControls`).
- Stays app-side: the auto-quality engine (`peer-quality.context`), guest
  approve/deny HTTP + UI, device settings UX, the requesting-guest REST flow.
- Tests: `use-mediasoup*` and toggle-layer tests are deleted with their layer;
  new socket-level package tests (in the style of `manager.test.ts`) cover
  cookie join, `isMobile`, `roomEnded`, playout, screen share, and the guest
  request queue.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `sdk`: join contract (token-optional cookie path, `roomId`/`roomSlug`
  payload, `isMobile` produce option, `roomEnded` session state) and new
  public hooks: remote-audio playout, screen share, guest join requests.
- `client`: the app consumes `@zvonok/react` bindings for join, publish,
  playout, screen share, and guest requests; the framework-agnostic core and
  device management requirements are updated to name the shared SDK media
  manager instead of the app-local one.

## Impact

- `packages/react/src`: `use-zvonok-connection.ts` (token-optional join,
  `isMobile`, `roomEnded`), new `use-remote-audio.ts`, `use-screen-share.ts`,
  `use-guest-join-requests.ts`, `ZvonokRoom.tsx` refactor, `index.ts` exports.
- `packages/client/src`: no public contract change (the manager already
  supports tokenless join payloads and the `isMobile` produce option).
- `apps/client/src`: deletions above; `room.tsx` switches to `ZvonokProvider`;
  `guest-requests.context` keeps only HTTP actions; `peer-quality.context`,
  device settings UX unchanged.
- Tests: `apps/client` hook tests deleted with their layer; new socket-level
  tests in `packages/react/src/__tests__/`.
