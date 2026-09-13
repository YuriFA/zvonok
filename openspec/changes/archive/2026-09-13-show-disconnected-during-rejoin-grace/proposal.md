## Why

When a participant hard-disconnects (closes the tab, loses the network), the
server intentionally holds their seat for the 30-second rejoin grace window
(`openspec/specs/sfu` - "Rejoin grace period") before announcing the
departure. During that window the remaining participants see the ghost as a
completely normal participant - microphone and camera shown as on, host
controls active - with no indication anything changed. The UI already knows
how to render a disconnected participant, but no data signal ever flips that
state, so the room looks wrong for up to 30 seconds.

## What Changes

- Server: broadcast a new `sfu:peer-media-detached { userId }` socket event to
  the room when a peer's media detaches (disconnect grace hold, leave, kick).
  Presence stays media-blind; the broadcast lives in the media layer next to
  the existing detach hook.
- SDK (`@zvonok/client`): handle the new event, mark the peer
  (`SfuParticipantInfo.mediaConnected`), expose `onPeerMediaDetached`;
  clear the flag when the same peer's media reattaches (silent rejoin restore,
  new producers).
- Room tracker (`@zvonok/react`): track per-participant `isConnected`
  (defaults true; false on media detach; true again on join/media reattach).
- Client app: map `isConnected` from tracker participants instead of the
  hardcoded `true`; `ParticipantItem` already renders the "Disconnected" state.
- E2E: extend the leave regression spec to assert the ghost row shows
  "Disconnected" right after a hard disconnect and is removed after the grace
  window.

No breaking changes: additive socket event, additive optional SDK field,
additive participant flag defaulting to the current behavior.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sfu`: new requirement - the room is told when a peer's media detaches, so
  clients can distinguish a held seat (grace window) from a live participant.
- `client`: new scenario - during the rejoin grace window the disconnected
  participant is shown as disconnected, not as a fully live participant.

## Impact

- `apps/server/src/sfu/sfu.service.ts` (detach broadcast)
- `packages/client/src/sfu/` (event router, manager, types)
- `packages/react/src/room-tracker.ts`, `packages/react/src/types.ts`
- `apps/client/src/features/room/hooks/use-room-participants.ts`
- Tests: server sfu specs, SDK manager tests, tracker tests, app mapping
  tests, `apps/client/e2e/room-leave.spec.ts`
