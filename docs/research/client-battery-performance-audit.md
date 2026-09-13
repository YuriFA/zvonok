# Client battery & performance audit: stream-video-js reference → zvonok hotspots

Compiled 2026-09-13. Goal: reduce client power drain and memory pressure, especially for phone users, in our WebRTC stack (mediasoup SFU + React).

Sources:
- **Their side:** GetStream/stream-video-js `main` @ `57f23a1`, read by a background research agent against raw.githubusercontent sources and getstream.io docs. Their claims cite `path/to/file.ts#Lx` in that repo; claims marked *(scout)* were verified there, not by direct clone reads here. Cross-checked where they overlap with [stream-video-js-codebase-patterns.md](./stream-video-js-codebase-patterns.md) (which was compiled from a direct clone of the same commit).
- **Our side:** every zvonok claim cites `file#Lx-Ly` in this repo, read directly.

Companion docs: [stream-video-js-codebase-patterns.md](./stream-video-js-codebase-patterns.md) (architecture/API-surface comparison, perf recommendations 1-3 remain open and overlap with this audit), [sdk-platform-comparison-getstream.md](./sdk-platform-comparison-getstream.md).

---

## 1. How stream-video-js manages power (reference model)

### 1.1 Offscreen video is dropped SFU-side, not locally paused
IntersectionObserver on each tile (`ViewportTracker`, threshold 0.35) writes `viewportVisibilityState` into participant state and resets it to `UNKNOWN` on cleanup *(scout)*. `DynascaleManager.bindVideoElement` maps `INVISIBLE` or 0x0 size to a dimension-less request = **unsubscription**; `TrackSubscriptionManager.apply` debounces (20/100/600/1200 ms tiers) and coalesces into one `updateSubscriptions` RPC, so the SFU stops sending video for offscreen participants - there is nothing to decode locally *(scout)*. React-side, `Video.tsx` renders a placeholder for `INVISIBLE`, removing the element from the DOM (`packages/react-sdk/src/core/components/Video/Video.tsx#L175-L179`) *(scout)*. This is the same dynascale pipeline documented in our prior research §3.2.

### 1.2 Page Visibility: not handled on web
No `visibilitychange`/`document.hidden` handling exists in their client or react-sdk *(scout)*. Their offscreen suppression is purely layout-based. On mobile they instead disable capture at the OS layer: **iOS backgrounds disable local video by default** (`shouldDisableIOSLocalVideoOnBackgroundRef = { current: true }`) *(scout)*, and Android keeps calls alive via a foreground service - including a fixed RN headless-task bug that previously pinned the timer choreographer for the process lifetime *(scout)*.

### 1.3 Audio levels come from the SFU, not client DSP
Remote levels arrive as a WebSocket `audioLevelChanged` event written into participant state; the client runs **no per-participant AnalyserNodes** *(scout)*. The only local WebAudio is a mic-fault detector: one AudioContext polled at 350 ms that **auto-stops and closes itself after first audio detection** (`helpers/no-audio-detector.ts`) *(scout)*. mediasoup exposes the same primitive to us (`AudioLevelObserver`) - we simply don't use it.

### 1.4 Stats cadence is server-driven and consumer-scoped
Telemetry cadence comes from the SFU join response (`reporting_interval_ms`, disabled when <= 0) with a 1.5s/3s/3s/5s warm-up ramp; UI stats polling is started/stopped **per consumer** via `startReportingStatsFor`/`stopReportingStatsFor` (2000 ms default) *(scout)*.

### 1.5 Mute = release hardware, by default
`TrackDisableMode = 'stop-tracks' | 'disable-tracks'`; default **`'stop-tracks'`** - the track is stopped, so camera/mic hardware and encoder shut down; re-enable re-acquires *(scout)*.

### 1.6 Encoder-side power defaults
720p `targetResolution`, `degradationPreference: 'maintain-framerate'` on publish, layer bitrates scaled proportionally down for small sources, Opus DTX/RED mirrored from server call-type settings *(scout)*. Pausing a sender disables active encodings rather than `replaceTrack(null)` - with a comment that `replaceTrack(null)` does not reliably stop the video encoder (`rtc/Publisher.ts#L642-L645`) *(scout)*.

### 1.7 Teardown is one ordered funnel
`Call.leave()` flushes final stats, disposes subscriber → publisher → SFU client → subscription manager (clears debounce timers) → audio watchdog → dynascale manager (**closes the shared AudioContext**) → state → leave hooks → device managers *(scout)*. An **orphaned-track registry** exists because `pc.close()` never fires track `ended`: receivers from closed PCs are stashed and dropped on leave/reconnect, otherwise they leak (`store/CallState.ts#L985-L1011`) *(scout; also prior research §6)*.

---

## 2. Findings in our codebase

Ranked by expected battery impact on phones. "Memory leaks" summary first, since that was asked explicitly: **no hard leak found** on the audited paths - manager teardown, tracker listeners, observers, sockets, and the mixer all dispose correctly (§3). The retention issues below are bounded but real: stale `srcObject` elements, and component-lifetime vs manager-lifetime coupling in `use-remote-audio`.

### 2.1 P0 - Camera/mic capture stays hot after toggling off (app path)

**We do:** `toggleVideo(false)` only pauses the producer - `apps/client/src/features/room/hooks/use-room-sfu.ts#L181-L186` (`pauseProducer("video")`, return) and `toggleAudio(false)` the same at `L234-L239`. Nothing stops the getUserMedia track: camera sensor, ISP, capture pipeline, and the local preview `<video>` keep running for the rest of the call. The comments at `use-room-sfu.ts#L209-L210` and `L262-L263` ("the track that 'off' ended") describe an off-path that **ends tracks - which is not what the code does**; the re-enable path even handles both cases (live track → `replaceTrack`, dead track → `ensureVideo()` re-acquire, `L188-L217`), so the fix slot already exists.

**The prebuilt package gets this right:** `packages/react/src/prebuilt/ZvonokRoom.tsx#L325-L347` calls `mediaManager.*Capture.toggle(false)` **and** `pauseProducer`, with a test pinning it (`packages/react/src/__tests__/zvonok-room.test.tsx#L253-L266`). The machinery exists: `MediaCapture.stop()`/`toggle()` (`packages/client/src/media/capture.ts#L100-L119`), and the app already tears everything down via `manager.stop()` on unmount (`apps/client/src/features/media/contexts/media-stream.context.tsx#L83-L92`).

**They do:** default `stop-tracks` - hardware released on mute (§1.5).

**Recommendation: adopt.** In `use-room-sfu` toggle-off, call `videoCapture`/`audioCapture` stop (the `MediaStreamContext` exposes only `ensure*`; add `stop` per kind or reuse `mediaManager.*Capture.stop()`), keep the existing re-acquire-on-enable path as the single source of truth. Delete the misleading comments. Effort **S**, risk low (unmute latency becomes a re-acquisition, ~200-500 ms; the prebuilt already accepts this trade).

### 2.2 P0 - Downlink has no visibility/size-driven control: every tile decodes full quality

**We do:** every video consumer is created and immediately resumed with no layer hint (`packages/client/src/sfu/manager.ts#L1326-L1353`). The only `setPreferredLayers` driver is the auto-quality gate - reactive to *received* quality with a 3 s debounce (`apps/client/src/features/room/contexts/peer-quality.context.tsx#L69-L108`), so on a good network an N-tile grid subscribes to N high layers and decodes all of them. The manager API exists (`manager.ts#L803-L832`); no viewport input anywhere (no IntersectionObserver in the repo).

**They do:** offscreen tiles are unsubscribed SFU-side (§1.1) - bandwidth, decode, and radio cost scale with what is *visible*, not room size.

**Recommendation: adopt (staged).** Phase 1: an IntersectionObserver hook over tiles writing a visibility bit; hidden tile → `setPreferredLayers(consumerId, 0)` via the existing manager API. Phase 2: true unsubscription needs a server-side `consumer.pause()`/close event - coordinate with `apps/server/src/sfu` before building. This is prior research's #1 recommendation, still open. Effort **M**, risk M (server coordination); largest multi-party win on phones.

### 2.3 P1 - No page-visibility handling anywhere

Zero `visibilitychange`/`document.hidden` listeners in `apps/client/src` or `packages/` (repo-wide grep). When a phone user switches apps or the screen sleeps: camera keeps capturing, producers keep sending, all consumers keep decoding, stats keep polling, audio sampling continues. Browser timer throttling does not stop WebRTC media pipelines.

**They do:** nothing on web either (§1.2) - but their RN SDK disables local video on iOS background by default *(scout)*, which is exactly the phone scenario we care about.

**Recommendation: adopt.** One hook at room level: on `hidden` → pause video producer (+ optionally stop capture per 2.1), drop incoming video (all `setPreferredLayers(.., 0)`, or a manager-level `setIncomingVideoEnabled(false)`-style batch), stop stats collection; on `visible` → restore. Guard against flapping with the debounce pattern they use (§1.1). Effort **S-M**, risk low-med (state restore on visible must be idempotent). Biggest single win for "switched to another app, forgot the call".

### 2.4 P1 - Audio analysis: two parallel pipelines, two AudioContexts

**We do:** during a call with the room audio context mounted:
- Playout graph: `RemoteAudioMixer` creates one `AudioContext` (`packages/client/src/audio/remote-audio-mixer.ts#L25`) with per-peer element→gain→destination plus a per-peer analysis tap (`L77-L82`).
- Local mic analysis: `useRemoteAudio` passes the local stream to `sampler.addOwned` (`packages/react/src/use-remote-audio.ts#L104-L108`) → `AudioLevelSampler.addOwned` creates a **second AudioContext per owned entry** (`packages/client/src/audio/audio-level-sampler.ts#L32-L47`), torn down and recreated on every device switch/track swap (`use-audio-activity.ts#L144-L158` calls `addOwned` on every track change).
- Sampling loops: `useRemoteAudio` runs a 250 ms interval with active-speaker detection every 2nd tick (`use-remote-audio.ts#L146-L164`); the **second, duplicate pipeline** `AudioActivityEngine` (`packages/react/src/use-audio-activity.ts#L15`, 100 ms tick, own `AudioContext` factory `L71-L72`, ref-counted `L83-L91`) is exported from the package (`packages/react/src/index.ts#L18-L22`) but unused by the app today. Mounting both hooks costs two timers + three contexts.

**They do:** SFU pushes `audioLevelChanged`; client runs no per-participant analysis (§1.3).

**Recommendation:** (a) **S:** analyse the mic with a borrowed analyser in the mixer's context (it already taps arbitrary tracks) and delete the owned-AudioContext path for `use-remote-audio`; (b) **S:** remove `use-audio-activity.ts` + its exports (or fold into `use-remote-audio`) so exactly one pipeline exists; (c) **M, long-term:** server `AudioLevelObserver` → `sfu:audio-level` event kills client-side remote analysis entirely, matching their design.

### 2.5 P1 - Per-event work: interval churn and whole-grid re-renders

`RoomTracker.recompute()` rebuilds the participants array on **every** event, including per-track mute flips (`packages/react/src/room-tracker.ts#L343-L352`), and `track.onmute`/`onunmute` handlers fire per RTP state change (`L202-L222`). Consequences:
- `useRemoteAudio`'s sampling effect depends on `participants` (`use-remote-audio.ts#L170`): every event tears down and recreates the 250 ms interval and re-walks the mixer map (`L93-L164`).
- `RoomVideo` is a plain function component with no memo (`apps/client/src/features/room/components/room-video.tsx#L17-L61`); every snapshot change re-renders the whole grid.

**They do:** identity-stable participant arrays via in-place sort (`store/CallState.ts#L217-L222`) and `memo`'d `ParticipantView` *(scout; prior research §1.1, §3.4)*.

**Recommendation: adopt** (same as prior research items #2 and §1.1): memoize `RoomVideo`/`RoomTile` on participant reference stability, and make `recompute()` reuse array identity when membership/order is unchanged. Also split `useRemoteAudio`'s interval effect from the peer-sync effect so the timer is created once per manager. Effort **S** each.

### 2.6 P2 - Stale `srcObject` in video elements

`room-video.tsx#L28-L32` and `local-video.tsx#L16-L20` assign only when `stream` is truthy: when a consumer closes / track ends, the dead MediaStream stays attached to the element. `room-video.tsx#L45` masks the video case with the audio overlay; the prebuilt tile has the same pattern (prior research §3.3). No `play()` failure handling anywhere. **Fix: unconditional `element.srcObject = stream` (null clears) in a shared `useVideoStream` hook + catch/retry `play()`** - prior research §3.3 recommendation, still open. Effort **S**.

### 2.7 P2 - Mobile publish pipeline is unconstrained

`SIMULCAST_ENCODINGS` (`packages/client/src/sfu/manager.ts#L70-L84`): high layer 2 Mbps with **no fps cap and no resolution cap**; `isMobile` only enables Opus DTX/stereo DTX (`manager.ts#L646-L649`) - video identical on phones. A phone camera commonly delivers 1080p@30: encoder + radio run at full tilt regardless of grid size.

**They do:** 720p target, `maintain-framerate` degradation, proportional bitrate scaling for small sources, layer fps default 30 with ordered q→f encodings so Chrome sheds the top layer first (§1.6).

**Recommendation: adapt.** On mobile: cap capture constraints (~640×480@15 or 720p@15), set `degradationPreference: 'maintain-framerate'`, cap high-layer `maxFramerate`. Effort **S** (constraints already flow through `MediaCapture.buildConstraints`), risk low.

### 2.8 P2 - `console.log` on hot paths

`packages/client/src/sfu/manager.ts#L1289, L1315, L1340, L1402-L1407, L1414, L1432, L1446, L1456, L1465, L1483, L1497` log every peer/producer/consumer event. The scoped-logger recommendation (prior research §5.3) remains open. Effort **S**.

### 2.9 P3 - Guest approval polling

`apps/client/src/features/room/hooks/use-guest-join-room.ts#L6,L27-L42`: 2 s interval, unbounded, no backoff, keeps polling while the tab is hidden. Bounded scope (prejoin only, until approval) - acceptable, but pause-when-hidden or a socket push (the SFU already pushes guest requests to hosts, `manager.ts#L1476-L1480`) would remove it. Effort **S**.

### 2.10 Note - local recording freezes when the page hides

`CallRecordingCompositor` drives a 30 fps canvas `captureStream` from a `requestAnimationFrame` loop (`apps/client/src/features/media/lib/call-recording-compositor.ts#L85-L91`); rAF does not fire while the page is hidden, so a hidden-tab recording drops frames until focus returns. Not a battery item (rAF pause saves power), but a correctness note for the recording feature.

---

## 3. Already solid (verified, no action)

- Stats cadence is mobile-aware (5 s mobile / 2 s desktop) and subscribable (`peer-quality.context.tsx#L114`, `packages/client/src/sfu/stats-collector.ts#L34-L55`); auto layer gate debounces at 3 s and cleans timers on leave (`peer-quality.context.tsx#L87-L128`).
- `PeerQualityStore` notifies per-peer, not globally (`apps/client/src/features/room/contexts/peer-quality.store.ts#L6-L65`).
- Manager teardown ordering is correct: `disconnect()` = stats stop → event-router teardown → `closeAll()` (rejects pending produce requests, closes transports) → socket disconnect → state reset (`manager.ts#L251-L257`, `L1575-L1639`); consumer cleanup on peer left (`L1413-L1429`), `transportclose`/`trackended` map deletes (`L1386-L1393`).
- `RoomTracker` unsubscribes everything incl. socket listeners (`room-tracker.ts#L174-L180`, `L330-L334`) with phantom-participant guards.
- `RemoteAudioMixer.destroy()` closes the context; `removePeer` pauses the element, nulls `srcObject`, removes it (`remote-audio-mixer.ts#L87-L101`, `L139-L149`).
- `useElementSize` disconnects its ResizeObserver and keeps state identity stable (`apps/client/src/hooks/use-element-size.ts#L16-L40`).
- Chat socket: one socket, bounded reconnection, disconnected on unmount (`apps/client/src/features/chat/contexts/chat.context.tsx#L65-L106`). Whiteboard transport is event-driven, no timers (`packages/whiteboard-core/src/transport.ts#L52-L146`).
- Local recording cleans up capture tracks and video `srcObject`s on stop (`call-recording-compositor.ts#L93-L104`).

One bounded risk to watch: `useRemoteAudio` destroys the mixer only when `manager` becomes null (`use-remote-audio.ts#L67-L91`); if the provider unmounts while a manager is still attached, the mixer's context + elements live until manager detach. Currently unreachable through the room flow (session teardown nulls the manager first), but worth an explicit teardown comment or a test if the provider is ever reused elsewhere.

---

## 4. Priority table

| # | Finding | Fix | Effort | Battery impact |
|---|---------|-----|--------|----------------|
| 1 | Capture stays hot on toggle-off (§2.1) | Stop capture on off, app-parity with prebuilt | S | High - every call with camera off on a phone |
| 2 | No visibility-driven downlink (§2.2) | IntersectionObserver → `setPreferredLayers`; later SFU-side unsubscribe | M | High, scales with participants |
| 3 | No page-visibility handling (§2.3) | hidden → pause publish + drop incoming + stop stats | S-M | High for phone app-switch/screen-off |
| 4 | Duplicate audio pipelines, 2 AudioContexts (§2.4) | Borrow mic analyser in mixer ctx; delete duplicate pipeline; long-term SFU audio levels | S (a,b) / M (c) | Medium - one fewer realtime audio thread |
| 5 | Per-event interval churn + grid re-renders (§2.5) | Array identity, memo tiles, split timer effect | S | Medium at scale |
| 6 | Stale `srcObject` (§2.6) | Shared `useVideoStream`, clear on null | S | Low-Med - dead-decode avoidance |
| 7 | Unconstrained mobile publish (§2.7) | Mobile capture caps + degradationPreference + fps cap | S | Medium - encoder/radio on phones |
| 8 | Hot-path console logging (§2.8) | Scoped level-gated logger | S | Low |
| 9 | Guest polling (§2.9) | Pause when hidden / push | S | Low |

Items 1+3 combined are the "phone user" headline: today a phone in a call with camera off or app in background still runs capture, encode, decode, stats, and audio analysis at full cadence.

---

## 5. stream-video-js negatives worth not cargo-culting

- **No web Page Visibility handling there either** (§1.2) - adding it here is going beyond their web SDK, justified by our mobile-first battery goal; their RN layer proves the pattern.
- Their per-element 25 ms Safari/Firefox re-play timer and per-element playback watchdogs add constant bookkeeping our three video components don't need (prior research §3.3 chose the shared-hook alternative).
- Their client-side WebAudio playback graph inside DynascaleManager duplicates what our `RemoteAudioMixer` already owns explicitly (prior research §8).
