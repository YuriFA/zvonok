# Proposal: add-roles-and-capabilities

## Why

The platform comparison against VideoSDK and Stream
(docs/research/sdk-platform-comparison.md) surfaced two authorization
weaknesses:

1. Token permissions are two opaque booleans (`publish`, `admin`). Consumers
   must know which endpoint checks which flag; UI gating in consumer apps
   duplicates server logic. Both reference platforms expose a
   capability-oriented authorization surface, and Stream additionally delivers
   the caller's effective capabilities to the client (`own_capabilities`) so
   UIs gate without guessing.
2. Host actions (`mute`, `mute-all`, `lock`, `kick`) resolve through a
   3-second denial window in `@zvonok/react` (`host-controls.ts`): success
   means "no `sfu:host-error` arrived in time", not "the server applied the
   action". This violates the sdk spec's "resolve with the server result" and
   makes every mute hang for the window duration.

This is change **A** of the coordinated 0.3.0 wave (A: roles and capabilities
→ C: client egress control → B: participant vocabulary → D: prebuilt theming).

## What Changes

1. **Roles replace token booleans (breaking)**. `POST /v1/rooms/:id/tokens`
   accepts `role: "host" | "participant" | "viewer"` instead of
   `publish`/`admin`. Default `participant`; unknown role is rejected with
   400. Roles are default bundles of capabilities, resolved server-side.
2. **Capability vocabulary, enforced per action**:
   `send-audio`, `send-video`, `send-screenshare`, `mute-users`,
   `remove-participants`, `lock-room`, `start-recording`, `start-broadcast`.
   The server checks capabilities, never role names, so later configurability
   is a config change, not a contract change. `start-recording` and
   `start-broadcast` ship in the vocabulary now and gain enforcement in
   change C.
3. **Identity-path mapping**: room owner → host bundle; registered users and
   approved guests → participant bundle; room-token joins → the bundle of the
   token's role (`viewer` = no send capabilities, `host` = everything).
4. **Capabilities in the join acknowledgement**: every successful `sfu:join`
   ack carries the participant's effective capabilities as a list of capability
   ids. Clients never decode JWTs to learn their rights; the server is the
   single source of truth.
5. **Host actions become acknowledged (breaking)**. `sfu:mute-peer`,
   `sfu:mute-all`, `sfu:lock-room`, and `sfu:kick-peer` respond via socket.io
   ack callbacks: ok or a coded denial. The `sfu:host-error` broadcast event is
   removed. In the SDK all four `HostControls` methods return Promises that
   settle on the server's response - `kickPeer` included.
6. **SDK surface**: connection state exposes own capabilities;
   `@zvonok/react` gains `useOwnCapabilities()`.

## Capabilities

### Modified Capabilities

- `platform-api`: the room-token mint requirement moves to a `role` field
  with role-based permission semantics.
- `sfu`: host-control authorization moves from owner/admin checks to
  capability checks; host actions answer with acknowledgements; the join ack
  carries capabilities; the room-token join path derives them from the role.
- `sdk`: the join contract exposes own capabilities; host control actions
  resolve on server acknowledgements; the React binding adds
  `useOwnCapabilities`.

## Impact

- **apps/server**: mint service + DTO (role validation), token claims
  (role), role→capability bundle mapping, sfu gateway: capability guards on
  produce/mute/kick/lock, ack handlers replacing the `sfu:host-error`
  emission, capabilities in the join ack.
- **packages/client**: manager join result and state carry capabilities;
  host-control emission switches to ack-settled promises; `kickPeer` returns
  a Promise.
- **packages/react**: `useOwnCapabilities` hook; host-controls wrapper
  migration off the denial window.
- **apps/client**: migrate off `admin`/`publish` semantics and the
  `sfu:host-error` listener.
- **Breaking changes** ride the single coordinated 0.3.0 release.
- **Docs**: `docs/api-reference.md` mint section (role field).
