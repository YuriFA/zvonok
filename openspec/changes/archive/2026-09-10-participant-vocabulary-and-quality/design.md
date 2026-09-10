# Design: participant-vocabulary-and-quality

## Context

The core speaks `peer` (`remotePeers`, `SfuPeerInfo`,
`ISfuPeerRegistry`), the React layer already speaks `participant`
(`useParticipants`). The core also owns a transport-level simulcast switch
(`setPreferredLayers(consumerId, spatialLayer)`) that the React layer never
wraps. See proposal.md - Why. Builds on the A and C deltas.

## Goals / Non-Goals

Goals:
- One public word for the room member: participant.
- A friendly, VideoSDK-shaped manual quality API over the existing
  layer-switch primitive.

Non-Goals:
- Renaming the `sfu:*` wire event names (`sfu:mute-peer`,
  `sfu:kick-peer`, ...) - see D2.
- Stream-style automatic viewport-driven quality ("Dynascale") - rejected
  in review: rooms are 2-50 with a grid that renders everyone.
- A repository-wide naming audit; the pass covers the rename and the new
  hook only.

## Decisions

### D1: Rename surface = exported symbols, not internals

Rename every export of `packages/client` and `packages/react` that carries
the peer word: `SfuPeerInfo` -> `SfuParticipantInfo`,
`ISfuPeerRegistry` -> `ISfuParticipantRegistry`, `remotePeers` state and
callbacks -> participant names, peer-lifecycle callback types ->
participant-lifecycle. Internal module names and private symbols stay.
`useParticipants` and `RoomTracker` already comply.

### D2: Wire protocol stays `sfu:*` as-is

The socket event names are the contract between our own SDK and our own
server; consumers work through typed callbacks. Renaming them is churn with
zero consumer visibility. Revisit only if the wire surface is ever opened
as a public compatibility contract (e.g. third-party server
implementations).

### D3: Quality hook lives in React, core untouched

`useQualityControls()` composes two existing core primitives:
`getVideoConsumerIdForUserId` and `setPreferredLayers`. Mapping:
`low` -> 0, `medium` -> 1, `high` -> 2. The core's
`qualityToSpatialLayer` already defines score-based mapping; the hook's
explicit-level mapping stays independent of quality scoring (manual
override wins over automatic adaptation while set).

### D4: Level vocabulary: `low | medium | high`

Full words, not VideoSDK's `"med"` abbreviation - the level string is part
of a public contract; letters saved are letters paid in docs forever.

### D5: Typed no-op error over silent ignore

Setting quality for an id without subscribed video throws a typed error
rather than resolving silently: silent no-ops hide consumer bugs (stale
ids, wrong collection).

## Risks / Trade-offs

- [Rename churn across the monorepo] -> Mechanical, compiler-driven; rides
  the single 0.3.0 wave with A and C so consumers break once.
- [Manual override vs automatic adaptation conflict] -> Documented
  precedence: an explicit set wins until reconnect; automatic adaptation
  does not fight an explicit user choice within the session.

## Migration Plan

Compiler-driven rename inside the monorepo; external consumers (none today)
would follow the 0.3.0 release notes. No data or protocol migration.

## Open Questions

None.
