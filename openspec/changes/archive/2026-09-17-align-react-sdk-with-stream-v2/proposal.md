## Why

Several migration iterations left the SDK packages structurally divergent from the
stream-video-js v2 target the project aligned on: `packages/react` keeps ~30 modules flat at
the source root with no layer separation (state seam vs media plumbing vs composite UI vs
prebuilt room), `packages/client` concentrates the media session in one 55KB
`sfu/manager.ts`, and `apps/client` still duplicates block behavior - its own participant
projection type and roster ordering next to `useParticipantsPanel`. The architecture target
and the evidence are pinned in
`docs/research/stream-video-js-v2-sdk-gap-analysis.md` (tag
`@stream-io/video-styling-2.0.0-beta.0`); this change turns that analysis into the finishing
migration so it stops being re-derived session after session.

## What Changes

- `@zvonok/react` source reorganized into the stream-v2 layer taxonomy: `src/hooks` (state
  seam), `src/contexts`, `src/core` (non-negotiable media plumbing: tile, video stream
  binding, track sync, quality engine), `src/components/<block>/` (one folder per composition
  block: behavior core + preset variant), `src/embedded`, `src/css`. No folder barrel files;
  the public surface stays the package entry plus the `exports` map (getstream's per-folder
  `index.ts` barrels are deliberately not copied - repo no-barrel rule).
- `packages/client`: `sfu/manager.ts` split into focused units (connection/join, publish,
  subscribe, stats+quality, actions) behind the unchanged `createSfuManager` seam.
- `ZvonokEmbeddedRoom` split into lifecycle pieces (prejoin card, join-error and status cards)
  inside `src/embedded`, keeping the `@zvonok/react/embedded` entry and props unchanged.
- `apps/client`: `participants-list.tsx` rebased onto the `ParticipantsPanel` projection; its
  parallel `Participant` type and local roster sorting deleted; remaining room components
  audited against the single-source rule and app-local duplicates removed.
- `css/` split into per-block files aggregated into the same two subpath exports
  (`component-kit.css`, `embedded.css`) - no `--zk-*` token contract change.
- No public API, props, events, or REST/WebSocket contract change; nothing breaking for
  external consumers.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sdk`: new requirement "Package layering and core seams" (the layered package structure and
  the core/components customization boundary a consumer may rely on); "Prebuilt room
  composition blocks" extended so block projections are the single vocabulary - consumers
  (the vendor app included) SHALL NOT maintain parallel participant projections or roster
  ordering.

## Impact

- `packages/react/src/`: file moves + import updates, embedded room split; package tests
  follow the moves; exports map unchanged except none.
- `packages/client/src/sfu/`: manager split; seam, exports, and wire behavior unchanged.
- `apps/client/`: dedup cutover; app tests for deleted duplicates move to package interface
  tests where behavior leaves the app.
- Specs: delta touches `specs/sdk/spec.md` only.
