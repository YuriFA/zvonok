# Design: add-sdk-reconnection

## Decisions

1. **Manager owns the state machine.** `reconnecting` is a first-class
   connection state set on socket `disconnect` (only after a successful
   join; a first-join failure stays `failed`). `handleConnected` no longer
   just flips to `connected`: if a join is pending recovery it replays the
   join pipeline. Local `MediaStreamTrack`s and produce intents survive
   disconnect; transports/producers/consumers do not (server peers die with
   sockets) and are rebuilt by the existing join path - `loadDevice`,
   transport creation, produce, and the server's producer snapshot drive
   resubscription. Retained tracks are never re-`getUserMedia`d.
2. **Server grace, not client optimism.** Identity continuity is a server
   contract (sfu delta): 30s hold on disconnect, silent restore on same-id
   rejoin, kick terminal. The client does not attempt to fake presence.
   The token already pins the participant id, so "same id" falls out of
   rejoining with the same credential.
3. **tokenProvider retried exactly once per rejoin.** On an expired-token
   join denial: call provider, retry join once with the new token, persist
   it in manager state. Any further denial surfaces typed and stops. No
   provider: typed expired-token error, status `failed`. The initial join
   never calls the provider - the explicit `token` option stays the
   single source for first join.
4. **Kick detection reuses the existing denial codes.** The rejoin ack's
   kick denial flips the manager into the existing kicked state
   (`wasKicked` in React); reconnecting halts. The server marks kicked
   peers unrestorable for the room's lifetime so grace cannot resurrect
   them.
5. **App inherits for free.** `apps/client` consumes the same manager;
   the client spec's reconnection promise becomes SDK-delivered behavior.
   The prebuilt shows the `reconnecting` status through the existing
   status line - no new UI machinery.
6. **Reconnect exhaustion.** Socket.io's `reconnect_failed` maps to status
   `failed` with a typed error; local tracks are released with the manager
   teardown as today.
