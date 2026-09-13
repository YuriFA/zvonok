## Context

Research basis: docs/research/stream-video-js-codebase-patterns.md (verified
against stream-video-js at 57f23a1 and our tree). Relevant current state:

- `packages/client/src/sfu/manager.ts` already has the layer actuator:
  `setPreferredLayers(consumerId, spatialLayer)` emitting
  `sfu:set-preferred-layers`, plus `getVideoConsumerIdForUserId(userId)`.
  Server side (apps/server/src/sfu/sfu.service.ts) validates consumer
  ownership and no-ops on unknown peer/consumer - safe to fire and forget.
- `RoomTracker` is the external store with per-participant reference
  stability; `useStoreSelector` provides slice-level subscriptions.
- `MediaCapture.start(deviceId?)` is the single capture entry point;
  `MediaDeviceService.queryPermission(kind)` exists but has no consumers.
- Concurrency today: `replaceChains` per-kind chaining, `producingInProgress`
  dedupe map, `pendingLocalProduces` buffer, `joinPromiseRef` in
  `useZvonokConnection`.

## Goals / Non-Goals

**Goals:**

- Bandwidth proportional to visible tiles, not room size (viewport loop).
- Devices, permission state, and error semantics nicer for SDK consumers.
- One concurrency and logging vocabulary inside `@zvonok/client`.
- Deterministic join/leave ordering; bounded rejoin storms.

**Non-Goals:**


- Size-based spatial-layer refinement (tile dimensions). Visibility-only
  first; the tracker shape leaves room for dimensions later.
- RxJS or any reactive runtime dependency; we stay on external stores.
- Offline mode, call migration, ringing - rejected in the research doc.
- Server changes; the existing signalling contract is sufficient.
- SDK-side fresh-room-state fetch on recovery failure: the SDK has no REST
  client; the app already re-queries the room via react-query on failure.
  Recommendation 10 is therefore scope-limited to the rate limiter.

## Decisions

- **Viewport visibility is owned by the per-tile `useViewportQuality` hook**
  (IntersectionObserver at threshold 0.25 + ref state), which maps visibility
  to `setPreferredLayers(getVideoConsumerIdForUserId(userId), layer)` with an
  asymmetric debounce: promote immediately, demote after 400ms so scroll
  flaps do not spam signalling; unchanged layers are never re-requested, and
  a missing camera consumer (not yet subscribed, or the local tile) makes
  requests a no-op. Rationale for not storing `isViewportVisible` in
  `RoomTracker` as first sketched: `useParticipants` instantiates a tracker
  per consumer, so a flag written by one consumer's tracker would be
  invisible to the others - ambiguous shared state. The hook keeps the state
  where it is consumed; the sdk spec's visibility-tracking requirement is
  satisfied by the same hook (scenarios unchanged).
  The app additionally integrates visibility into its auto-quality engine
  (PeerQualityProvider): the engine is the single `setPreferredLayers` writer
  there and computes the target as `visible ? qualityLayer : 0`, reacting to
  visibility flips through a store subscription under the same 3s debounce.
  `RoomVideo` therefore feeds visibility via `usePeerViewport` instead of the
  SDK hook; `useViewportQuality` remains the SDK-side controller for
  consumers without a quality engine (the prebuilt room).
- **Device preferences**: `packages/client/src/media/device-preferences.ts`
  owns a namespaced `zvonok:device-preferences` localStorage record
  `{ video: { deviceId }, audio: { deviceId, muted } }` with private-mode
  guards. `MediaCapture` records the id after a successful `start()` and
  `MediaStreamManager.start()` consults preferences when no explicit id is
  passed. Muted intent is recorded on explicit user mute toggles at the
  manager level, not derived from track state.
- **Permissions**: `useDevicePermissions(kind)` wraps `queryPermission` and
  subscribes to `PermissionStatus.onchange`, re-querying on window focus as a
  fallback for engines with flaky change events. Unavailable API or name ->
  `'unknown'`, never a throw.
- **Concurrency helpers**: minimal `packages/client/src/helpers/concurrency.ts`
  with `singleFlight`, `withoutConcurrency`, `hasPending` (~40 lines total;
  same semantics as the researched helpers, without `withCancellation` which
  nothing needs yet). Refactor the four ad-hoc sites onto them; the
  `pendingLocalProduces` buffer stays as-is (it is a queue, not a lock).
- **Logger**: `packages/client/src/helpers/logger.ts` -
  `createLogger(scope)` returning level-gated debug/info/warn/error; default
  level `warn`; override via `localStorage['zvonok:log-level']` or
  `VITE_ZVONOK_LOG`. Sweep the five `console.log` call sites in
  `sfu/manager.ts`.
- **Join/leave exclusion**: a monotonically increasing `leaveGeneration`
  counter in `useZvonokConnection`; `join()` captures it and aborts its
  session updates when superseded by a `leave()`; `leave()` during an
  in-flight join still tears the manager down deterministically.
- **Recoverable errors**: `ZvonokError` gains `recoverable: boolean`;
  `packages/react/src/errors.ts` centralizes the code -> recoverable map
  (`ROOM_TOKEN_EXPIRED` recoverable, `ROOM_LOCKED`, `ROOM_TOKEN_INVALID`,
  `ROOM_ENDED`, kicked -> terminal). `useZvonokConnection` consults the flag
  instead of implicit knowledge.
- **Rejoin rate limiting**: sliding-window limiter in `SfuManager` recovery
  path (max 5 rejoins per 30s); exceeding it fails recovery with the existing
  `RECONNECT_EXHAUSTED` typed error instead of looping.
- **Identity-stable participants array**: `RoomTracker.recompute()` keeps the
  previous array reference when the new array is shallow-identical (same
  length, same participant references), so mute flips do not invalidate the
  array for memoized consumers.
- **`ensureExhausted`**: 3-line `never`-narrowing helper in
  `packages/client/src/helpers/exhausted.ts`, applied to the
  `SfuMediaSource`/`CaptureState` switches.

## Risks / Trade-offs

- Hidden-tile downgrades reduce quality for picture-in-picture-style layouts
  if a consumer misuses visibility; mitigated by the unobserved-equals-visible
  default.
- `PermissionStatus.onchange` coverage varies by engine; the focus re-query
  fallback trades a small poll for correctness.
- Refactoring live concurrency sites is behavior-sensitive; each site keeps
  its existing semantics and is covered by the current suites before/after.
