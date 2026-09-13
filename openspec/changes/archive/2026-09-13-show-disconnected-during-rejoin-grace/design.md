## Context

On a hard disconnect the server detaches the ghost's media immediately
(`sfu.service.closePeer` -> `presence.holdSeat` -> `onPeerDetach` ->
`detachMedia`), which closes the ghost's server transports and, through
mediasoup, every consumer consuming their producers; consuming clients each
receive `sfu:consumer-closed { consumerId }`. The seat itself is held for the
30-second rejoin grace window and `sfu:peer-left` fires only on expiry
(`openspec/specs/sfu` - "Rejoin grace period"). Client-side today:

- `sfu:consumer-closed` carries no user id and the SDK's consumer map does not
  remember the owning peer, so consumers close silently
  (`manager.handleConsumerClosed`).
- `SfuParticipantInfo` has no per-peer connection/liveness field; the
  connection state in `SfuState` describes the local socket only.
- The app maps tracker participants with a hardcoded `isConnected: true`
  (`use-room-participants.ts`), while `ParticipantItem` already renders a
  red "Disconnected" label when `isConnected` is false - dead code today.

## Goals / Non-Goals

**Goals:**

- Remaining participants can distinguish "seat held, media gone" from a live
  participant within the grace window, without changing presence semantics.
- The signal is explicit and unambiguous, not inferred from consumer closures.
- Minimal contract surface: one additive server event, one additive optional
  SDK field, one participant flag.

**Non-Goals:**

- Changing the grace window length or the rejoin-grace behaviour itself.
- Server-side enforcement or UX for self-unmute (separate decision).
- Per-participant connection-quality changes.

## Decisions

1. **Explicit server broadcast over client-side inference.**
   `sfu.service.detachMedia(socketId)` broadcasts
   `sfu:peer-media-detached { userId }` to the room. Alternative considered:
   the SDK infers "all consumers of a peer closed -> disconnected" from
   `sfu:consumer-closed`. Rejected: the event lacks a user id (the SDK must
   start tracking consumer->peer anyway), and the inference is ambiguous -
   a participant with only video can close their camera voluntarily, which
   would false-positive as disconnected. The media layer already knows the
   detach moment precisely and presence stays media-blind (the port's stated
   design boundary); the broadcast sits next to the existing detach hook.

2. **Detach fires for every media-detach reason, not only grace holds.**
   Leave, kick, room end and grace holds all run `detachMedia`; the event is
   informational and idempotent for clients. When a departure announcement
   follows, the participant is removed and the flag dies with the row. This
   keeps the server hook single-site instead of threading "reason" through.

3. **`mediaConnected` on `SfuParticipantInfo`; `isConnected` on
   `ZvonokParticipant`.** The SDK field is optional (`mediaConnected?`,
   undefined = live) so the additive type change cannot break consumers; the
   tracker normalises it to the boolean `isConnected` (default true) that the
   UI already expects. Flag lifecycle in the manager: set false on
   `sfu:peer-media-detached`, true on peer (re)join and on a new producer from
   that peer (silent-restore reattaches media through the new-producer flow).

4. **No tracker change for track state.** The disconnected indication comes
   solely from the flag; the existing mic/cam icon updates stay as they are.
   Consumer closures during detach may leave the last-known icon state frozen
   until the row is removed or restored - acceptable for a ≤30 s window and
   avoids duplicating teardown logic in the tracker.

## Risks / Trade-offs

- One extra broadcast per detach on busy rooms; event rate equals disconnect
  rate, negligible next to existing per-consumer close events.
- Clients that do not know the event ignore it (socket.io default); the SDK
  handler is additive.
- A malicious client could forge the event client-side; it is display-only and
  carries only a user id, matching the trust level of existing media events.
