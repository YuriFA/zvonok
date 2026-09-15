## Context

See proposal.md - Why. Current facts that shape the design:

- The duplication is at UI-orchestration level, not the hook layer: eight blocks
  are implemented twice (inventory: session exploration, 2026-09-15; app side in
  `apps/client/src/features/{room,media,chat}`, widget side in
  `packages/react/src/prebuilt/ZvonokRoom.tsx`).
- The app bypasses two package surfaces: `useDeviceControls` (app keeps its own
  `use-media-devices`/`use-device-switching` with localStorage persistence) and
  quality adaptation (app's `PeerQualityStore` engine vs the widget's bare
  `useViewportQuality`; the package hook lacks stats polling, suspend, debounce).
- `@zvonok/video-layout` (`computeLayout`) is consumed only by the app; the
  widget uses a static CSS grid.
- Packages are published to npm yet (`2.0.0-beta`-era surfaces, publish deferred
  by owner decision), so contract reshaping has no published backward-compatibility
  cost.
- Primary-source evidence: docs/research/stream-video-js-ui-architecture.md
  (GetStream's client/bindings/sdk split, component-typed UI props, embedded
  prebuilt entry, token theming, dogfooding app).

## Goals / Non-Goals

**Goals:**

- One public surface in `packages/react` sufficient for three consumers: the app
  (own Tailwind markup), the embedded widget preset, and external custom UIs.
- Zero duplicated room-UI orchestration: every one of the nine blocks (eight
  duplicates + quality engine) lives in the package once.
- App UI pixel-identical after every migration slice, verified automatically.
- A styling contract external consumers can rely on: tokens stable, preset
  internals not.

**Non-Goals:**

- React Native or non-React consumers (no bindings package split).
- Moving product features into the package: chat, local recording, keyboard
  shortcuts, guest approvals, host-control UI remain app-only.
- Server, Prisma, REST/WebSocket, or webhook changes.
- npm publish in this change.
- Adopting Tailwind or any CSS framework inside the package.

## Decisions

**D1 - One package, layered internally, subpath exports.** `packages/react`
keeps hooks at `.`, gains `./embedded` (prebuilt room) and `./css/*` (preset
stylesheets and tokens). Internal layering (hooks / ui / embedded) stays
import-from-source per repo convention. Alternative considered - separate
bindings package like GetStream's `react-bindings` - rejected: that split
exists to share hooks with their React Native SDK; we have no second UI stack,
and a package boundary without a second consumer violates the repo's
no-single-use-abstraction rule. Revisit if a non-web stack appears.

**D2 - Customization via component-typed props + context data hooks, not render
props.** Core components accept `*UI` props (`ComponentType | ReactElement |
null`) holding replaceable default visuals; replacement components read data
through a context hook (GetStream's `ParticipantViewUI` /
`useParticipantViewContext` pattern, verified in research §3). Rejected:
render props (composition gets nested and typed prop churn is worse) and
hooks-only (external consumers would reassemble tile plumbing themselves - the
exact duplication we are removing).

**D3 - Core/overlay split with an "extended core".** Core owns plumbing with
side effects plus its default replaceable visuals: `Tile` (video/audio element
binding, element-visibility tracking feeding quality adaptation), layout
derivation (consumes `@zvonok/video-layout`; JS selection/ordering/pagination,
CSS geometry in the preset), the capability gate, and the quality adaptation
engine. Everything purely visual (badges, audio rings, speaker highlight) is
`*UI` props over core, never core itself. The tension "visual in core vs
classes-not-a-contract" resolves exactly the GetStream way: default visuals are
replaceable props, their classes live in the preset stylesheet which is not a
stable contract. Alternative "minimal core" rejected by owner (grilling round 2)
- coverage was worth the larger frozen surface.

**D4 - Quality adaptation engine moves into the package.** The package hook
(absorbing `useViewportQuality`) grows the app engine's capabilities: stats
polling, hidden-tab suspend, debounced `setPreferredLayers`. The app migrates;
`PeerQualityStore`/context is deleted; the widget gains adaptation it lacks
today. The manual `setParticipantQuality` contract is untouched.

**D5 - Device handling collapses to one public surface.** `useDeviceControls`
absorbs persisted per-user selection, `devicechange` handling, and permission
state from the app hooks; `use-media-devices`/`use-device-switching` are
deleted after the app migrates. Rejected: keeping two paths (violates the
no-duplication rule) and shipping both as package APIs (two APIs, one job).

**D6 - Styling: plain CSS, tokens first.** Preset stylesheets are hand-written
CSS (no SCSS toolchain in the repo), every color/radius/font parameter expressed
as `--zk-*` custom properties under a `.zk` namespace class; files ship via
`./css/*` subpath exports (component-kit sheet + embedded preset sheet, two
files mirroring GetStream's `styles.css`/`embedded.css` split). The app imports
nothing. Stable contract: exports map, props, hooks, token names; class names
and DOM - explicitly not. Alternative Tailwind-in-package rejected (peer
dependency on the consumer's build setup; preset must work with zero
configuration).

**D7 - Embedded entry replaces `ZvonokRoom`.** `./embedded` exports a prebuilt
room composed from the same public components, owning join lifecycle
(skippable prejoin, typed join errors, reconnecting status, leave), string
layout options, `children` render-alongside, recording control gated on
`start-recording`. This is a **BREAKING** replacement of today's single-file
widget surface - acceptable because the package is unpublished.

**D8 - Layering rule over the package internals.** UI components never touch
the SFU manager or observables directly; all state access goes through package
hooks (adopted from GetStream's stated "critical rule"; cheap to review for,
keeps the seams real).

**D9 - Verification: Playwright visual regression + existing suites.** New
Playwright project scopes to apps/client room states; per slice, baselines are
re-recorded once on the pre-slice commit and compared post-slice; dynamic
regions (video tiles) use deterministic fixtures (fake tracks, masked media
areas). Playwright config starts its own Vite server (`webServer`), so no
manual server management enters the loop. Chosen over manual smoke by owner
(grilling round 3) - roughly seven slices justify automatic detection.

**D10 - npm publish lands after this change.** First public release carries
`./embedded`, `./css/*`, and the contract stance with no published legacy to
break.

## Risks / Trade-offs

- [Extended core freezes a large surface before real external feedback] →
  Mitigation: contract stance D6 makes everything except props/hooks/tokens
  mutable; core components start minimal in v1 and grow via props, not
  rewrites.
- [Visual regression flakiness on media-heavy UI] → Mitigation: structural
  baselines only (prejoin, grids with fake tracks, controls, panels), masked
  video regions, deterministic fixtures; screenshots tied to fixed viewport.
- [App migration regressions across seven slices] → Mitigation: slice order
  keeps each commit shippable; baselines re-recorded on the pre-slice commit
  make any drift reviewable in the slice's diff.
- [Widget rebuild drops an existing widget behavior] → Mitigation: slice 7
  begins with a parity checklist derived from today's `ZvonokRoom` props and
  states; the old surface is deleted only after parity passes.
- [Bigger frozen API = bigger future breaking-change blast radius] → Mitigation:
  publishing (D10) waits for the layer to land, so the API hardens against the
  dogfooding app before it is public.

## Migration Plan

Vertical slices, each ends with: app pixel-identical (visual baselines + vitest
green), no new duplication, package surface documented. Order:

1. Device controls unification (D5) - package absorbs persistence/devicechange/
   permissions; app migrates; app hooks deleted.
2. Quality engine into package (D4) - hook upgrade; app migrates; store deleted.
3. `Tile` core (D3) - video binding + visibility + `*UI` props; app's
   `RoomVideo` migrates its binding path.
4. Replace-track sync + publish-toggle orchestration into package surfaces.
5. Layout derivation on `computeLayout` (D3) - app consumes package derivation;
   spotlight/geometry logic leaves the app.
6. Prejoin machine, controls composition, share-error mapping, capability gate.
7. `./embedded` entry + `./css/*` + tokens; `ZvonokRoom` rebuilt on the layer
   (parity checklist first), old surface deleted (**BREAKING** lands here).

Rollback: slices are independent commits; a failed slice reverts without
touching landed ones (each slice deletes the app code it replaces only after
green).

## Open Questions

- Final names of the exported core components and hooks (`Tile` vs
  `ParticipantSurface`, `useRoomLayout` vs `useLayoutDerivation`) - settled at
  apply time against the code, does not affect the contract stance.
- Exact visual-state list and fixture strategy for Playwright baselines -
  enumerated at the start of slice 1 and extended per slice.
