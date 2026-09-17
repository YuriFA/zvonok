## 1. Package: block cores and preset components

- [x] 1.1 Media control core: `useMediaControls` behavior core over `useZvonokCall` controls (derived states, host-mute override, toggle outcomes) in `packages/react/src/prebuilt/`, interface tests
- [x] 1.2 Participants panel core: roster ordering, capability-gated host action handlers (mute all, lock, mute/kick), guest-request props, `onNotice` callback; interface tests
- [x] 1.3 Device switcher core: camera/mic/speaker selection, permission states, persisted preferences over `useDeviceControls`; interface tests
- [x] 1.4 Status cards core: lock banner state, kicked and ended states, join-error recovery states over `useZvonokCall` + connection state; interface tests
- [x] 1.5 Screen-share spotlight + grid composition extracted from embedded internals onto public layout derivation; interface tests
- [x] 1.6 Preset components for all blocks styled via `./css/*` + `--zk-*` tokens under `@zvonok/react/prebuilt` entry; smoke test for both entry graphs
- [x] 1.7 Public exports and docs comments; prop-driven block inputs pinned in tests

## 2. Embedded room rebuild

- [x] 2.1 Rebuild `EmbeddedRoomSurface` on `useZvonokCall`: delete hand-rolled publish-on-join, toggle-with-rollback, and notice state
- [x] 2.2 Compose preset blocks into embedded room: participants panel, device switcher, status cards, spotlight; add `hostControls`/`deviceSwitcher` props
- [x] 2.3 Extend embedded tests: kicked, locked, host-mute and host-action paths
- [x] 2.4 Delete superseded embedded internals (`RoomSurface` ad-hoc logic, duplicate tile plumbing) no longer referenced

## 3. App cutover

- [x] 3.1 `RoomLeftControls` re-rendered as app markup over media control core; delete app-side derived-state duplication
- [x] 3.2 Participants panel host-action wiring moved to panel core; `ParticipantItem`/app markup retained via props; delete app host-action handlers from `active-room-view.tsx`
- [x] 3.3 Spotlight/grid composition and lock/kicked status cards cut over; delete `ScreenShareSpotlight`/app card duplicates
- [x] 3.4 `room-session.context` slimmed to identity + notice callback wiring only; app tests updated or moved to package interface tests
- [x] 3.5 Grep gate: no app imports of `/prebuilt` preset components or superseded package internals

## 4. Verification

- [x] 4.1 Package + app test suites, typecheck, lint clean
- [x] 4.2 Local smoke: embedder-style page with `ZvonokEmbeddedRoom` alone (join, host actions from second browser, kick, device switch); app room regression pass
- [x] 4.3 `openspec validate` clean
