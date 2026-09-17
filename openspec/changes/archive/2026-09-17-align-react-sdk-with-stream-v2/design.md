## Context

`packages/react/src` today is flat: ~21 `use-*.ts` hooks plus support modules
(`tile.tsx`, `peer-quality-engine.ts`, `room-tracker.ts`, `capability-gate.tsx`,
`errors.ts`, `types.ts`, ...) at the source root, a `prebuilt/` directory
(behavior-core `.ts` + `-preset.tsx` pairs with an `index.ts` barrel), a single
344-line `embedded/ZvonokEmbeddedRoom.tsx`, and two aggregated stylesheets under
`css/`. `packages/client/src/sfu/manager.ts` is a 55KB monolith. In the app,
`apps/client/src/components/room/participants-list.tsx` defines its own
`Participant` type (a near-copy of the package's `PanelParticipant`) and sorts
roster locally, duplicating `useParticipantsPanel`. The architecture target is
pinned in `docs/research/stream-video-js-v2-sdk-gap-analysis.md` (stream-video-js
tag `@stream-io/video-styling-2.0.0-beta.0`); the prior research doc
`docs/research/stream-video-js-ui-architecture.md` covers the same monorepo in
depth.

## Goals / Non-Goals

**Goals:**

- `@zvonok/react` source laid out in the stream-v2 layer taxonomy so the state
  seam, media plumbing, blocks, and prebuilt room are structurally distinct.
- `packages/client` media session split into focused units behind the existing
  `createSfuManager` seam.
- App consumes block projections; no app-side duplicate behavior.
- Public surface unchanged: package entry + `exports` map, same subpaths.

**Non-Goals:**

- No separate styling package (one UI stack; the subpath CSS seam already
  provides what `@stream-io/video-styling` provides for two stacks).
- No new hooks, blocks, or behavior; no public API/props change.
- No `packages/video-layout` or server changes.

## Decisions

### Target layout for `packages/react/src`

| Current (src root) | Target |
|---|---|
| `use-participants`, `use-zvonok-call`, `use-publish-controls`, `use-prejoin`, `use-device-controls`, `use-device-permissions`, `use-quality-controls`, `use-egress-state`, `use-egress-controls`, `use-broadcast`, `use-screen-share`, `use-guest-join-requests`, `use-host-controls`, `use-own-capabilities`, `use-audio-activity`, `use-remote-audio`, `use-room-layout`, `use-store-selector`, `derive-media-control`, `map-screen-share-error`, `capture-port`, `host-controls`, `room-tracker`, `deferred` | `hooks/` (state seam, no markup) |
| `zvonok-context`, `peer-quality-context` | `contexts/` |
| `tile`, `use-video-stream`, `use-sfu-track-sync`, `peer-quality-engine`, `use-viewport-quality` | `core/` (non-negotiable media plumbing) |
| `capability-gate` | `wrappers/` (the `Restricted` analog) |
| `errors`, `types` | stay at `src` root (package-wide vocabulary) |
| `prebuilt/control-bar`, `prebuilt/media-controls`, `prebuilt/participants-panel` (+`-preset`), `prebuilt/device-switcher` (+`-preset`), `prebuilt/stage`, `prebuilt/status-cards` | `components/<block>/` one folder per block: behavior core + preset together (`control-bar/`, `media-controls/`, `participants-panel/`, `device-switcher/`, `stage/`, `status-cards/`); `prebuilt/index.ts` deleted |
| `embedded/ZvonokEmbeddedRoom.tsx` | `embedded/`: extract `PreJoinCard` and the failure/status card compositions into their own files; the room file stays the composer; entry `@zvonok/react/embedded` unchanged |
| `css/component-kit.css`, `css/embedded.css` | `css/`: per-block files (`component-kit/<block>.css`) aggregated by the same two subpath files; token contract untouched |

### Naming and barrels

- Keep the established "preset" vocabulary (`ParticipantsPanelPreset`, ...) and
  the `--zk-*` namespace; getstream's `Default*UI` naming is not adopted -
  renaming published names buys nothing and churns consumers.
- No folder `index.ts` anywhere (repo no-barrel rule). getstream uses per-folder
  barrels; here the package entry + `exports` map is the public API, imports go
  to source paths. Internal imports use package-relative paths (`../hooks/...`).
- The word "prebuilt" disappears from the tree; in stream v2 the same concepts
  live under `components/` and `embedded/` (0 occurrences of "prebuilt" in
  react-sdk sources at the target tag).

### `packages/client` manager split

Extract cohesive slices from `sfu/manager.ts` into sibling units under `sfu/`:
join/session lifecycle, publish, subscribe, stats+quality (beside the existing
`stats-collector.ts`, `quality-score.ts`), and host/guest actions (beside
`event-router.ts`). The `SfuManager` type and `createSfuManager` entry stay the
only public seam; extraction is incremental with the existing `sfu/__tests__`
kept green at each step.

### App cutover

`participants-list.tsx` takes the `ParticipantsPanel` projection (or receives
`PanelParticipant[]` from it) and keeps only markup; its local `Participant`
interface and `sortedParticipants` sort are deleted; `participant-item.tsx`
consumes `PanelParticipant`. Ordering tests move to (or already exist in) the
package's block tests. A final pass greps the app for package-private imports
and duplicate block behavior; findings are deleted or surfaced as gaps.

### Test placement

Package tests stay in `packages/react/__tests__` (existing convention);
imports follow the moved files. App tests that pinned deleted duplicate
behavior are removed; the behavior they covered is asserted by package tests.

## Risks / Trade-offs

- Large mechanical move churns diffs and review; mitigated by move-only commits
  per layer, then behavior edits separately, and by keeping exports stable so
  no consumer code changes.
- Import path mistakes across ~30 moved modules; mitigated by the package's
  test suite and typecheck after each layer move.
- The manager split touches the most fragile code in the system; mitigated by
  extracting one slice per step with the existing `sfu` tests green between
  steps, no wire-behavior edits mixed in.
