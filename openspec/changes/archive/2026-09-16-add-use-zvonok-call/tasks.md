## 1. Package: CapturePort and default adapter

- [x] 1.1 Add `CapturePort` to `packages/react/src` (getTrack / ensureTrack / release per PublishKind), refactoring `PublishToggleHooks` into it without changing `usePublishControls` behavior
- [x] 1.2 Add the default adapter over `useZvonokSession().mediaManager` (map kind to videoCapture/audioCapture, expose current local streams)
- [x] 1.3 Unit-test the default adapter: track reads, ensure flows to the right capture, release is idempotent

## 2. Package: useZvonokCall

- [x] 2.1 Implement `useZvonokCall` composing useZvonokConnection result + RoomTracker (local projection) + usePublishControls + host controls; options and result per design D4
- [x] 2.2 Implement ToggleControl with optimistic state and rollback per PublishToggleResult, replacing the app's rollback policy
- [x] 2.3 Implement publish-on-join (autoPublish default true) and connection-state mirroring from the manager
- [x] 2.4 Implement host-mute enforcement with once-per-occurrence onHostMuted and kick surfacing with one-shot onKicked plus capture release through the port
- [x] 2.5 Export `useZvonokCall`, `CapturePort`, `ToggleControl`, `UseZvonokCallOptions`, `UseZvonokCallResult` from `packages/react/src/index.ts`
- [x] 2.6 Interface tests in `packages/react/src/__tests__/use-zvonok-call.test.tsx`: publish-on-join, each toggle outcome + rollback, host-mute once per occurrence, kick releases capture, participants include stable local projection, default capture used when omitted

## 3. App cutover

- [x] 3.1 Rewire `room-session.context.tsx` to `useZvonokCall`: localUserId from auth, onHostMuted and onKicked to toasts/navigation; keep the state/actions context split
- [x] 3.2 Migrate room route, prejoin, and device-selector off `MediaStreamProvider` onto the SDK capture surface; remove the provider from the room route and visual harness
- [x] 3.3 Map the participants panel from `ZvonokParticipant` and delete `use-room-sfu.ts` (with its test), `use-room-participants.ts`, `RemotePeerMedia`/`toRemotePeer`, and the optimistic setters in `use-media-controls.ts`
- [x] 3.4 Update app tests (room route, room-session context, device-selector) for the new surface; no package-private imports remain in `apps/client/src/features/room`

## 4. Verification and cleanup

- [x] 4.1 Run package and client test suites; fix fallout
- [x] 4.2 Grep gates: no `RoomTracker` / `usePublishControls` / `useSfuTrackSync` / `MediaStreamProvider` imports under `apps/client/src/features/room`; no `@zvonok/react` internals outside public exports
- [x] 4.3 Local smoke test of the room (dev server, same-machine mediasoup): join, toggle camera/mic incl. failure rollback, host mute toast once, kick returns to call-ended, device switch mid-call
- [x] 4.4 Lint and typecheck both workspaces clean
