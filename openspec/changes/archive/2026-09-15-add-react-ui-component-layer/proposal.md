## Why

After the SDK extraction the headless layer is clean, but UI orchestration is
duplicated: eight functional blocks (publish toggles, replace-track sync,
prejoin, grid/spotlight derivation, controls composition, share-error mapping,
device handling, active-speaker wiring) are implemented twice - once in
apps/client, once in the prebuilt `ZvonokRoom` - the app bypasses package hooks
(`useDeviceControls`, quality adaptation), and the widget offers external
consumers no markup customization (fixed DOM, CSS-variable colors only). The
owner's architecture rule (2026-09-15): packages are the single source of
functionality, the app must fully consume them without duplication, and
external consumers must be able to customize the entire UI including markup and
styles. Packages are not yet published to npm, making this the cheapest moment
to reshape the public contract. Evidence base: docs/research/stream-video-js-ui-architecture.md
(GetStream's three-layer SDK, dogfooding model, customization seams).

## What Changes

- New UI-logic layer in `packages/react`: core components with component-typed
  UI props and context hooks (no render props) - `Tile` (video element binding
  + viewport tracking + replaceable default visuals), layout derivation over
  `@zvonok/video-layout` (JS selection/ordering, CSS geometry), capability
  gate, prejoin state machine, replace-track sync, controls composition,
  share-error mapping, active-speaker wiring.
- `useDeviceControls` absorbs the app's device handling (persisted selection,
  devicechange, permissions); apps/client migrates onto it and its local hooks
  (`use-media-devices`, `use-device-switching`) are removed.
- Quality adaptation engine (stats polling, hidden-tab suspend, debounced
  `setPreferredLayers`) moves into the package; apps/client's
  `PeerQualityStore`/context is removed. The widget gains quality adaptation it
  lacks today.
- **BREAKING** `ZvonokRoom` is rebuilt as a second entry point
  (`@zvonok/react/embedded`) composed from the same public components, owning
  join/prejoin lifecycle, with string-typed layout options and CSS-variable
  theming; the old single-component surface is replaced.
- Styling contract: preset stylesheets shipped as package subpath exports
  (`./css/*`), design tokens as `--zk-*` CSS custom properties under a
  namespace class. Stable public contract = exports map + component props +
  hooks + tokens; preset class names and DOM structure are explicitly not a
  contract. The app imports no package CSS (Tailwind stays).
- Verification: Playwright visual regression over key room states plus the
  existing vitest suites guard pixel-identical app UI per migration slice.
- npm publishing stays deferred and lands after this change, so the first
  public release already carries the new contract.

## Capabilities

### New Capabilities

- *(none - the SDK surface is owned by the existing `sdk` capability)*

### Modified Capabilities

- `sdk`: the "Prebuilt room component" requirement is replaced by an embedded
  entry-point requirement (**BREAKING**: composition, entry point and theming
  mechanics change); new requirements for the UI component layer (core/overlay
  split, replaceable defaults) and for the styling/theming contract (tokens,
  subpath exports, what is and is not stable); the "React binding" requirement
  gains the no-duplication dogfooding rule (the app consumes only the public
  surface).

## Impact

- `packages/react` - major restructure: new `ui/` core components, `embedded/`
  entry, css subpath exports; existing hooks keep working but gain absorbed
  responsibilities (devices, quality).
- `packages/client` - `useDeviceControls`-adjacent capture/device extensions
  (persistence, devicechange, permissions surface).
- `apps/client` - migration onto the public `packages/react` surface across
  vertical slices; deletions: `use-media-devices`, `use-device-switching`,
  `use-sfu-track-sync`, `PeerQualityStore`/context, local prejoin/controls
  orchestration. User-visible UI unchanged (pixel-identical target).
- `packages/video-layout` - unchanged code; becomes the only layout engine
  (widget preset adopts `computeLayout`).
- New dev dependency: Playwright (visual regression only).
- No server, Prisma, REST/WebSocket contract, or webhook changes.
