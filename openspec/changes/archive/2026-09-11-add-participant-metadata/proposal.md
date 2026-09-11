# Proposal: add-participant-metadata

## Why

The platform gap audit (docs/research/platform-gap-audit.md, newly-found
candidate 3) found that minted tokens collapse identity to a server-generated
`randomUUID()` plus a display name: integrators cannot correlate zvonok
participants with their own user ids except by display-name string matching.
Both vendors carry consumer identity through the token (VideoSDK
`participantId` + `metaData`; Stream `user_id` + `custom`). The audit sized
this S - highest integrator value per line of code.

This is change 2 of the coordinated 0.4.0 wave (1: active-speaker hooks →
2: participant metadata → 3: list pagination → 4: data channel →
5: SDK reconnection).

## What Changes

1. **Mint accepts optional identity correlation fields (additive)**:
   `POST /v1/rooms/:id/tokens` gains `externalId` (string, 1-64 chars) and
   `metadata` (JSON object whose serialized size is at most 2048 bytes).
   Both are optional; omitted means absent. Validation rejects oversized or
   non-object `metadata` and out-of-range `externalId` with 400.
2. **Claims carry them**: the room token claims include `externalId` and
   `metadata` verbatim; the server never interprets either.
3. **Surfaced on the token join path**: a token-path participant's peer
   identity events (`peer-joined` payload, existing-participants snapshot)
   carry `externalId` and `metadata` when present. Cookie and guest identity
   paths carry neither (fields absent/null). Metadata is display and
   correlation data only: no authorization decision SHALL read it.
4. **Webhooks carry them**: `participant.joined` and `participant.left`
   include `externalId` and `metadata` when the participant has them, so
   consumers reconcile their own ids without joining the room.
5. **SDK types**: `SfuParticipantInfo` gains optional `externalId` and
   `metadata` fields; React participants state flows through unchanged.

## Capabilities

### Modified Capabilities

- `platform-api`: the mint requirement gains optional identity correlation
  fields with validation.
- `sfu`: the room-token join path surfaces token-carried `externalId` /
  `metadata` in peer identity events.
- `webhooks`: room lifecycle events carry participant correlation fields.
- `sdk`: participant info type gains optional correlation fields.

## Impact

- **apps/server**: platform DTO + validation, room-token helper claims, sfu
  peer identity payloads, webhook dispatcher payloads, with unit and e2e
  coverage.
- **packages/client**: `SfuParticipantInfo` type extension.
- **packages/react**: no code change (types flow through).
- **Docs**: `docs/api-reference.md` mint section; webhook payload examples.
- No breaking changes (all fields optional, absent by default).
