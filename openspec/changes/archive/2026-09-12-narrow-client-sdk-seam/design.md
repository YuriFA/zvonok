## Context

Candidate B of the 2026-09-12 architecture review, grilled after candidate A
(`migrate-app-onto-react-bindings`) with dependency "apply after A": once the
app's parallel layers die, the set of externally imported subpaths is final
and the pruning below is safe. Facts driving the shape: 51 `@zvonok/client/*`
import sites scanned across `packages/react` and `apps/client`; `SfuManager`
is the sole implementer of every interface in `sfu/interfaces.ts`;
`ICaptureStateReader`/`ICaptureController`/`ICaptureTrackProvider` have no
implementers; the two `__mocks__` trees have exactly one importer each (the
peer-quality test; ZvonokRoom's screen-share test mock moves with change A's
`useScreenShare`).

## Goals / Non-Goals

**Goals:**

- The `exports` map is the interface: everything not listed is internal.
- One construction entry point (`createSfuManager`); composition stops being
  a consumer concern.
- State read by consumers describes the room, not the transports.

**Non-Goals:**

- No API renames inside the public modules (types, class method names stay).
- No seam redesign of the media stack (candidate A territory).
- No npm release in this change; workspace consumes sources through the same
  map, so pruning is verifiable by typecheck.

## Decisions

- **Prune, don't re-bucket.** No new area-entry barrels (repo rule: no
  `index.ts` re-export barrels); the map keeps file-level subpaths and just
  drops internal ones. Alternative rejected: `./sfu`-style area entries -
  new barrels, and they'd hide which module owns a type.
- **`createSfuManager` factory.** `SfuManager` gains a static construction
  path that builds its `SfuConnection` from options (server URL, identity,
  socket factory override for tests). The react hook calls the factory;
  `./sfu/connection` leaves the exports map. Alternative rejected: keeping
  connection public - composition stays a consumer concern forever.
- **Class type replaces `ISfuManager`.** Seven react-package imports move to
  `type { SfuManager }` (precedent: its own tests already do this);
  `sfu/interfaces.ts` is deleted, contract JSDoc moves onto the class.
  The media trio of unimplemented role interfaces dies with it;
  `IMediaManager` stays as the public type.
- **Mock doubles unpublished.** The peer-quality test switches to the
  socket-level fake (the `doubles.ts` + fake-socket pattern already in
  `@zvonok/react` tests). Nobody else imports the mocks after change A.
- **`SfuState` keeps the room-level fields.** Reader census: transport flags
  were read only by the dying `use-mediasoup`; every remaining field has a
  live reader (`use-zvonok-connection`, `use-own-capabilities`,
  `use-egress-state`, `use-broadcast`, quality controls, share state).

## Risks / Trade-offs

- [External consumers importing internal subpaths break] → That is the
  point; packages are pre-1.0 workspace-first and the release is deferred
  until after this change, so the breaking window closes before publish.
- [Factory options must cover every consumer variant] → Options stay
  explicit (`serverUrl`, identity, socket factory); the react cookie path
  from change A is the second caller and keeps the factory honest.
- [Typecheck cannot catch a missing runtime subpath] → A smoke import check
  (node resolve of every public subpath) runs in the package test script.

## Migration Plan

Single atomic change behind `migrate-app-onto-react-bindings`: exports map +
deletions + factory + consumer migration in one branch; `pnpm` typecheck and
both packages' tests are the gate. Rollback: revert the branch.

## Open Questions

(none)
