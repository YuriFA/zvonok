## 1. Viewport-driven track quality

- [x] 1.1 Add `useViewportQuality(ref, userId)` in `packages/react/src/use-viewport-quality.ts`: IntersectionObserver visibility tracking + layer controller (visible -> layer 2 immediately, hidden -> layer 0 after 400ms, unchanged layers coalesced, missing camera consumer = silent no-op, screen/local tiles pass null and stay untracked)
- [x] 1.2 Wire visibility into both surfaces: `RoomVideo` feeds the quality engine via `usePeerViewport` (engine stays the single `setPreferredLayers` writer, target = `visible ? qualityLayer : 0`); the prebuilt camera `RoomTile` uses the SDK `useViewportQuality` (no engine there); screen-share and local tiles unwired
- [x] 1.3 Unit tests: visible -> full layer request, hidden -> delayed layer 0 request, unchanged layer not re-requested, missing consumer silent, unmount cancels pending demote

- [x] 2.1 Wrap `RoomVideo` in `apps/client` and the prebuilt room tile in `React.memo`; keep grid style objects stable via a `useMemo` over `layout.tiles` in `active-room-view`; document the participant reference-stability invariant on `RoomTracker`
- [x] 2.1a Integrate visibility into `PeerQualityStore`/`PeerQualityProvider` (hiddenUsers set, `setVisibility`/`subscribeVisibility`, effective layer `visible ? qualityLayer : 0`)
- [x] 2.2 Unit test: a room snapshot change that does not touch a participant's slice does not re-render its memoized tile

## 3. Video element binding

- [x] 3.1 Add `useVideoStream(ref, stream)` in `packages/react/src/`: unconditional `srcObject` assignment (null clears) and `play()` failure retry
- [x] 3.2 Adopt it in `apps/client` `local-video.tsx`, `room-video.tsx`, and the prebuilt tile; drop the per-component effects
- [x] 3.3 Unit tests: stream -> null clears `srcObject`; rejected `play()` retries

## 4. Concurrency helpers

- [x] 4.1 Add `packages/client/src/helpers/concurrency.ts` with `singleFlight`, `withoutConcurrency`, `hasPending`; unit tests for serialization, shared in-flight promise, pending check
- [x] 4.2 Refactor `replaceChains` and `producingInProgress` in `sfu/manager.ts` onto the helpers (behavior-preserving)
- [x] 4.3 Refactor `joinPromiseRef` in `use-zvonok-connection.ts` onto `singleFlight`
- [x] 4.4 Existing suites pass for manager and connection paths

## 5. Scoped logger

- [x] 5.1 Add `packages/client/src/helpers/logger.ts`: `createLogger(scope)`, level-gated, `localStorage['zvonok:log-level']` / `VITE_ZVONOK_LOG` override, default warn; unit tests
- [x] 5.2 Sweep all raw `console.*` call sites in `sfu/manager.ts`, `media/manager.ts`, `stats-collector.ts` onto scoped loggers

## 6. Device preference persistence

- [x] 6.1 Add `packages/client/src/media/device-preferences.ts`: namespaced `zvonok:device-preferences` record with private-mode guards; unit tests
- [x] 6.2 `MediaCapture` records the device id after successful start; `MediaStreamManager.start()` applies the remembered id when none is passed; missing device falls back to the browser default; muted intent recorded on explicit toggles; unit tests

## 7. Join/leave mutual exclusion

- [x] 7.1 Add a `leaveGeneration` counter in `use-zvonok-connection.ts`: `leave()` bumps it, in-flight `join()` checks after each await and before session updates; deterministic teardown during in-flight join
- [x] 7.2 Unit test: `leave()` during a pending `join()` settles the join promise and leaves no manager, no stale status

## 8. Recoverable error flag

- [x] 8.1 Add `recoverable: boolean` to `ZvonokError` with the centralized code map in `packages/react/src/errors.ts` (`ROOM_TOKEN_EXPIRED` recoverable; lock/invalid/host/egress/broadcast/timeout codes terminal)
- [x] 8.2 Errors carry the flag to consumers; retry decisions stay owned by the manager's token-refresh path (single retry owner); unit tests for the map

## 9. Reactive permissions

- [x] 9.1 Add `useDevicePermissions(kind)` in `packages/react/src/` over `MediaDeviceService.queryPermission` with `onchange` subscription and focus re-query; `'unknown'` on unavailable API; unit tests
- [x] 9.2 Surface camera/mic permission state in `DeviceSelector` (rendered on the pre-join screen) with actionable messaging for denied devices; unit tests

## 10. Rejoin rate limiting

- [x] 10.1 Sliding-window rejoin limiter in `sfu/manager.ts` recovery path (max 5 per 30s, exceeding fails recovery with `RECONNECT_EXHAUSTED`); unit test (bounded attempts)

## 11. Identity-stable participants array

- [x] 11.1 `RoomTracker.recompute()` keeps the previous array reference when shallow-identical; unit test: mute flip keeps array identity, membership change replaces it

## 12. ensureExhausted helper

- [x] 12.1 Add `packages/client/src/helpers/exhausted.ts` and apply to the `CaptureState` display switch and `qualityToSpatialLayer`; typecheck confirms narrowing

## Verification

- [x] 13.1 `pnpm -C packages/client test:run` (226), `pnpm -C packages/react test:run` (138), `pnpm -C apps/client test:run` (247) and all three `lint:ts` typechecks plus both package builds green
- [ ] 13.2 Manual smoke: dev room join - tiles memoize on unrelated events, device remembered across reloads, prejoin shows permission state
