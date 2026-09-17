## 1. Package: session store and connection seam

- [ ] 1.1 Add framework-free `SessionStore` (named transitions, `getSnapshot`/`subscribe`) in `packages/react/src/core/`; unit-test transitions and snapshot stability
- [ ] 1.2 Move session state ownership from `zvonok-context.tsx` to the store; delete `update(patch)` from `ZvonokSession`; migrate the 10 `update` call sites in `use-zvonok-connection.ts` to named transitions
- [ ] 1.3 Shrink `UseZvonokConnectionResult` to lifecycle + session flags (drop `produceTrack`, `pauseProducer`, `resumeProducer`, `closeProducer`, `replaceTrack`, `hasProducer`, `manager`); keep the manager reachable via the session
- [ ] 1.4 Rewire `useZvonokCall` to consume `usePublishControls` for publish/pause; update its tests (the `as unknown as` cast on the connection input goes away)
- [ ] 1.5 Implement `pauseVideoWhenHidden` (default `false`) in `useZvonokCall` with tests: pause on hidden, resume honors the user's toggle state, no-op when omitted
- [ ] 1.6 Update recovery/connection tests for the store-backed session; leave reconnect mirroring assertions intact

## 2. Package: provider factories and quality cut

- [ ] 2.1 Add `createManager` / `createMediaManager` factory props to `ZvonokProvider` (defaults = current behavior) and thread them through the session
- [ ] 2.2 Convert `zvonok-room.test.tsx`, `provider.test.tsx`, and `use-device-controls.test.tsx` from five module mocks to front-door injection
- [ ] 2.3 Make `useViewportQuality`, `usePeerQualityContext`, `PeerQualityEngine`, `STATS_INTERVAL_MS`, `LAYER_SWITCH_DEBOUNCE_MS` non-exported (Tile keeps working; provider + stats hook stay public)
- [ ] 2.4 Make `createHostControls`, `loadDeviceSelection`, `deriveMediaControlState` non-exported; update `block-exports.test.ts` and the index export blocks

## 3. Package: status-cards projection

- [ ] 3.1 Change `StatusCardsPresetProps` to `{ call, connection, onBack?, className? }`; derive status inside the block; delete `useRoomStatus`, `RoomStatus`, `UseRoomStatusOptions`
- [ ] 3.2 Update the embedded room, `switcher-status.test.tsx`, and `block-exports.test.ts` for the removed projection hook

## 4. App cutover

- [ ] 4.1 Enable `pauseVideoWhenHidden` in `room-session.context.tsx`; delete `apps/client/src/features/room/hooks/use-room-visibility.ts` and its wiring
- [ ] 4.2 Rework `room.test.tsx` to `importOriginal` with data-only overrides for `useZvonokConnection`/`useZvonokCall`; delete the re-implemented `useParticipantsPanel` ordering from the mock

## 5. Verification and cleanup

- [ ] 5.1 Run `packages/react` and `apps/client` test suites, typecheck, and format; fix fallout
- [ ] 5.2 Grep for removed exports across `apps/client` and docs; update `docs/quickstart.md` where it names removed surface
