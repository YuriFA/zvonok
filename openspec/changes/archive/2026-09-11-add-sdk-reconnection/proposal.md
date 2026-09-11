# Proposal: add-sdk-reconnection

## Why

The platform gap audit (docs/research/platform-gap-audit.md, newly-found
candidate 1) found the biggest unforced reliability gap in the SDK layer: on
a network blip the socket transport reconnects, but `handleConnected` never
re-emits `sfu:join` while `handleDisconnected` has already torn down all
transports and producers - an external SDK consumer of `useZvonokConnection`
gets a dead room. There is no `reconnecting` status in the public
vocabulary and no way to refresh an expired token mid-call. The app spec
already promises automatic reconnection with resumed media; the SDK must
deliver it.

This is change 5 of the coordinated 0.4.0 wave (1: active-speaker hooks →
2: participant metadata → 3: list pagination → 4: data channel →
5: SDK reconnection).

## What Changes

1. **Automatic rejoin (additive to the status vocabulary)**: when the
   signalling socket disconnects after a successful join, the manager enters
   a `reconnecting` status, retains local tracks, and on transport
   reconnect re-emits `sfu:join`, re-creates transports, re-publishes the
   retained local tracks, and re-subscribes to current producers, returning
   to `joined`. Exhausted reconnect attempts surface as `failed` with a
   typed error.
2. **Server grace period**: a peer's socket disconnect starts a grace
   window (default 30s) during which the seat and participant identity are
   held: a rejoin with the same participant id within the window restores
   the seat silently - no `participant.left`/`participant.joined` webhooks,
   no peer-removed events for the room. Grace expiry runs the normal
   disconnect leave flow. A kick is terminal: the kicked participant's
   rejoin is refused regardless of grace.
3. **Optional `tokenProvider`**: join options accept
   `tokenProvider?: () => Promise<string>`. When a rejoin is rejected
   because the stored token expired, the manager calls the provider once,
   retries the join with the fresh token, and keeps the new token for
   future rejoins. Without a provider, an expired-token rejoin surfaces a
   typed error and the reconnect stops.
4. **React surface**: `ZvonokStatus` gains `reconnecting`;
   `useZvonokConnection` accepts `tokenProvider` and passes it through; the
   prebuilt renders a reconnecting notice from the status.
5. **Kick stays terminal client-side too**: a rejoin denied as kicked
   surfaces the kicked state and stops reconnecting.

## Capabilities

### Modified Capabilities

- `sfu`: a new rejoin-grace requirement governs disconnect hold, silent
  restore, grace expiry, and kick terminality.
- `sdk`: the connection contract gains the reconnection behaviour, the
  `reconnecting` status, and `tokenProvider`.

## Impact

- **apps/server**: sfu service/gateway disconnect flow gains the grace
  timer, rejoin-within-grace restore, kick terminality flag; unit + e2e.
- **packages/client**: manager reconnect state machine (retain tracks,
  rejoin, restore transports/producers/consumers, stats resume),
  `tokenProvider`; tests.
- **packages/react**: status vocabulary, option passthrough, prebuilt
  notice.
- **Docs**: quickstart reliability section.
- **Breaking**: `ZvonokStatus` union widens (new `reconnecting` member) -
  exhaustive switches in consumer code need updating; rides 0.4.0.
