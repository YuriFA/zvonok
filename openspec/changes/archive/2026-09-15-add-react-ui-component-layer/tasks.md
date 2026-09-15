## 1. Verification infrastructure

- [x] 1.1 Add Playwright project (config with `webServer` starting Vite, fixed viewport, deterministic fixtures: fake media tracks, masked video regions)
- [x] 1.2 Record pre-change visual baselines for room states: prejoin, grid variants (1/2/4/6 tiles), spotlight with screen share, controls, panels, kicked/muted-by-host alerts
- [x] 1.3 Add `pnpm` scripts wiring visual tests into the existing test entry points

## 2. Slice 1 - Device controls unification

- [x] 2.1 Extend `useDeviceControls`: persisted per-user selection, `devicechange` handling, permission state; package unit tests for each absorbed behavior
- [x] 2.2 Migrate apps/client media feature onto `useDeviceControls`; delete `use-media-devices`, `use-device-switching`, and app-side localStorage bookkeeping
- [x] 2.3 Verify: vitest suites green, visual baselines identical, `grep` audit shows no remaining imports of deleted modules

## 3. Slice 2 - Quality adaptation engine

- [x] 3.1 Upgrade the package quality hook: stats polling (desktop/mobile intervals), hidden-tab suspend, debounced `setPreferredLayers`; package unit tests
- [x] 3.2 Migrate apps/client onto the package hook; delete `PeerQualityStore`/`peer-quality.context`; point widget `RoomTile` at the same hook
- [x] 3.3 Verify: existing manual-quality scenarios still pass unchanged; baselines identical

## 4. Slice 3 - Tile core

- [x] 4.1 Build core `Tile`: participant media element binding, element-visibility tracking, `*UI` component-typed props with default visuals, context data hook; package tests
- [x] 4.2 Migrate `RoomVideo` media-binding path onto `Tile`, keeping app visuals as its `*UI` prop; delete duplicated plumbing
- [x] 4.3 Verify: baselines identical; visibility still drives subscription preferences (existing tests + one new integration assertion)

## 5. Slice 4 - Publish orchestration and replace-track sync

- [x] 5.1 Package: publish-toggle orchestration surface (pause/produce/rollback/replace) absorbing `useRoomSfu` toggles and widget `toggleCapture`
- [x] 5.2 Package: replace-track sync surface absorbing `use-sfu-track-sync` and the widget's inline D5 effect
- [x] 5.3 Migrate apps/client; delete both local implementations; verify baselines
- [x] 5.4 Note: widget internals stay on today's code until slice 7 (documented in this task's PR description)

  Note (5.4): `ZvonokRoom` keeps its inline `toggleCapture` and D5 replace effect
  until the slice-7 rebuild; `usePublishControls`/`useSfuTrackSync` cover both
  behaviors and the widget adopts them during that rebuild. The app-side
  `useSfuTrackSync` mount also restores the device-switch track swap that was
  lost from `useRoomSfu` in the SDK-seam refactor.

## 6. Slice 5 - Layout derivation

- [x] 6.1 Package layout-derivation API over `computeLayout`: participant arrangement incl. spotlight area and pagination math, no markup, no CSS
- [x] 6.2 Migrate `ActiveRoomView` onto the derivation API (Tailwind positioning unchanged); delete app-side geometry math
- [x] 6.3 Verify: baselines for all grid variants and spotlight identical

## 7. Slice 6 - Prejoin machine, controls composition, share-error mapping, capability gate

- [x] 7.1 Package prejoin state machine: skippable name/device confirmation flow (guest approval states stay app-side), package tests
- [x] 7.2 Package controls composition surface + capability gate component (`requiredCapabilities` rendering), package tests
- [x] 7.3 Package share-error mapping centralization (typed screen-share errors to consumer-supplied presentation)
- [x] 7.4 Migrate apps/client prejoin/controls/share surfaces; delete local duplicates; verify baselines

## 8. Slice 7 - Embedded entry (BREAKING)

- [x] 8.1 Write parity checklist from today's `ZvonokRoom` (props, states, behaviors, error codes) into this change directory
- [x] 8.2 Build `./embedded` entry from public components: join lifecycle (skippable prejoin, typed join errors, reconnecting, leave), string layout options, `children` render-alongside, `start-recording`-gated record control
- [x] 8.3 Add `./css/*` subpath exports: component-kit stylesheet + embedded preset, all colors/radius/fonts as `--zk-*` tokens under the `.zk` namespace class
- [x] 8.4 Rebuild the widget on the layer per the parity checklist; delete the old prebuilt surface and export (BREAKING)
- [x] 8.5 Widget parity pass against 8.1 checklist with visual baselines for widget states
- [x] 8.6 Update README packages section and docs/quickstart.md to the embedded entry and token theming; note the contract stance (props/hooks/tokens stable, preset classes not)

## 9. Finalization

- [x] 9.1 Full verification: `pnpm test` (client + server + packages), lint, type-check, visual suite green
- [x] 9.2 Duplication audit: no app imports of deleted modules; the nine blocks exist only in the package
- [x] 9.3 `openspec validate --all`; sync deltas and archive per repo workflow after owner review
