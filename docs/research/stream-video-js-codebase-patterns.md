# stream-video-js source-code patterns → zvonok improvements

Source-level companion to [sdk-platform-comparison-getstream.md](./sdk-platform-comparison-getstream.md) (which covers the API/docs surface). Compiled 2026-09-13 from the GetStream/stream-video-js monorepo at commit `57f23a1` (branch `main`, 2.0.0-beta era, shallow clone at `/tmp/stream-video-js`): read `packages/client/src` (store/, Call.ts, rtc/, helpers/, devices/, sorting/, errors/, logger.ts, StreamSfuClient.ts), `packages/react-bindings/src/hooks`, and representative `packages/react-sdk/src` rendering code. Every stream-video-js claim cites `file#Lx-Ly` inside that repo; every zvonok claim cites our repo. Recommendations are marked **adopt** / **adapt** / **skip**, with effort (S/M/L) and risk.

---

## 1. State store architecture

### 1.1 Observable-per-field store with derived, multicast slices

**They do:** `CallState` holds one private `BehaviorSubject` per state field (30+ fields, `store/CallState.ts#L92-L121`), exposes them as observables, and builds *derived* observables on top: `participants$` sorts the raw array, `localParticipant$`/`remoteParticipants$`/`pinnedParticipants$`/`dominantSpeaker$`/`hasOngoingScreenShare$` are `shared(...)` pipelines over it (`store/CallState.ts#L214-L252`). `shared()` is `shareReplay({bufferSize:1, refCount:true})` — each derived pipeline runs at most once per source emission regardless of subscriber count, and goes cold when unobserved (`store/subjects.ts#L29-L30`). Scalar fields get `distinctUntilChanged` via the `duc()` helper (`store/subjects.ts#L20-L23`); arrays get a shallow comparator `isShallowArrayEqual` (`store/rxUtils.ts#L17-L26`).

A telling detail: because `shareReplay(refCount)` pipelines go cold with no subscribers, synchronous consumers must bypass the pipeline — hence `getParticipantsSnapshot()` reading the subject directly, documented as avoiding "timing issues from shareReplay/refCount" (`store/CallState.ts#L501-L511`), and `TrackSubscriptionManager.subscriptions` using it for the same reason (`helpers/TrackSubscriptionManager.ts#L147-L149`).

**We do:** one snapshot object per store. `RoomTracker` keeps a `Map` of participants and rebuilds a single `{participants, locked, mutedByHost}` snapshot on any event (`packages/react/src/room-tracker.ts#L335-L352`); `getSnapshot` returns the stable reference between mutations (`packages/react/src/room-tracker.ts#L157-L158`). React consumption is selector-based via `useSyncExternalStore` + shallow compare (`packages/react/src/use-store-selector.ts#L21-L86`), so a component re-renders only when its slice changes. Per-participant object references are preserved for untouched participants (`packages/react/src/room-tracker.ts#L35-L55`), matching what their `updateParticipant` achieves by `map`-ing only the patched entry (`store/CallState.ts#L779-L801`).

**Recommendation: skip the RxJS machinery, adopt the shape.** We deliberately have no RxJS dependency, and our external-store + selector design already delivers the same consumer-level guarantee (slice-level re-renders). Their own `getParticipantsSnapshot` escape hatch (`store/CallState.ts#L501-L511`) is evidence that the shareReplay pipeline creates a second source of truth they must design around — our synchronous snapshot avoids that class of bug entirely. Two cheap adoptions from their design:
- **Derived sorted participants as a cached, reference-stable value.** They sort in place and re-emit the *same array* to keep identity (`store/CallState.ts#L217-L222`, comment on L219). Our `recompute()` rebuilds the participants array on every event including per-track mute flips (`room-tracker.ts#L343-L352`); consumers like `useParticipants` then re-run selectors on every event (`packages/react/src/use-participants.ts#L25-L28`). At our scale this is cheap, but if the grid grows, computing a sorted array only when membership/order actually changes (identity-check before notify) is the adaptation. Effort **S**, risk low.

### 1.2 Event-handler maps dispatching into state

**They do:** all coordinator events funnel through `updateFromEvent` → a lookup map built in the constructor, typed with `satisfies CallStateEventHandlers` (`store/CallState.ts#L319-L393`, dispatcher at `L904-L909`). Each handler is a tiny pure-ish state mutation.

**We do:** the same shape in `SfuManager.createEventHandlers` — a typed `SfuEventHandlers` object mapping every server event to a handler (`packages/client/src/sfu/manager.ts#L190-L231`). **Already implemented** — no action.

### 1.3 CallingState machine

**They do:** an explicit 10-state enum including `RECONNECTING`, `MIGRATING`, `RECONNECTING_FAILED`, `OFFLINE` (`store/CallingState.ts#L4-L55`); every lifecycle branch guards on it.

**We do:** `SfuState.connectionState` with `disconnected | connecting | connected | reconnecting | failed` (`packages/client/src/sfu/manager.ts#L136-L145`) plus terminal outcomes surfaced as typed errors and flags in the React layer (`packages/react/src/use-zvonok-connection.ts#L234-L296`). `MIGRATING` has no mediasoup equivalent today; `OFFLINE` (deliberate offline queueing) is a feature we don't have. **Skip** until offline mode becomes a requirement. Effort n/a.

### 1.4 `Patch<T>` value-or-function updates

**They do:** every setter accepts `T | (current) => T` (`store/rxUtils.ts#L11`, used throughout `store/CallState.ts`). **We do:** `RoomTracker.update` takes an updater function only (`room-tracker.ts#L335-L341`). **Skip** — the function-only form is strictly more regular; the dual form exists to serve their Rx operator plumbing.

---

## 2. Call lifecycle & reconnection

### 2.1 Named concurrency primitives instead of ad-hoc promise chains

**They do:** three tiny primitives in `helpers/concurrency.ts`: `withoutConcurrency(tag, fn)` serializes async ops by chaining promises on a shared tag map (`L26`, `L94-L105`), `singleFlight(fn)` lets concurrent callers share the in-flight promise (`L55-L70`), and `hasPending(tag)` lets callers check and bail (`L72-L74`). Usage is pervasive and precise: `join` is `singleFlight`-wrapped (`Call.ts#L1136`), reconnect dedupes redundant triggers with `hasPending` before entering `withoutConcurrency` (`Call.ts#L1866-L1872`), every SFU-event handler on a peer connection is serialized per-event-type with a per-instance lock key (`rtc/BasePeerConnection.ts#L211-L233`), and publisher track ops serialize on a transceiver lock (`rtc/Publisher.ts#L106-L136`, `L241-L276`).

**We do:** the same ideas, hand-rolled three times: `replaceChains` promise-chaining per track kind (`packages/client/src/sfu/manager.ts#L112-L115`), `producingInProgress` map deduplicating produce calls (`manager.ts#L111`), `pendingLocalProduces` buffering (`manager.ts#L125-L133`), and join single-flight via `joinPromiseRef` in the hook (`packages/react/src/use-zvonok-connection.ts#L172-L175`, `L227-L230`).

**Recommendation: adopt.** Extract ~40-line `singleFlight`/`withoutConcurrency`/`hasPending` helpers into `@zvonok/client` and refactor the four ad-hoc mechanisms onto them. Removes duplicated concurrency reasoning and makes the invariants greppable. Effort **S**, risk low (mechanical, behavior-preserving).

### 2.2 Layered reconnect with budgets and strategy downgrade

**They do:** a reconnect state machine (`Call.ts#L1853-L2083`): guard on calling state (`L1858-L1864`), dedupe redundant triggers (`L1866-L1870`), then a do-while loop that (a) waits for network availability (`L1953`), (b) enforces a disconnection deadline (`L1919-L1930`), (c) rate-limits REJOIN/MIGRATE transitions with a sliding-window limiter — FAST excluded because it issues no backend join (`L1932-L1943`, limiter at `L323`), (d) counts ICE-never-connected failures toward a give-up threshold (`L1905-L1915`), (e) downgrades FAST→REJOIN based on elapsed time / attempt count / peer health (`L2045-L2069`), (f) backs off with jitter capped at 5s (`L2046`, `coordinator/connection/utils.ts#L45-L50`), and (g) tracks per-SFU join failures to steer away from bad nodes via `migrating_from` (`L1185-L1229` for join, `L2004-L2016` for rejoin). Giving up fetches fresh call state before declaring `RECONNECTING_FAILED` (`L1878-L1886`).

**We do:** socket.io's built-in reconnection (10 attempts, 1s→5s backoff — `packages/client/src/sfu/connection.ts#L37-L44`) plus an automatic rejoin pipeline: on mid-session reconnect the manager replays the retained join payload (`packages/client/src/sfu/manager.ts#L908-L918`), holds live local tracks and produce intents across the blip (`manager.ts#L939-L961`), replays them after the join ack (`manager.ts#L963-L974`), and converts socket.io `reconnect_failed` into a typed `RECONNECT_EXHAUSTED` error (`manager.ts#L976-L988`). Token refresh is attempted once per rejoin (`manager.ts#L181`).

**Recommendation: adapt, selectively.** Our single-strategy replay is the right simplicity for a first-party mediasoup stack — no MIGRATE, no per-SFU blacklisting. Worth adopting: (a) the **one-token-refresh-per-rejoin budget exists, but rejoin attempts themselves are unbounded in app-space** — if the socket flaps faster than socket.io's attempt budget consumes, join replays repeat; a rejoin rate limiter mirroring theirs is a cheap guard if flapping shows up in practice. Effort **S** when needed; (b) their give-up path fetches fresh room state before declaring failure (`Call.ts#L1878-L1886`) — our `failRecovery` path could do the same so the UI reflects server truth after a lost blip (`manager.ts#L976-L988`). Effort **S**, risk low. Otherwise **skip** the strategy matrix.

### 2.3 Signalling health watchdog

**They do:** the SFU client pings every 5s and declares the connection unhealthy after 12s of silence (2 pings + 2s slack), checked on a 4s interval; the close is flagged non-clean and drives reconnection (`StreamSfuClient.ts#L180-L185`, `L727-L743`, `L398-L417`). A one-shot latch (`signalClosed`, `L168-L174`, `L389-L396`) ensures the watchdog and a wedged socket's late `close` event can't both trigger revival.

**We do:** rely on socket.io's protocol-level heartbeat (`connection.ts#L37-L44`); dead-socket detection is delegated to the transport.

**Recommendation: skip for now.** socket.io's ping/pong already provides liveness detection; their watchdog exists because they own a raw WebSocket. If we ever see "connected but silent" zombies, revisit. Note their latch pattern (idempotent close handling) is transferable — our `connect()` already guards double-registration for the same reason (`manager.ts#L234-L249`). **Already implemented** in spirit.

### 2.4 Ordered teardown

**They do:** `leave()` runs a strict ordering under a join/leave lock: pause ring watchdogs *before the first await* to close a race (`Call.ts#L698-L708`), wait for an in-flight JOINING to settle (`L719-L728`), flush final stats from live peer connections before disposing them (`L765-L769`), dispose subscriber → publisher → SFU client → subscription manager → dynascale (`L772-L790`), only then reset state (`L792-L794`), reset reconnect accumulators with a comment explaining the stale-`ReconnectDetails` bug this prevents (`L796-L808`), run registered leave hooks (`L810-L812`), stop device managers, stop local tracks in parallel per `stopOnLeave` policy (`L833-L843`), and dispose the per-call media engine last (`L845-L860`).

**We do:** `leaveRoom()` = emit `sfu:leave` → `clearSession()` → `closeAll()` (`manager.ts#L291-L298`); `disconnect()` = stop stats → teardown router → `closeAll()` → socket disconnect → reset (`manager.ts#L251-L257`); the hook's `leave` additionally detaches listeners and clears the session (`use-zvonok-connection.ts#L158-L170`). Ordering is sane but implicit.

**Recommendation: adapt.** Not the code — the discipline: our retained-produces feature means teardown order now matters more (retained tracks must not be stopped by `closeAll` during a *reconnect*, and must be stopped on *leave*; that distinction lives in `retainLocalProduces` vs `leaveRoom` — `manager.ts#L939-L961` vs `L291-L298`). A short ordered-teardown comment block on `leaveRoom` (or a regression test leaving mid-reconnect) is cheap insurance. Effort **S**, risk low.

### 2.5 Leave/join race hardening

**They do:** a `leaveGeneration` counter snapshots into the join flow so a superseded join knows to abort (`Call.ts#L717`, `L1255-L1257`); `leave()` during `JOINING` waits for the join to settle rather than racing it (`Call.ts#L719-L728`); a superseded SFU client's late `onclose` is ignored — only the *current* client's death may trigger reconnect (`Call.ts#L1813-L1816`).

**We do:** no generation counter. `leave()` tears down and nulls the manager (`use-zvonok-connection.ts#L158-L170`) while an in-flight join attempt can still be awaiting `ack.promise` — the ack waiter cleans its socket listeners on failure (`use-zvonok-connection.ts#L107-L134`), so the window is small, but `join` and `leave` are not mutually serialized.

**Recommendation: adopt (small).** A `leaveGeneration`-style guard (or reusing the 2.1 `withoutConcurrency` tag for join+leave) so a `leave()` during `join()` deterministically supersedes it. Effort **M**, risk low-medium (touches the hottest path; needs a targeted test).

---

## 3. React bindings & rendering performance

### 3.1 Binding layer

**They do:** `useObservableValue` = one `useState` + one `useEffect` subscription per observable (`react-bindings/src/hooks/useObservableValue.ts#L11-L32`), wrapped by ~40 thin per-field hooks (`react-bindings/src/hooks/callStateHooks.ts#L39-L361`). `useEffectEvent` shims React's effect-event until stable (`react-bindings/src/hooks/useEffectEvent.ts#L3-L16`).

**We do:** `useStoreSelector` over `useSyncExternalStore` with a `[snapshot, selected]` cache and shallow compare (`packages/react/src/use-store-selector.ts#L38-L67`) — one subscription per store per component, selector-level granularity. Frozen module-scope fallbacks keep hook deps stable (`room-tracker.ts#L22-L26`, `use-audio-activity.ts#L25-L28`), matching their `AUTOPLAY_BLOCKED$`/`EMPTY_*` discipline (`callStateHooks.ts#L24-L27`, `L512-L516`, `L536`). **Already implemented** (our approach is the stream-chat-react `useStateStore` design, which they lack); **skip** their hook.

One micro-adopt: their hooks guard against *unstable default observables* by hoisting them to module scope (`callStateHooks.ts#L512-L516`). Our selectors that return fresh objects — e.g. `selectActiveSpeaker` (`use-audio-activity.ts#L226-L228`) — already rely on our `shallowEqual` to stay stable (`use-store-selector.ts#L57-L59`); that's fine, but it's worth a doc-comment on `useStoreSelector` that fresh-object selectors are safe *only* because of the shallow-compare cache (currently stated in the header comment, `use-store-selector.ts#L1-L9` — **already implemented**).

### 3.2 The dynascale loop — viewport-driven track quality (their flagship perf pattern)

**They do:** a closed loop from DOM visibility to SFU bandwidth:
1. `ViewportTracker` observes participant tiles with an `IntersectionObserver` (threshold 0.35) and writes `viewportVisibilityState` into participant state, resetting to `UNKNOWN` on unobserve so runtime layout switches keep working (`helpers/ViewportTracker.ts#L4`, `L121-L166`).
2. `DynascaleManager.bindVideoElement` (one call per attached `<video>`, `Call.ts#L3480-L3485`) subscribes a *per-session* participant slice (`helpers/DynascaleManager.ts#L128-L133`) and: ignores 0×0 dimensions as implicit unsubscription (`L110-L126`), requests dimensions on visibility change (`L143-L172`), uses a `ResizeObserver` with **asymmetric debouncing** — upscale faster (`IMMEDIATE` when delta >1.2), downscale slower (`L197-L213`), re-requests `IMMEDIATE` when the remote starts publishing (`L215-L237`).
3. All requests land in `CallState.updateParticipantTracks` (`store/CallState.ts#L868-L895`) and `TrackSubscriptionManager.apply` coalesces them into one SFU `updateSubscriptions` RPC under three debounce tiers (`helpers/TrackSubscriptionManager.ts#L223-L242`).
4. The SFU then sends only the visible, correctly-sized spatial layers.

Net effect: an N-tile grid consumes bandwidth proportional to what's on screen, not what's in the room.

**We do:** the manager already has the actuator — `setPreferredLayers` and per-peer consumer lookup (`packages/client/src/sfu/manager.ts#L803-L832`) — and simulcast layers are configured at publish (`manager.ts#L70-L84`). But nothing drives them from the viewport: `RoomVideo` renders whatever stream the tracker hands it, always (`apps/client/src/features/room/components/room-video.tsx#L17-L61`), and the video grid is a static wrapper (`apps/client/src/components/video-grid.tsx#L3-L33`).

**Recommendation: adopt (adapted).** Build the loop with our pieces: an `IntersectionObserver` hook in `@zvonok/react` writing a visibility bit per participant into `RoomTracker`, a `ResizeObserver` for tile size, and a small controller mapping `visible × tileSize` → `getVideoConsumerIdForUserId(userId)` → `setPreferredLayers(consumerId, spatialLayer)` through the existing manager API. Start with visibility-only (tiles fully off-screen → prefer layer 0), add size-based selection later. Effort **M** (needs server confirmation that `setPreferredLayers` on a paused/consumer is honored and idempotent), risk **M** (coordinate with server; degrade to no-op on denial). Expected impact: the largest single bandwidth/CPU win available to us for multi-party rooms.

### 3.3 Video element binding details

**They do:** element binding is delegated to the client, not scattered through components: `Video.tsx` hands the element to `call.bindVideoElement` via a state-ref (`core/components/Video/Video.tsx#L109-L132`), and the client side diffs before assigning (`if (videoElement.srcObject === source) return; videoElement.srcObject = source ?? null`), forces `autoplay/playsInline/muted` for autoplay-policy compliance, and re-assigns + re-`play()`s on a 25ms timer for Safari/Firefox (`helpers/DynascaleManager.ts#L239-L270`). A `MediaPlaybackWatchdog` detects stalled playback (`L247-L251`).

**We do:** a per-component `useEffect` assigning `srcObject` when `stream` is truthy — `local-video.tsx#L16-L20`, `room-video.tsx#L28-L32`, same pattern in the prebuilt tile (`packages/react/src/prebuilt/ZvonokRoom.tsx#L80-L87`). Consequences: (a) when `stream` flips to `null` the previous `srcObject` stays attached (stale-frame decode work continues; currently masked by the audio overlay in `room-video.tsx#L45`); (b) no `play()` failure handling — a blocked autoplay silently shows a frozen poster.

**Recommendation: adopt (small, concrete).** In the shared video components: assign `element.srcObject = stream` unconditionally (null clears), and catch/retry `play()` like theirs. A tiny shared `useVideoStream(ref, stream)` hook in the app (or `@zvonok/react`) removes the triplication. Effort **S**, risk low. The full client-side `bindVideoElement` architecture (binding in the client package) is **skip** — our components are three small elements, not a framework.

### 3.4 List rendering: memoization, hard limits, stable sorting

**They do:** `ParticipantView` is `memo(forwardRef(...))` (`core/components/ParticipantView/ParticipantView.tsx#L74-L78`) — justified because participant objects keep stable references except when patched (`store/CallState.ts#L779-L801`). Paginated layouts compute how many tiles fit via a one-shot `ResizeObserver` (`core/hooks/useCalculateHardLimit.ts#L22-L69`), and sorting presets apply reordering comparators *only when someone is invisible*, keeping visible-participant order stable (`sorting/presets.ts#L20-L37`, `L52-L65`).

**We do:** `RoomVideo` is a plain function component (`room-video.tsx#L17`); any room-snapshot change re-renders every tile. Speaker-highlight rings already avoid prop-driven churn (`video-grid.tsx#L15-L33`).

**Recommendation: adopt.** Wrap `RoomVideo` (and the prebuilt `RoomTile`) in `React.memo` — safe today because `RoomTracker` preserves per-participant references (`room-tracker.ts#L35-L55`) — and keep that reference-stability invariant documented in `RoomTracker`. Their invisible-stability trick is worth stealing the idea of when we add active-speaker reordering: only reorder *below* the visible fold, or user-visible tiles will jump. Effort **S**, risk low.

---

## 4. Device & media management

### 4.1 Optimistic device status

**They do:** device managers carry two statuses — actual and *optimistic*; `enable()`/`disable()` set the optimistic value up front, run under a cancellable concurrency tag, and settle the optimistic value in `finally` unless the request was aborted by a newer toggle (`devices/DeviceManagerState.ts#L15-L18`, `L59-L66`; `devices/DeviceManager.ts#L270-L319`, cancellation via `withCancellation` from `helpers/concurrency.ts#L44`). The React layer projects both into `isTogglePending`/`optionsAwareIsMute` (`react-bindings/src/hooks/callStateHooks.ts#L568-L591`).

**We do:** `CaptureState.STARTING` plays the pending role (`packages/client/src/media/capture-state.ts#L1-L14`), and concurrent `start()` calls are superseded by a request-generation counter — a stale `getUserMedia` result is detected and its tracks stopped (`packages/client/src/media/capture.ts#L51`, `L59-L62`, `L87`, `L101`). **Already implemented** at the core level. Optional polish: surface an explicit `isTogglePending` boolean in `useDeviceControls` for button disabled-states (adapt, **S**).

### 4.2 Device preference persistence

**They do:** localStorage-persisted per-kind device preferences (selected id + muted flag) with availability guards and a namespaced storage key (`devices/devicePersistence.ts#L4-L30`, `L62-L102`), applied by the device managers; the React-SDK hook of the same purpose is a deprecated no-op that defers to the client's `devicePreferences` API (`react-sdk/src/hooks/usePersistedDevicePreferences.ts#L8-L16`).

**We do:** `deviceId` is tracked in memory per capture (`capture.ts#L12`); no persistence layer exists (`media/device-service.ts` is a 20-line getUserMedia wrapper).

**Recommendation: adopt.** Remember last camera/mic (and mute state) under a `zvonok:` key, applied as the default `deviceId` on first capture. High user-visible DX per line of code. Effort **S**, risk low (guard private-mode localStorage like theirs, `devicePersistence.ts#L32-L33`).

### 4.3 Reactive permission state

**They do:** browser permission is a reactive observable per device (granted / denied / prompting), wired into device manager state (`devices/DeviceManagerState.ts#L74-L115`).

**We do:** post-hoc classification of capture failures into `CaptureState` with recoverability and human-readable reasons (`packages/client/src/media/error-classifier.ts#L13-L67`, states `capture-state.ts#L1-L28`) — good messages, but only discovered after a failed `getUserMedia`.

**Recommendation: adapt.** `navigator.permissions.query({name:'camera'/'microphone'})` + `onchange` feeding the pre-join UI is a UX upgrade (show *why* capture is blocked before attempting). Effort **M**, risk low. Their `disableMode` (`stop-tracks` vs `disable-tracks`, `DeviceManagerState.ts#L12`, `L91`) — trading release-hardware vs instant-unmute — is a later refinement; **skip** for now.

### 4.4 Encoder/sender hygiene

**They do:** publish-quality changes diff encoder params and skip `setParameters` entirely when nothing changed (`rtc/Publisher.ts#L395-L400`, `L446-L450`); a `refreshTrack` re-attaches a live track to kick a dead WebKit encoder without renegotiation (`Publisher.ts#L295-L325`); negotiation reads announced mids only after `setLocalDescription`, with a comment documenting the SFU codec-correlation failure mode (`Publisher.ts#L479-L489`); subscriber negotiation rolls back `setRemoteDescription` on failure and rewinds the ICE-trickle generation (`rtc/Subscriber.ts#L234-L278`).

**We do:** mediasoup-client owns the offer/answer and encoding lifecycle; our `replaceTrack` is serialized per kind (`manager.ts#L112-L115`, `L761-L783`).

**Recommendation: skip the negotiation internals** (mediasoup's contract replaces them). **Adapt** one thing if not already handled server-side: the "encoder stops producing RTP while track is live and unmuted" WebKit quirk is real; a `refreshTrack`-style restart (pause+resume producer, or `replaceTrack` with the same track) is a known remedy worth having in the back pocket. Effort **S** when the bug appears.

---

## 5. Typing & error DX

### 5.1 Exhaustiveness and `satisfies`

**They do:** `satisfies` on the event-handler map (`store/CallState.ts#L393`) and an `ensureExhausted` helper for switch arms (`store/CallState.ts#L1206`). **We do:** the handler map is already interface-typed (`manager.ts#L204-L231`), and error codes are discriminated unions (`packages/react/src/errors.ts#L30-L99`). A 3-line `ensureExhausted(value: never)` helper is a minor **adopt** (**S**) for the `switch`es over `SfuMediaSource`/`CaptureState` families.

### 5.2 Recoverable vs unrecoverable errors driving control flow

**They do:** `SfuJoinError` inspects the server's requested `reconnectStrategy` to flag itself `unrecoverable` (`errors/SfuJoinError.ts#L7-L16`); join retry loops rethrow unrecoverable errors immediately and only count the rest toward retry budgets (`Call.ts#L1202-L1207`), and the reconnect loop distinguishes unrecoverable coordinator errors from retryable ones (`Call.ts#L2026-L2033`).

**We do:** `ZvonokJoinError`/`ZvonokHostError`/`ZvonokEgressError` carry stable codes (`packages/react/src/errors.ts#L9-L99`) — good — but nothing declares whether a code is retryable; retry decisions are implicit in manager internals (e.g. one token-refresh attempt, `manager.ts#L181`).

**Recommendation: adapt.** Add a `recoverable: boolean` (or a `RetryPolicy` union) to `ZvonokError`, centralize which server codes are retryable (`ROOM_TOKEN_EXPIRED` → retry-with-refresh; `ROOM_LOCKED`/`ROOM_TOKEN_INVALID` → terminal), and have `useZvonokConnection` consult it. Effort **S**, risk low.

### 5.3 Scoped logging

**They do:** a logger system with per-module scoped loggers, levels, and sinks (`logger.ts#L46`, `ScopedLogger` at `L41`), with platform quirks centralized in one sink (RN: demote error/warn to `console.info`, `logger.ts#L5-L36`). Log calls are pervasive and level-disciplined (e.g. `Call.ts#L1195`, `L1201`, `rtc/Dispatcher.ts#L91`).

**We do:** raw `console.log` scattered in the core package (`packages/client/src/sfu/manager.ts#L909`, `L921`, `L966-L970`, `L977`, `L991`).

**Recommendation: adopt.** A ~30-line level-gated scoped logger (namespaced prefixes, `localStorage` override, production-silent by default) and sweep the console calls. Immediate payoff when debugging SFU flows in production. Effort **S**, risk low.

---

## 6. Misc code style worth noting

- **Knowledge-bearing comments on non-obvious invariants.** Their best comments encode hard-won browser/SFU behavior: stale `ReconnectDetails` after give-up-leave (`Call.ts#L796-L808`), mid-association timing in SDP (`rtc/Publisher.ts#L479-L489`), self-sub audio echo default-mute (`rtc/Subscriber.ts#L176-L181`), `pc.close()` not raising `ended` → orphaned-track leak (`store/CallState.ts#L1001-L1011`). Our codebase already does this well (e.g. token-room-id verification `manager.ts#L278-L284`, phantom-participant guards `room-tracker.ts#L292-L312`). **Already implemented** as a culture; keep it.
- **Resource-leak accounting for `MediaStreamTrack`/receiver lifecycles.** Their orphaned-track registry exists purely because `pc.close()` doesn't fire `ended` (`store/CallState.ts#L305-L311`, `L985-L1031`; subscriber-side registration `rtc/Subscriber.ts#L151-L163`). Our equivalent surface is consumer-close handling in `handleConsumerClosed` and tracker `onended` cleanup (`room-tracker.ts#L224-L229`) — covered. **No action.**
- **In-place stable sort to preserve array identity** (`store/CallState.ts#L217-L222`) — noted in §1.1; cheap trick to remember.
- **Jittered, capped retry backoff** (`coordinator/connection/utils.ts#L45-L50`) — relevant if we ever hand-roll retries; socket.io covers us today.
- **Stats cadence parity:** their call-stats reporting defaults to 2000ms (`Call.ts#L299`); our collector defaults to the same (`packages/client/src/sfu/stats-collector.ts#L34`). Their leave-path flushes a final sample from live transports before disposal (`Call.ts#L765-L769`) — a nice touch if we ever send stats upstream; we only consume locally today.

---

## 7. Prioritized recommendations

| # | Theme | Recommendation | Effort | Risk | Expected impact |
|---|-------|----------------|--------|------|-----------------|
| 1 | Rendering perf | Viewport-driven track quality: IntersectionObserver + tile size → `setPreferredLayers` through existing manager API (§3.2) | M | M | High — bandwidth/CPU scale with visible tiles, not room size |
| 2 | Rendering perf | `React.memo` on `RoomVideo`/`RoomTile` + document the participant reference-stability invariant (§3.4) | S | Low | Medium — eliminates whole-grid re-renders on every room event |
| 3 | Rendering perf | `useVideoStream`: unconditional `srcObject` assignment (null clears) + `play()` failure retry (§3.3) | S | Low | Medium — removes stale-frame decode work and blocked-autoplay freeze |
| 4 | DX | `singleFlight`/`withoutConcurrency`/`hasPending` helpers; refactor `replaceChains`, `producingInProgress`, join single-flight onto them (§2.1) | S | Low | Medium — one concurrency vocabulary instead of four ad-hoc ones |
| 5 | DX | Scoped, level-gated logger; sweep `console.log` from core (§5.3) | S | Low | Medium — debuggable production SFU flows |
| 6 | UX | Device preference persistence (last camera/mic + mute state) in localStorage (§4.2) | S | Low | Medium — "it remembers my device" is high-visibility polish |
| 7 | Correctness | Join/leave mutual exclusion (leave-generation or shared concurrency tag) (§2.5) | M | Low-Med | Medium — deterministic teardown during in-flight join |
| 8 | Error DX | `recoverable` flag on `ZvonokError` + centralized retry policy per server code (§5.2) | S | Low | Medium — consistent retry behavior across join/host/egress paths |
| 9 | UX | Reactive `navigator.permissions` state feeding pre-join UI (§4.3) | M | Low | Medium — explains blocked devices before attempting capture |
| 10 | Robustness | Rejoin rate-limit + fetch-fresh-state on recovery failure (§2.2) | S | Low | Low-Med — insurance against socket flapping storms |
| 11 | Perf (deferred) | Cached, identity-stable sorted participants in `RoomTracker` (§1.1) | S | Low | Low now; grows with participant count |
| 12 | Typing | `ensureExhausted` helper for discriminated-union switches (§5.1) | S | Low | Small compile-time safety net |

---

## 8. Not worth adopting

- **The RxJS observable-per-field store** (`store/CallState.ts`, `store/subjects.ts`, `store/rxUtils.ts`). It's well-executed, but it drags a runtime dependency and forces workarounds for pipeline cold-start (`getParticipantsSnapshot`, `store/CallState.ts#L501-L511`) that our synchronous external-store design doesn't have. `useSyncExternalStore` + selectors delivers the same consumer contract (§1.1, §3.1).
- **Their raw-WebSocket + protobuf SFU protocol layer** (`StreamSfuClient.ts`, `rtc/Dispatcher.ts`, `gen/video/sfu/`). We use socket.io + mediasoup; the tag-scoped `Dispatcher` exists to multiplex events across peer-connection *instances* (`rtc/Dispatcher.ts#L74-L99`), a problem our single `SfuManager` + typed `SfuEventHandlers` map doesn't have (`manager.ts#L190-L231`).
- **FAST/REJOIN/MIGRATE strategy matrix and SFU migration** (`Call.ts#L2089-L2196`, `StreamSfuClient.ts#L585-L608`). Migration is infrastructure their backend performs server-side; our first-party mediasoup stack has no node handoff to negotiate. Our single replay pipeline (§2.2) is the right scope.
- **Ringing subsystem** (`ringing/`, ring timeouts/pollers, auto-drop effects `Call.ts#L519-L555`, ring state polling `Call.ts#L1073-L1089` region). We have no ringing call product yet; adopting its scaffolding now would be speculative weight.
- **Closed-captions timed queue** (`store/CallState.ts#L1354-L1390`) and **E2EE insertable-streams machinery** (`rtc/e2ee/`). Features we don't ship; the patterns (timed queue with cleanup-on-dispose) are generic and already idiomatic for us.
- **`useObservableValue` binding style** (§3.1). N-hooks-per-component subscription fan-out is strictly coarser than our selector approach.
- **Their `Call` god-class shape** — `Call.ts` is 3,720 lines absorbing join, reconnect, publish, ringing, stats, and reporting. Our split (`sfu/manager.ts` facade + `connection`/`event-router`/`stats-collector`, `media/`, `audio/`) is closer to their `rtc/` + `helpers/` decomposition and is the thing to preserve; the useful lesson from their codebase is *which* collaborators they extracted (§2, §4), not the umbrella class.
- **Client-side WebAudio playback graph in `DynascaleManager`** (`DynascaleManager.ts#L284-L463`). We already route remote audio through `remote-audio-mixer` (`packages/client/src/audio/remote-audio-mixer.ts`) with an explicit graph; duplicating that plumbing inside the client package would blur ownership.
