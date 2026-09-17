## Context

The UI-logic layer from 2026-09-15 ships media plumbing (`Tile`, layout
derivation, capability gate, quality adaptation) with consumer-owned markup.
Room *composition* - control bars, participants panel, device switcher,
status cards, spotlight - still exists twice: fully featured in
`apps/client/src/features/room/` (app design system, Tailwind), absent or
primitive in `packages/react/src/embedded/` (preset CSS kit), which still
composes pre-`useZvonokCall` hooks (`useZvonokConnection` +
`usePublishControls` + `useSfuTrackSync`). The app cannot drop these files
into the package: they import app contexts (`@/components/ui/*`,
`@/features/chat/*`, `sonner`). Styling contract (`./css/*` + `--zk-*`
tokens, unstable preset DOM) and `useZvonokCall`'s outcome/callback
vocabulary are in place and are the substrate.

## Goals / Non-Goals

**Goals:**
- One behavior source per composition block; app and embedded both consume
  the public blocks.
- Embedded room reaches feature parity on join/toggle/host/kick/lock/device
  behavior with the app room.
- App keeps its exact current look: blocks render app markup via
  component-typed props (the 2026-09-15 layer's established pattern, no
  render props).

**Non-Goals:**
- No chat, whiteboard, guest-policy, or local-recording logic in packages.
- No Tailwind or app design-system changes; no preset DOM/class-name
  guarantees.
- No new server contracts; no `@zvonok/client` changes.

## Decisions

### D1: Behavior/looks split inside each block
Each block exports a behavior core (hooks + derived state + handlers, no
DOM) and a preset component that consumes the core. The app renders its own
markup against the core; the embedded room renders the preset component.
Alternative considered: single component with `className`/style props -
rejected, it forces the app onto preset DOM and reintroduces the coupling
the styling contract forbids.

### D2: Blocks take the call result as explicit props
`useZvonokCall` must run exactly once per room (it owns the tracker and
publish orchestration), so there is no per-block hook call and no new package
context: the owner (embedded room or the app's session context) passes the
call result and sibling hook results into block cores and presets as props.
Precedence collapses to a single rule - props are the source. Alternative
considered: a package context holding the call result - rejected; it adds a
second provider layer the app must wrap, and explicit props keep the data
flow visible at every call site.

### D3: Embedded room rebuilt on `useZvonokCall`, not extended
`EmbeddedRoomSurface`'s hand-rolled publish-on-join, toggle-with-rollback,
and notice state are deleted and replaced by the call-session hook. This
gains host-mute/kick/lock for free and deletes ~150 lines. Alternative:
keep the old hook stack and add kick handling to it - rejected; it
perpetuates the second implementation this change exists to delete.

### D4: Guest requests cross as props; notifications via callback
`ParticipantsPanel` receives `pendingRequests`/`onApprove`/`onDeny` props.
Preset blocks surface outcomes through an optional `onNotice?` callback and
inline notice areas - never `sonner`. The app maps `onNotice` to toasts.
Alternative: package depends on a toast library - rejected; app-domain
concern.

### D5: App cutover is per-block, not wholesale
`ActiveRoomView` keeps its layout, recording, chat, and panel registry.
`RoomLeftControls` becomes app markup over the control-behavior core;
participants panel host-action wiring moves to the block core with app
`ParticipantItem` markup retained via props. `useKeyboardShortcuts`,
`VideoGrid`, aside panels stay app-local (trivial, layout-owned).

### D6: Public surface grows additively; embedded props break
New exports: `useMediaControlStates`-style cores + preset
`ControlBar`/`ParticipantsPanel`/`DeviceSwitcher`/`RoomStatusCards`/
`ScreenShareSpotlight` + grid composition, from `@zvonok/react/prebuilt`
(entry keeps the main entry free of preset imports). `ZvonokEmbeddedRoom`
gains `hostControls`/`deviceSwitcher` boolean props (default on for
capability holders) - **BREAKING** only in that `RoomSurface` internals
move; documented props keep working.

## Risks / Trade-offs

- [App look drifts if a block behavior changes subtly] → interface tests at
  each block core assert derived states and outcomes; app consumes cores so
  drift is a compile error, not a visual surprise.
- [Preset DOM churn breaks embedded tests] → styling contract already
  declares DOM non-contractual; embedded tests assert via roles/labels and
  behavior, not class names.
- [Prop-override duality (context vs props) confuses consumers] → each
  block documents one precedence rule (props override context) and tests
  pin it.
- [Two entry points (`.` and `/prebuilt`) split exports] → `/prebuilt`
  re-exports nothing from `.`; main entry stays preset-free per the styling
  contract; smoke test asserts both entry graphs.

## Migration Plan

1. Land block cores + preset components + tests in the package (no
   consumer changes; embedded untouched) - independently revertible.
2. Rebuild embedded room on `useZvonokCall` + preset blocks; extend
   embedded tests (kick/lock/host paths).
3. Cut `apps/client` per block (left controls → panel → spotlight/cards),
   deleting app duplicates; app tests move to package interface tests.
4. Docs/quickstart refresh for the embedder story.

Rollback: steps are sequenced so 1 is inert, and 2-3 revert by git per
commit; no data or server state involved.

## Open Questions

- Whether `ControlBar`'s recording slot needs a package-level contract now
  or stays an app composition detail (D5 keeps it app-local; revisit if a
  second consumer asks).
