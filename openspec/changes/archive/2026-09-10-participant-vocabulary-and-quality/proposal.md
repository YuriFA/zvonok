# Proposal: participant-vocabulary-and-quality

## Why

The SDK's public vocabulary mixes two words for the same domain object:
`peer` in the client core (`remotePeers`, `SfuPeerInfo`, `ISfuPeerRegistry`)
and `participant` in the React layer (`useParticipants`). Both reference
platforms use `participant` exclusively; integrators reading our docs next
to theirs pay a needless translation tax. Separately, the client core's
simulcast control (`setPreferredLayers(consumerId, spatialLayer)`) is
transport-level jargon no consumer should need, and the React layer exposes
no quality control at all - VideoSDK's `participant.setQuality("low")` is
the pattern to match.

This is change **B** of the coordinated 0.3.0 wave (after
add-roles-and-capabilities and add-client-egress-control, whose deltas this
change builds on).

## What Changes

1. **Public vocabulary rename (breaking)**: every public export of
   `@zvonok/client` and `@zvonok/react` that names the domain object uses
   `participant` - `remoteParticipants`, `SfuParticipantInfo`,
   participant-lifecycle callbacks and events, `ISfuParticipantRegistry`.
   Internal implementation modules and the `sfu:*` wire event names are
   unchanged (see design D2).
2. **Quality control API**: `@zvonok/react` gains `useQualityControls()`
   exposing `setParticipantQuality(userId, "low" | "medium" | "high")`,
   layered over the core's layer-switching primitive. Applies to the
   subscribed video of a remote participant; audio is unaffected; ids that
   have no subscribed video are a typed no-op error.
3. **Naming pass scope**: the rename and the new hook are reviewed for
   naming quality; no repository-wide renaming audit beyond them.

## Capabilities

### Modified Capabilities

- `sdk`: the join contract speaks the participant vocabulary; the React
  binding gains the quality control hook; a new requirement covers manual
  quality selection semantics.

## Impact

- **packages/client**: renamed public types/callbacks/exports (breaking);
  internals untouched.
- **packages/react**: renamed re-exports if any; new
  `useQualityControls` hook; `useParticipants` unchanged in behavior.
- **apps/client**: import/type migration only.
- **Docs**: quickstart/API examples move to the new names.
- Breaking changes ride the same coordinated 0.3.0 release as A and C.
