# Proposal: add-data-channel

## Why

The platform gap audit (docs/research/platform-gap-audit.md, Gap 1) confirmed
the `/sfu` namespace has no broadcast or custom-message handler: the only
server-to-room relay is egress status. Both vendors ship a data channel
(VideoSDK `meeting.send` 15 KiB + persisted replayable PubSub topics; Stream
`sendCustomEvent` 5 KB). This blocks reactions, custom sync, and external-UI
driving - the headless-SDK use case - and VideoSDK's own custom egress
layouts are built on it, making it the prerequisite for any headless
participant story later.

This is change 4 of the coordinated 0.4.0 wave (1: active-speaker hooks →
2: participant metadata → 3: list pagination → 4: data channel →
5: SDK reconnection).

## What Changes

1. **New capability `send-data-message`** joins the fixed vocabulary, granted
   by the `host` and `participant` role bundles and withheld from `viewer`.
   Authorization is capability-based as everywhere else.
2. **Ephemeral topic-scoped broadcast (breaking-free addition)**: a connected
   participant emits `sfu:broadcast` `{topic, payload}` and the server
   answers on the requesting socket with an acknowledgement - success or a
   coded error (`MISSING_CAPABILITY` without the capability,
   `PAYLOAD_TOO_LARGE` over the cap, `INVALID_TOPIC` on a bad topic). On
   success the server relays to every other participant in the room as
   `sfu:broadcast` `{senderId, topic, payload, timestamp}`.
3. **Limits**: `topic` is 1-64 characters of `[A-Za-z0-9._-]`; `payload` is
   any JSON value whose serialized size is at most 8192 bytes. Delivery is
   ephemeral: no persistence, no replay, at-most-once per connected socket;
   per-sender ordering follows the socket.
4. **SDK surface**: `@zvonok/client` gains `sendBroadcast(topic, payload)`
   settling on the server acknowledgement with typed denial errors
   (`SfuBroadcastError`), and a broadcast callback/state mirroring received
   messages. `@zvonok/react` exposes a discrete send hook and a
   topic-filtered receive hook.
5. **No REST surface**: the data channel is signalling-only.

## Capabilities

### Modified Capabilities

- `sfu`: the capability vocabulary gains `send-data-message`; a new
  broadcast requirement defines the relay contract.
- `sdk`: the manager/react surface gains the data channel.

## Impact

- **apps/server**: `capabilities.ts` vocabulary + role bundles; sfu gateway
  broadcast handler with ack; relay via the existing room broadcast path;
  unit + e2e coverage.
- **packages/client**: payload types, manager `sendBroadcast` (ack-settled)
  + incoming broadcast callback, event-router registration.
- **packages/react**: send + receive hooks, doubles, tests.
- **Docs**: quickstart data-channel section.
- Additive; no breaking changes.
