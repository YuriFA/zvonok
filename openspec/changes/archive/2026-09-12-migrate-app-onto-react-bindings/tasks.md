## 1. Package: join contract

- [x] 1.1 Extend `use-zvonok-connection.ts` options to `{ roomId?, roomSlug?, token?, tokenProvider? }` with a typed error when both identifiers are absent; build the join payload accordingly
- [x] 1.2 Add `produceTrack(track, { isMobile })` passthrough to `manager.produce`
- [x] 1.3 Subscribe `manager.onRoomEnded` in the hook: surface a room-ended session state, run `leaveRoom()` cleanup, stop recovery
- [x] 1.4 Socket-level tests: cookie join (no token), id-only/slug-only/both payloads, missing-identifier typed error, `isMobile` reaches `manager.produce`, `roomEnded` state + cleanup

## 2. Package: new hooks

- [x] 2.1 Implement `use-remote-audio.ts`: wire `RemoteAudioMixer` to participant membership, expose per-participant volume, `setSink`, and level/active-speaker subscriptions fed from mixer analysers; release all resources on leave
- [x] 2.2 Implement `use-screen-share.ts`: own the `ScreenShareService` instance, expose `{ sharing, blocked, start, stop }` with typed failures
- [x] 2.3 Implement `use-guest-join-requests.ts`: wrap `manager.onGuestJoinRequest`, own pending-queue state, expose removal API for consumer actions
- [x] 2.4 Export new hooks and updated option types from `packages/react/src/index.ts`
- [x] 2.5 Socket-level tests: playout (audible wiring, per-participant volume, sink routing, levels from playout graph, leave cleanup), screen share (start/blocked/stop), guest queue (request in, removal out)

## 3. Package: ZvonokRoom refactor

- [x] 3.1 Replace per-tile hidden `<audio>` elements and manual stream attachment with `useRemoteAudio`
- [x] 3.2 Replace inline `new ScreenShareService(...)` with `useScreenShare`
- [x] 3.3 Update `zvonok-room.test.tsx` mocks to the new hooks

## 4. App migration

- [x] 4.1 Switch `room.tsx` to render `ZvonokProvider`; join via `useZvonokConnection` with cookie path (`roomId`/`roomSlug`, no token)
- [x] 4.2 Re-point mic/camera toggles and track sync onto hook publish controls (`produceTrack`, `pauseProducer`, `replaceTrack`), deleting the duplicated state machines in `use-room-sfu.ts`
- [x] 4.3 Delete `use-mediasoup.ts` and `SfuManagerProvider`; move remaining consumers (auto-quality, guest context) onto the session manager
- [x] 4.4 Replace `room-audio.context`/`store`/`use-remote-audio` with `useRemoteAudio`; keep per-user level consumers on the hook's subscriptions
- [x] 4.5 Replace `use-screen-share.ts` with the package hook
- [x] 4.6 Reduce `guest-requests.context.tsx` to HTTP actions + UI, consuming `useGuestJoinRequests` for the queue
- [x] 4.7 Delete `media-manager.context.tsx`; collapse consumers onto `session.mediaManager` / `useDeviceControls`; re-point `useDeviceSwitching`
- [x] 4.8 Delete the migrated layers' tests (`use-mediasoup.test.ts`, `use-mediasoup-host.test.tsx`, room-audio and toggle-layer tests)

## 5. Verification

- [x] 5.1 `pnpm -C packages/react test` green including new socket-level suites
- [x] 5.2 `pnpm -C apps/client test` and typecheck green after deletions
- [ ] 5.3 Manual room run: cookie join, mic/camera toggles with device switch, remote audio with volume per participant, screen share incl. second-sharer block, guest request and approval, kick and reconnect
- [x] 5.4 `pnpm openspec:validate` passes with the change staged
