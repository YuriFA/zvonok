## Why

The room composition layer is still duplicated: `apps/client` owns the full
product room UI (control bars, participants panel with host actions, device
switcher, lock/kicked cards) while the prebuilt `ZvonokEmbeddedRoom` - the
surface external consumers get - has none of it. The embedded room is also
still composed from pre-`useZvonokCall` hooks, so it silently lacks host-mute
enforcement, kick handling, and lock state that the app gained in
add-use-zvonok-call. This is the drift the 2026-09-15 owner rule ("packages
are the single source of functionality, the app must fully consume them
without duplication") exists to prevent: every app feature must today be
re-implemented by hand for embedders or not exist for them at all.

## What Changes

- New prebuilt room composition blocks in `packages/react`, preset-styled
  via the existing `./css/*` + `--zk-*` contract, behavior single-sourced
  over `useZvonokCall` and the existing hooks:
  - `ControlBar`: mic/camera (derived control states incl. host-mute
    override), screen share, leave; slot-based so the app injects its own
    buttons (recording, panels).
  - `ParticipantsPanel`: roster with host actions (mute all, lock, mute/kick
    per participant) gated by server capabilities, guest-request section via
    props, connection/quality indicators.
  - `DeviceSwitcher`: camera/mic/speaker selection, permission states,
    persisted preferences (over `useDeviceControls`).
  - `RoomStatusBar` / status cards: room-locked banner, kicked and
    call-ended cards, join-error card.
  - `ScreenShareSpotlight` and grid composition that places tiles from the
    layout derivation (extracted from the embedded room internals).
- `ZvonokEmbeddedRoom` rebuilt as a thin composition of `useZvonokCall` +
  these blocks; it gains host controls, device switching, and lock/kicked
  handling as prebuilt behavior instead of growing its own.
- `apps/client` room UI cut over to the same blocks for behavior, keeping
  its own markup via component props (no Tailwind/preset change); app-local
  duplicates of that behavior are deleted.
- Chat, guest-request policy, whiteboard panels, and local recording stay
  app domains and appear in the package only as props/slots.
- **BREAKING**: `ZvonokEmbeddedRoom` props change (new `hostControls`,
  `deviceSwitcher` toggles; `RoomSurface` internals become public blocks);
  nothing else in the package surface changes.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sdk`: new requirement "Prebuilt room composition blocks" (single-sourced
  room UI behavior with preset and consumer-markup variants); "Prebuilt room
  component" extended to compose them over the call-session hook with host
  controls, device switching, and lock/kicked handling.

## Impact

- `packages/react/src/embedded/`: rebuilt on `useZvonokCall`; internals
  (`RoomSurface`, `EmbeddedTile`, prejoin/error cards) extracted into public
  preset blocks under `packages/react/src/prebuilt/`.
- `packages/react/src/index.ts`: new exports; css subpath exports extended
  if new stylesheets are needed.
- `apps/client/src/features/room/`: controls, panels, alerts, spotlight cut
  over to package blocks; app-local duplicates removed; tests move to
  package interface tests where behavior leaves the app.
- `packages/react/__tests__/`: new tests at each block's interface;
  embedded room tests extended for host controls and kicked/lock paths.
- No server, `@zvonok/client`, or REST/WebSocket contract changes.
