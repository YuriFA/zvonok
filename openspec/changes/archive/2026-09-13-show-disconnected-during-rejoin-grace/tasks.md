## 1. Server: detach broadcast

- [x] 1.1 Broadcast `sfu:peer-media-detached { userId }` to the room from the media detach path in `apps/server/src/sfu/sfu.service.ts`
- [x] 1.2 Add server unit test: grace hold emits the event; explicit leave emits it before `sfu:peer-left`; silent restore emits no event

## 2. SDK: event plumbing

- [x] 2.1 Add `mediaConnected?: boolean` to `SfuParticipantInfo` and `SfuPeerMediaDetachedPayload` in `packages/client/src/sfu/types.ts`
- [x] 2.2 Register `sfu:peer-media-detached` in the event router; manager sets the peer flag false, exposes `onPeerMediaDetached`, and clears the flag on peer join and on new producer from that peer
- [x] 2.3 SDK manager unit tests: detach marks the peer; rejoin and new-producer clear it

## 3. Tracker + app mapping

- [x] 3.1 Add `isConnected: boolean` (default true) to `ZvonokParticipant`; tracker subscribes `onPeerMediaDetached` and resets the flag on participant join in `packages/react`
- [x] 3.2 Tracker unit tests: detach flips `isConnected`, join restores it, leave removes the row
- [x] 3.3 Map `isConnected` from the tracker participant in `apps/client/src/features/room/hooks/use-room-participants.ts` instead of hardcoded `true`; update app unit tests

## 4. E2E + verification

- [x] 4.1 Extend `apps/client/e2e/room-leave.spec.ts`: after the guest's tab close the row shows "Disconnected", then is removed after the grace window
- [x] 4.2 Run server sfu specs, packages/client and packages/react suites, apps/client suite and typechecks; run the leave e2e spec
