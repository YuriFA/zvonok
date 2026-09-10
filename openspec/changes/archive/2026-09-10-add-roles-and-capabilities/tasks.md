# Tasks: add-roles-and-capabilities

## 1. Server: roles and bundles

- [x] 1.1 Capability vocabulary module: `CapabilityId` union, role->bundle map, identity-path resolvers (owner/host, registered/participant, guest/participant, token role); unit tests for every mapping
- [x] 1.2 Mint: `MintRoomTokenDto` gains `role` enum (default `participant`, unknown -> 400), token claims carry `role`; update platform service + spec tests (own room ok, ended 400, unknown 400, default applied)

## 2. Server: sfu gateway

- [x] 2.1 Join ack: resolve capabilities for the verified credential path and include them in the `sfu:join` acknowledgement; unit tests per identity path (owner, registered, guest, host/participant/viewer tokens)
- [x] 2.2 Produce guards: `send-audio`/`send-video` by kind, `send-screenshare` for screen source; permission-error tests per kind and role
- [x] 2.3 Host-action acks: convert `sfu:mute-peer`, `sfu:mute-all`, `sfu:lock-room`, `sfu:kick-peer` to ack-callback handlers with capability guards (`mute-users`, `remove-participants`, `lock-room`); kick acks after teardown; remove the `sfu:host-error` emission; tests: success path acks, denial acks with coded errors, lock semantics unchanged, no state change on denial

## 3. packages/client

- [x] 3.1 Types: `CapabilityId` export, capabilities on the join result and manager state
- [x] 3.2 Host controls: ack-settled promises for all four actions (`kickPeer` -> `Promise<void>`), typed `ZvonokHostError` with server code, ack timeout error; remove the `sfu:host-error` listener and the denial-window heuristic; unit tests (resolve on ack, reject on denial, reject on timeout)

## 4. packages/react

- [x] 4.1 `useOwnCapabilities()` hook over connection state; unit test (empty before join, server list after)
- [x] 4.2 `useHostControls` migration to the new factory shape (kick promise); update tests

## 5. apps/client migration

- [x] 5.1 Remove `sfu:host-error` handling; host UI (mute/kick/lock controls) gates on `useOwnCapabilities()`
- [x] 5.2 Mint call sites (console/quickstart-adjacent UI) send `role`

## 6. Docs and verification

- [x] 6.1 `docs/api-reference.md`: mint section -> `role` field with the three values and default
- [x] 6.2 Full verification: server suite, packages suites, app lint/tsc/e2e room flows
