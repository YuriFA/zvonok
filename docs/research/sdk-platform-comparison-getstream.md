# Stream Video & Audio — SDK/API Surface Research

External research (official sources only: getstream.io docs + GetStream GitHub). Compiled 2026-09-10 as input for comparison with our own WebRTC platform's SDK surface. Every claim cites its doc URL; gaps are marked **not found in docs**.

Companion docs indexes: each docs tree has an `llms.txt`/`llms-full.txt` (append `.md` to any page URL for markdown) — [video](https://getstream.io/video/docs/llms.txt), [platform](https://getstream.io/docs/platform/llms.txt).

---

## 1. Package landscape

### JS/web client packages (one monorepo)

All web/RN SDKs live in the [GetStream/stream-video-js](https://github.com/GetStream/stream-video-js) monorepo ("GetStream's React, React Native and JavaScript Video SDKs"). README describes the layering:

| Package (npm, verified from `packages/*/package.json` in the repo) | Layer |
|---|---|
| `@stream-io/video-client` (`packages/client`) | "Low-level client. It manages the lifecycle of a call, connects to our platform, and maintains the call state. The core part of our SDKs. Runs in browser and Node.js environments." Deps: RxJS, protobuf-ts, axios, webrtc-adapter. |
| `@stream-io/video-react-bindings` (`packages/react-bindings`) | "React utilities and hooks that make it easy to work with the call state exposed by the client in React and React Native Apps." Peer: react 17–19. Dep: video-client + i18next. |
| `@stream-io/video-react-sdk` (`packages/react-sdk`) | Full React SDK (components + hooks + CSS). Adds floating-ui, chart.js. |
| `@stream-io/video-react-native-sdk` (`packages/react-native-sdk`) | RN SDK. Peers include `@stream-io/react-native-webrtc` (their WebRTC fork), `@stream-io/react-native-callingx` (CallKit/keep-alive), `@stream-io/noise-cancellation-react-native`, expo ≥47, RN ≥0.73. |
| `@stream-io/video-styling` (`packages/styling`) | Theme stylesheets for web SDKs. |
| `@stream-io/audio-filters-web` (`packages/audio-filters-web`) | Noise cancellation (bundles Krisp SDK). Auto-detected by prebuilt components. |
| `@stream-io/video-filters-web`, `video-filters-react-native`, `noise-cancellation-react-native`, `react-native-callingx`, `codemod` | Other packages in the same repo (dir listing of `packages/`). |

Sources: [repo README](https://github.com/GetStream/stream-video-js), package.json files under `packages/*` (e.g. [client](https://github.com/GetStream/stream-video-js/blob/main/packages/client/package.json)). Latest stable dist-tags on npm at time of writing: video-client 1.59.1, video-react-sdk 1.43.0, video-react-native-sdk 1.45.1; the repo `main` branch is 2.0.0-beta (pre-release). SDK size: <370KB min / ~100KB gzip ([quickstart](https://getstream.io/video/docs/javascript/basics/quickstart/)).

Key architectural point: **the plain-JS SDK ships no UI** — "It ships the client and reactive state; you build the UI. For prebuilt components use the React SDK" ([JS intro FAQ](https://getstream.io/video/docs/javascript/)). React and React Native both consume `@stream-io/video-client` + `@stream-io/video-react-bindings`; server-side overview notes "React and React Native expose hooks and context providers. iOS, Android and Flutter expose observable state objects" ([client-side overview](https://getstream.io/video/docs/api/client-side/)).

### Other client SDKs

iOS (SwiftUI), Android (Compose), Flutter, Unity, ESP32 round out the client list; all described as "Everything a device needs to join a call: signaling, device management and rendering, plus prebuilt call UI on the app platforms" ([Video docs overview](https://getstream.io/video/docs/)). Platform trees: /video/docs/ios/, /android/, /flutter/, /unity/, /esp32/.

### Server-side SDKs

One docs set with language tabs covers "all seven server languages" ([overview](https://getstream.io/video/docs/)); the get-started page shows installs and GitHub repos for **Python** (`pip install getstream`, [stream-py](https://github.com/GetStream/stream-py)), **Node** (`npm install @stream-io/node-sdk`, [stream-node](https://github.com/GetStream/stream-node)), **Go** (`getstream-go/v6`, [getstream-go](https://github.com/GetStream/getstream-go)), **Java** (`io.getstream:stream-sdk-java`, [stream-sdk-java](https://github.com/GetStream/stream-sdk-java)) plus raw cURL ([API get started](https://getstream.io/video/docs/api/)). Platform backend-SDK page additionally lists Ruby, PHP, .NET, Scala ([backend SDKs](https://getstream.io/docs/platform/backend-sdks/)).

**Crucially, the server SDKs are shared across products:** "The same backend SDKs cover Chat, Video, Feeds and Moderation" ([API get started](https://getstream.io/video/docs/api/)); one `StreamClient` handles users/tokens/webhooks for every product.

### Shared foundations with Chat

Auth/users/teams/rate-limits/webhooks are documented once in platform docs and apply to all products ([platform docs](https://getstream.io/docs/platform/); [Video overview "Platform" section](https://getstream.io/video/docs/)). Video's user JWT is "the same token works for every Stream product in your app" ([authentication](https://getstream.io/docs/platform/authentication/)). Chat-in-video integration is a separate `stream-chat` client running alongside the video client ([Chat Integration guide](https://getstream.io/video/docs/javascript/advanced/chat-with-video/)) — i.e. two independent clients/WebSockets, not one merged client. The permission system is also shared vocabulary ("Each user has an application-level role, and also channel (chat product) and call (video product) level roles", [video permissions page](https://getstream.io/video/docs/api/call-types/permissions/)).

---

## 2. Auth model

### Key/secret split

- App has an **API key** (public, goes in clients) and **API secret** (server-only). Found in the [dashboard](https://getstream.io/signin/?product=video). "A client SDK is initialized with the API key alone and cannot mint [a token]" ([client-side overview note](https://getstream.io/video/docs/api/client-side/)); the OpenAPI security scheme repeats: client SDKs deliberately ship without token generation so the secret never reaches a browser/app ([protocol spec, JWT securityScheme](https://github.com/GetStream/protocol/blob/main/openapi/video-openapi.yaml)).
- Server-side clients are constructed with `{apiKey, secret}` (Node `new StreamClient(apiKey, secret)`, etc.) and authenticate with a **server JWT** whose payload is `{"server": true}`; REST calls send headers `Authorization: <JWT>` + `stream-auth-type: jwt` + `?api_key=` query param ([API get started](https://getstream.io/video/docs/api/)).

### User tokens (client-side)

- HS256 JWTs minted server-side: `client.generateUserToken({ user_id, validity_in_seconds })` (Node), `create_token` (Python), etc. Claims: `user_id` (+ optional `iat`/`exp`); default validity 1 hour ([authentication](https://getstream.io/docs/platform/authentication/); [video client-auth](https://getstream.io/video/docs/javascript/guides/client-auth/)).
- **Call tokens** (video-specific): embed `call_cids: ["default:call1", …]` and optional `role` — "the user will automatically be assigned the membership role for all the calls specified in the token's claims", designed to *grant* access, not restrict ([authentication § Call tokens](https://getstream.io/docs/platform/authentication/)).
- Client init: `new StreamVideoClient({ apiKey, user, token })` or a **`tokenProvider`** (`async () => string`) invoked automatically whenever the token expires; both can be given (static first, provider for refresh) ([client-auth](https://getstream.io/video/docs/javascript/guides/client-auth/)).
- User classes: **authenticated**, **guest** (`type: "guest"`), **anonymous** (`type: "anonymous"`). Anonymous users open no WebSocket (receive no events); they use a call-scoped token with payload `{"user_id":"!anon","role":"viewer","call_cids":["livestream:123"]}` ([client-auth](https://getstream.io/video/docs/javascript/guides/client-auth/)).
- Connect flow: auto-connect on construction (`options.maxConnectUserRetries`, `onConnectUserError`) or manual `await client.connectUser(user, token)`; `client.disconnectUser()` to tear down ([client-auth](https://getstream.io/video/docs/javascript/guides/client-auth/)).
- Token lifecycle tooling: token revocation via `revoke_tokens_issued_before` (per user / app-wide), developer tokens via dashboard "Disable Authentication Checks" on dev apps ([authentication](https://getstream.io/docs/platform/authentication/)).
- Client-vs-server distinction summary: server side authenticates with API secret and "has no camera, no microphone and nothing on screen"; everything device/rendering is client SDK work ([client-side overview](https://getstream.io/video/docs/api/client-side/)).

---

## 3. Client SDK architecture

### StreamVideoClient / Call

- `StreamVideoClient` "is responsible for maintaining a WebSocket connection to our servers and also takes care about the API calls that are proxied from the `call` instance" ([calling state & lifecycle](https://getstream.io/video/docs/javascript/guides/calling-state-and-lifecycle/)). Singleton helper `StreamVideoClient.getOrCreateInstance(...)` exists for guest/anonymous flows ([client-auth](https://getstream.io/video/docs/javascript/guides/client-auth/)).
- `Call` "represents the main building block of our SDK. This object abstracts away the user actions, join flows and exposes the call state" ([joining & creating calls](https://getstream.io/video/docs/javascript/guides/joining-and-creating-calls/)). Instances are always acquired via `client.call(type, id)` and must be disposed with `call.leave()` ([calling state & lifecycle](https://getstream.io/video/docs/javascript/guides/calling-state-and-lifecycle/)).
- **CID**: a call is identified by `type:id` (e.g. `default:123`); `call.cid` is exposed on the instance/events; call IDs are reusable (recurring meetings — "join a call with the same id multiple times") ([quickstart](https://getstream.io/video/docs/javascript/basics/quickstart/), [querying calls filter table](https://getstream.io/video/docs/javascript/guides/querying-calls/)). UUIDv4 recommended for one-off calls; creation has **upsert semantics** (existing ID → update, no `call.created` event) ([API calls page](https://getstream.io/video/docs/api/calls/), [call lifecycle](https://getstream.io/video/docs/api/call-lifecycle/)).
- **Call lifecycle methods**: `call.get()` (load + subscribe), `call.getOrCreate({data})`, `call.join({create, data, members_limit})`, `call.leave()`, `call.endCall()` (needs permission; emits `call.ended`; only `JOIN_ENDED_CALL` capability can rejoin), `call.update({custom, settings_override})`, `call.updateCallMembers()` ([joining & creating calls](https://getstream.io/video/docs/javascript/guides/joining-and-creating-calls/)).
- Creation options: `members` (with per-member role), `custom`, `settings_override`, `starts_at`, `team`, `ring`, `notify`, `video` ([options table](https://getstream.io/video/docs/javascript/guides/joining-and-creating-calls/)).
- **CallingState machine** (per-call, local): `UNKNOWN, IDLE, RINGING, JOINING, JOINED, LEFT, RECONNECTING, RECONNECTING_FAILED, MIGRATING, OFFLINE` — `MIGRATING` = "The SFU node hosting the current participant is shutting down or tries to rebalance the load" ([calling state & lifecycle](https://getstream.io/video/docs/javascript/guides/calling-state-and-lifecycle/)).
- Client state: `client.state.calls$` tracks all watched/ringing/loaded calls; `connectedUser$` holds server-side user data ([call & participant state](https://getstream.io/video/docs/javascript/guides/call-and-participant-state/)).
- Sessions: a **call session** starts when the first participant joins and ends when the last leaves + `inactivity_timeout_seconds` (default 30s); one active session per call, multiple sessions over time ([call lifecycle](https://getstream.io/video/docs/api/call-lifecycle/)).

### Call types

Four built-in types, "Each is a call with a different call type; the SDKs and API are the same" ([overview FAQ](https://getstream.io/video/docs/)):

| Type | Purpose | Notes |
|---|---|---|
| `default` | 1-1/group calls, meetings | video+audio on, backstage off, screenshare on |
| `audio_room` | Clubhouse/Twitter Spaces pattern | audio-only, permission-request workflow, backstage **on** |
| `livestream` | one-to-many | "All authenticated users can access calls", backstage **on** |
| `development` | testing only | all permissions granted — never use in prod |

([built-in types](https://getstream.io/video/docs/api/call-types/builtin/)). Custom types + per-type settings/permissions via dashboard or API ([manage types](https://getstream.io/video/docs/api/call-types/manage/)). Call-type settings cover audio (opus_dtx, redundant coding, mic/speaker defaults), backstage, video (target_resolution), screenshare, recording (mode/quality/layout), broadcasting/HLS (auto_on, quality_tracks up to 3), geofencing, transcription, ringing timeouts, per-event push notification templates (handlebars title/body) — full tables in [settings](https://getstream.io/video/docs/api/call-types/settings/) and [JS configuring call types](https://getstream.io/video/docs/javascript/guides/configuring-call-types/). Per-call overrides via `settings_override` at creation or update ([joining & creating calls](https://getstream.io/video/docs/javascript/guides/joining-and-creating-calls/)).

### State store

- State is **reactive via RxJS**: "each state property is an Observable", updated by WebSocket events and API calls; every property exists both as `foo$` observable and static getter `foo` ([call & participant state](https://getstream.io/video/docs/javascript/guides/call-and-participant-state/)).
- `call.state` exposes ~30 observables (participants, dominantSpeaker, recording, egress, ownCapabilities, session, settings, backstage, blockedUserIds, transcribing, closedCaptions, thumbnails, custom, …); `client.state` exposes `calls$`, `connectedUser$` (tables in [call & participant state](https://getstream.io/video/docs/javascript/guides/call-and-participant-state/)).
- **Participant state**: `StreamVideoParticipant` (sessionId, userId, roles, publishedTracks, pausedTracks, interruptedTracks, audioLevel, connectionQuality, videoStream/audioStream/screenShareStream MediaStreams, reaction, pin, source (WebRTC/RTMP/WHIP/SIP/SRT), viewportVisibilityState, isDominantSpeaker/isSpeaking/isLocalParticipant, custom…) plus helpers `hasAudio/hasVideo/hasScreenShare/isPinned/hasInterruptedTrack` ([participant tables](https://getstream.io/video/docs/javascript/guides/call-and-participant-state/)).
- Scale cap: "In a call with many participants, the value of `participants$` … is truncated to 250 participants"; publishers get priority ([call & participant state warning](https://getstream.io/video/docs/javascript/guides/call-and-participant-state/)). `rawParticipants$` variant skips sort-driven emissions.
- Participant **sorting API**: generic `Comparator<T>` + `combineComparators/conditional/descending` and built-in presets ([sorting API](https://getstream.io/video/docs/javascript/guides/sorting-api/)).
- Framework exposure: plain JS subscribes to observables directly; React/RN wrap them in hooks (see §6); iOS/Android/Flutter expose "observable state objects" ([client-side overview](https://getstream.io/video/docs/api/client-side/)).
- `queryCalls({filter_conditions, sort, limit, watch:true})` + `queryMembers` give DB-like querying with watching for live updates without joining ([querying calls](https://getstream.io/video/docs/javascript/guides/querying-calls/), [querying members](https://getstream.io/video/docs/javascript/guides/querying-call-members/)).

---

## 4. Event model

### Transport & delivery rules

- Events flow over the client's **WebSocket** connection. Client events (`connection.ok`, `connection.error`, `health.check`, `user.updated`) are always delivered to connected users. **Call events are only delivered to clients "watching" the call** — three ways to watch: `queryCalls({watch:true})`, `call.join()`, or `call.get()/getOrCreate()` ([events guide](https://getstream.io/video/docs/javascript/guides/events/)).
- Subscription API: `client.on("all" | "call.created" | …, handler)` returns an unsubscribe fn; `call.on(eventType)` scopes to one call. Typed as `StreamVideoEvent`/`StreamCallEvent` ([events guide](https://getstream.io/video/docs/javascript/guides/events/)).
- **State propagation pattern**: docs recommend the reactive state store first ("In most cases, you can simply use the reactive state store… for some advanced use cases you might need the underlying WebSocket events"); events mutate `call.state` subjects, which drive UI ([events guide](https://getstream.io/video/docs/javascript/guides/events/)).

### Event names (client WS list, ~50)

Full table in [events guide](https://getstream.io/video/docs/javascript/guides/events/): `call.created`, `call.updated`, `call.deleted`, `call.ended`, `call.ring`, `call.notification`, `call.missed`, `call.accepted`, `call.rejected`, `call.member_added/removed/updated/updated_permission`, `call.permission_request`, `call.permissions_updated`, `call.user_muted`, `call.blocked_user`, `call.unblocked_user`, `call.kicked_user`, `call.reaction_new`, `call.session_started/ended`, `call.session_participant_joined/left/count_updated`, `call.live_started`, `call.hls_broadcasting_started/stopped/failed`, `call.rtmp_broadcast_started/stopped/failed`, `call.recording_started/stopped/ready/failed`, `call.frame_recording_started/stopped/ready/failed`, `call.transcription_started/stopped/ready/failed`, `call.closed_captions_started/stopped/failed`, `call.closed_caption`, `call.moderation_blur`, `call.moderation_warning`, `call.stats_report_ready`, `call.user_feedback_submitted`, `custom`. Each has a "delivered to" column (all call members vs call watchers).

**Custom events**: `call.sendCustomEvent({type, payload})` broadcasts to watchers, payload **limited to 5KB**; received as the `custom` event type ([custom events](https://getstream.io/video/docs/javascript/guides/custom-events/)).

### Server-side event catalogue

Same event names are available to webhooks/SQS/SNS with per-event payload schemas (`CallCreatedEvent`, `CallRingEvent`, DTMF `call.dtmf`, ingress.started/stopped/error, etc.) in the [server-side Events reference](https://getstream.io/video/docs/api/webhooks/events/). Lifecycle ordering with worked examples (ring-all-accept, reject, timeout, cancel; backstage; recurring meeting) is documented in [call lifecycle](https://getstream.io/video/docs/api/call-lifecycle/).

---

## 5. Media layer (SFU / edge)

### Topology

- **SFU + SFU cascading**, not mesh/P2P: "we use Selective Forwarding Units (SFUs)… reducing the connection complexity from O(n²) to O(n). For very large calls, we cascade multiple SFUs together" building a hierarchy (1 SFU → 100 SFUs → 1,000 users each). Backend written in **Go**; kernel-level tricks (sendmmsg/recvmmsg, GSO/GRO, zero-alloc hot paths, direct syscalls; ~1 syscall per 8 RTP packets) ([architecture & benchmark](https://getstream.io/video/docs/javascript/architecture-and-benchmark/)).
- **Multi-datacenter, multi-provider edge**: "We run across multiple datacenters and hosting providers… geographic redundancy… lower latency by routing users to nearby servers". SFU autoscaling ("stepped scaling… 2x or 3x"), thundering-herd and DB-hotspot protections ([same page](https://getstream.io/video/docs/javascript/architecture-and-benchmark/)).
- 100k-participant benchmark: 225Gbps peak, 132 SFUs cascaded, 30fps stable, 0% packet loss, 4ms jitter, 10k joins/min, 600 joins/s peak across 6 regions ([same page](https://getstream.io/video/docs/javascript/architecture-and-benchmark/)).
- Edge list is exposed via REST `GET /video/edges` ("Returns the list of all edges available for video calls", schema includes `latency_test_url`) — [protocol OpenAPI](https://github.com/GetStream/protocol/blob/main/openapi/video-openapi.yaml). Clients connect to nearest edge; SFU hostnames look like `sfu-…-aws-sao1.stream-io-video.com` ([networking page](https://getstream.io/video/docs/api/quality/networking/)).

### Track consumption & adaptive bitrate

- **Automatic subscription management / visibility tracking**: "If a participant isn't visible on screen, we don't download their video" — `call.setViewport(container)` + `call.trackElementVisibility(el, sessionId, "videoTrack")` pause off-screen video ([quickstart](https://getstream.io/video/docs/javascript/basics/quickstart/), [visibility tracking](https://getstream.io/video/docs/javascript/guides/visibility-tracking/)).
- **Simulcast**: "When it's needed, participants upload high, medium and low quality. The system automatically selects the optimal codec and resolution based on network conditions, screen size, device capabilities, available bandwidth" ([architecture page](https://getstream.io/video/docs/javascript/architecture-and-benchmark/)). Marketed as "Dynascale: Automatically switch resolutions, fps, bitrate, codecs and paginate video on large calls" ([repo README](https://github.com/GetStream/stream-video-js)). Codecs: VP8 alongside **AV1** for large livestreams ([architecture page](https://getstream.io/video/docs/javascript/architecture-and-benchmark/)).
- Manual override: `call.setPreferredIncomingVideoResolution({width,height}, [sessionIds])` and `call.setIncomingVideoEnabled(false)` for audio-only ([manual quality selection](https://getstream.io/video/docs/javascript/ui-cookbook/manual-video-quality-selection/)).
- **Low-bandwidth video pause**: server can opt a subscriber out of remote video entirely ("SUBSCRIBER_VIDEO_PAUSE" client capability, on by default; observable via `participant.pausedTracks`) ([low bandwidth](https://getstream.io/video/docs/javascript/ui-cookbook/low-bandwidth/)).
- Audio robustness: **Opus DTX + RED** enabled by default on all call types ([call-type settings defaults](https://getstream.io/video/docs/api/call-types/builtin/)); HiFi/stereo modes (`VOICE_STANDARD_UNSPECIFIED`, `VOICE_HIGH_QUALITY`, `MUSIC_HIGH_QUALITY`) for mic and screenshare audio ([HiFi guide](https://getstream.io/video/docs/javascript/ui-cookbook/hifi-stereo-audio/)).
- **Screenshare**: desktop browsers only; requires `screenshare` capability; default cap 2560×1440@30fps, `setSettings({maxFramerate (1–15), maxBitrate, contentHint})`, stereo hi-fi screenshare audio by default ([screensharing](https://getstream.io/video/docs/javascript/guides/screensharing/)).
- Element binding: `call.bindVideoElement / bindAudioElement` handle stream changes/resizes for `<video>/<audio>` tags ([quickstart](https://getstream.io/video/docs/javascript/basics/quickstart/), [playing video & audio](https://getstream.io/video/docs/javascript/guides/playing-video-and-audio/)).
- Connectivity: TURN runs on the SFUs; TCP/443 fallback; dedicated TURN network with static IPs; UDP media range 46884–60999, STUN/TURN 3478, TURN TLS 443 ([architecture](https://getstream.io/video/docs/javascript/architecture-and-benchmark/), [networking & firewall](https://getstream.io/video/docs/api/quality/networking/)).
- Ingress/egress protocols: WebRTC (~100ms), WHIP (~100ms, OBS 32.1+), SRT (2s), RTMP (2s, transcoded); HLS egress with ~6s latency, up to 3 quality tracks ([streaming overview table](https://getstream.io/video/docs/api/streaming/overview/), [HLS](https://getstream.io/video/docs/api/streaming/hls/)). Hard cap on participants per call: **not found in docs** (only benchmark scale + "millions of HLS viewers" marketing claims, [overview FAQ](https://getstream.io/video/docs/)).

---

## 6. React bindings

### Providers & components

- **`<StreamVideo client={…}>`** — root provider: "makes the client and its state available to all child components and initializes internationalization"; props `client`, `i18nInstance`, `language`, `translationsOverrides`; children read it via `useStreamVideoClient()` ([StreamVideo docs](https://getstream.io/video/docs/react/ui-components/core/stream-video/)).
- **`<StreamCall call={…}>`** — "declarative wrapper around `Call` objects. It uses `StreamCallProvider` to make the call and its state available to all child components"; children read via `useCall()` ([StreamCall docs](https://getstream.io/video/docs/react/ui-components/core/stream-call/)).
- Typical composition: `StreamVideo → StreamTheme → StreamCall → SpeakerLayout + CallControls` ([UI components overview](https://getstream.io/video/docs/react/ui-components/overview/)). Component catalogue (each has a docs page): layouts (SpeakerLayout, CallLayouts), ParticipantView, CallControls, CallParticipantsList, DeviceSettings/VideoPreview, LivestreamPlayer, ringing-call components, permission request/notification components, recording-in-progress & speaking-while-muted & mic-capture-error notifications, CallStats, Avatar, Reaction, theme ([React docs index](https://getstream.io/video/docs/react/)).
- **Prebuilt "embedded" components** (newest layer): `EmbeddedCall` / `EmbeddedLivestream` from `@stream-io/video-react-sdk/embedded` — single component managing "client initialization, call joining, the complete meeting or livestream UI, and cleanup"; host-vs-viewer UI switches on `JOIN_BACKSTAGE` capability; layouts `PaginatedGrid | SpeakerTop/Left/Right/Bottom`; theming via CSS-variable `theme` prop ([prebuilt components](https://getstream.io/video/docs/react/basics/prebuilt/)).
- Theming: CSS variables under `.str-video` (`--str-video__primary-color` …), stylesheet `@stream-io/video-react-sdk/dist/css/styles.css` (or `embedded.css`), cascade-layer support ([overview](https://getstream.io/video/docs/react/ui-components/overview/), [theme](https://getstream.io/video/docs/react/ui-components/video-theme/)). i18n via StreamI18n ([StreamVideo props](https://getstream.io/video/docs/react/ui-components/core/stream-video/)).

### Hooks & the selector pattern

- State access is hook-based and mirrors the observable store 1:1: "These hooks are reactive (their value is updated on WebSocket events and API calls)" ([React call & participant state](https://getstream.io/video/docs/react/guides/call-and-participant-state/)).
- **`useCallStateHooks()`** is the entry point — destructure type-safe per-slice hooks: `const { useParticipants, useCallCallingState } = useCallStateHooks()` ([overview example](https://getstream.io/video/docs/react/ui-components/overview/), [state guide](https://getstream.io/video/docs/react/guides/call-and-participant-state/)).
- Call-state hooks (docs table): `useCallCallingState`, `useCallMembers`, `useOwnCapabilities`, `useHasPermissions`, `useDominantSpeaker`, `useIsCallRecordingInProgress`, `useIsCallLive`, `useCallEgress/Ingress`, `useCameraState/useMicrophoneState/useSpeakerState/useScreenShareState`, `useIsAutoplayBlocked`, `useIncomingVideoSettings`, `useCallStatsReport`, etc. Participant hooks: `useParticipants`, `useLocalParticipant`, `useRemoteParticipants`, `useParticipantCount`, `usePinnedParticipants`, `useRawParticipants` ("not affected by participant sort settings and thus causes less component updates"). Client hooks: `useStreamVideoClient`, `useConnectedUser`, `useCalls` ([full tables](https://getstream.io/video/docs/react/guides/call-and-participant-state/)).
- Same 250-participant truncation warning as JS; same utility functions (`hasVideo()`…) re-exported from the React SDK ([state guide](https://getstream.io/video/docs/react/guides/call-and-participant-state/)).
- React Native mirrors the model with its own components (`StreamVideo`, `StreamCall`, `CallContent`, `CallControls`, `IncomingCall`/`OutgoingCall`, `HostLivestream`/`ViewerLivestream`, `ParticipantView`…) consuming the same hooks package ([RN UI components overview](https://getstream.io/video/docs/react-native/ui-components/overview/), [RN docs index](https://getstream.io/video/docs/react-native/)).

---

## 7. REST API

- **Spec**: OpenAPI 3.0.3 published in [GetStream/protocol](https://github.com/GetStream/protocol) and browsable at [getstream.github.io/protocol/?urls.primaryName=Video](https://getstream.github.io/protocol/?urls.primaryName=Video) (specs: `video-openapi.yaml` client-side, `v2/video-serverside-api.yaml` server-side incl. shared app-level endpoints) ([swagger initializer](https://getstream.github.io/protocol/dist/swagger-initializer.js)).
- **Base URL & auth**: `https://video.stream-io-api.com/api/v2/…?api_key=…` with `Authorization: <JWT>` and `stream-auth-type: jwt` headers — shown in every cURL tab ([API get started](https://getstream.io/video/docs/api/)). Security schemes: `JWT` (user or server-side), `api_key` query, `Stream-Auth-Type: jwt|anonymous` ([spec securitySchemes](https://github.com/GetStream/protocol/blob/main/openapi/video-openapi.yaml)).
- **Video resources** (paths from the spec): calls CRUD (`/video/call/{type}/{id}` get/get_or_create/update; `/mark_ended`, `/delete`), members (`/members`), block/kick, `mute_users`, `user_permissions` (grant/revoke), pin/unpin, ring/accept/reject (`/ring`, `/video/call/{type}/{id}/accept`…), `go_live`/`stop_live`, broadcasting (`start_broadcasting`, `rtmp_broadcasts` + per-name stop), recordings (`recordings` list/delete; `recordings/{recording_type}/start|stop`), transcriptions + closed captions start/stop/list, frame recording, feedback (`/feedback`, `/video/call/feedback`), query (`/video/calls`, `/video/call/{type}/{id}/participants`, `/video/call/members`), call types (`/video/calltypes` CRUD), permissions (`/video/permissions`), devices, **edges** (`/video/edges`), external storage CRUD + check, SIP (auth, inbound_trunks, inbound_routing_rules, resolve), stats (`/video/call_stats`, `/video/stats`, `daily_digest`, per-participant timelines), guest user creation, `/video/call_client_event`, custom events (`/video/call/{type}/{id}/event`), `active_calls_status` ([video-openapi.yaml paths](https://github.com/GetStream/protocol/blob/main/openapi/video-openapi.yaml)).
- **Call responses include `own_capabilities`** — "the user's allowed actions" — used by SDKs for UI gating ([permissions page § Capabilities](https://getstream.io/video/docs/api/call-types/permissions/)).
- **Pagination**: cursor-based `next`/`prev` returned by queryCalls and re-passed into the next query ([querying calls § Pagination](https://getstream.io/video/docs/javascript/guides/querying-calls/)); member queries paginate with `next` too; join/getOrCreate return at most 100 members (`members_limit`) ([querying members](https://getstream.io/video/docs/javascript/guides/querying-call-members/)). Filter/sort syntax is the platform-wide Mongo-like operator set ($eq, $in, $gt…, $and/$or, $autocomplete) ([query syntax operators](https://getstream.io/docs/platform/query-syntax-operators/)).
- **Rate limits**: per-endpoint table (e.g. GetOrCreateCall/JoinCall/QueryCalls 1000/min; StartRecording/UpdateCallType 300/min; SendEvent/VideoConnect 10000/min; DeleteCall/GetCallStats 60/min) + shared mechanics (`X-RateLimit-*` headers, 429 handling, SDK auto-retry) ([video rate limits](https://getstream.io/video/docs/api/rate-limits/), [platform rate limits](https://getstream.io/docs/platform/rate-limits/)).
- Long-running ops (bulk user deactivation, exports, GDPR deletes) return a `task_id` pollable via `/api/v2/tasks/{id}` ([async operations](https://getstream.io/docs/platform/async-operations/)).
- Errors: structured `APIError` (code, message, duration, more_info, exception_fields, `unrecoverable` flag) ([spec schema](https://github.com/GetStream/protocol/blob/main/openapi/video-openapi.yaml)); platform error-codes page ([error handling](https://getstream.io/docs/platform/error-handling/)).

---

## 8. Permissions & roles

- **Shared model across products**: every check is "is Subject A allowed to perform Action B on Resource C?"; Permissions (actions) attach to Roles via **Grants** scoped app-wide or to a product resource — for Video, "Call roles are defined on the call type level" ([platform permissions](https://getstream.io/docs/platform/permissions/), [video permissions](https://getstream.io/video/docs/api/call-types/permissions/)). Permission checks run on client-side calls only; server-side (API-secret) calls "allow everything" ([platform permissions](https://getstream.io/docs/platform/permissions/)).
- **Built-in call roles** (5): `user`, `moderator`, `host`, `admin`, `call-member`; users have a global app role plus a per-call role; custom roles creatable in dashboard ([permissions page](https://getstream.io/video/docs/api/call-types/permissions/), [built-in types § User roles](https://getstream.io/video/docs/api/call-types/builtin/)).
- **Grants config**: `createCallType({ name, grants: { admin: ["send-audio","send-video","mute-users"], customrole: […] } })` or `updateCallType` on built-ins; list via `listCallTypes`/`getCallType`; `listPermissions` enumerates all permission IDs ([permissions page](https://getstream.io/video/docs/api/call-types/permissions/)). Dashboard editor at "Video & Audio → Roles & Permissions" per call-type scope ([restricting access walkthrough](https://getstream.io/video/docs/javascript/guides/joining-and-creating-calls/)).
- **Capabilities (runtime, per user per call)**: resolved from app role + call role + call type settings + call-level settings, returned as `own_capabilities`; ~23 default capabilities documented (`join-call`, `read-call`, `create-call`, `join-ended-call`, `join-backstage`, `update-call`, `update-call-settings`, `screenshare`, `send-video`, `send-audio`, `start/stop-record-call`, `start/stop-broadcast-call`, `end-call`, `mute-users`, `update-call-permissions`, `block-users`, `create-reaction`, `pin-for-everyone`, `remove-call-member`, `start/stop-transcription-call`) ([built-in types § capabilities](https://getstream.io/video/docs/api/call-types/builtin/), [permissions § capabilities](https://getstream.io/video/docs/api/call-types/permissions/)).
- **Client-side checks**: `call.permissionsContext.hasPermission(OwnCapability.SEND_AUDIO)`; live in `call.state.ownCapabilities$` ([permissions & moderation guide](https://getstream.io/video/docs/javascript/guides/permissions-and-moderation/)).
- **Runtime grant/revoke per participant**: `call.updateUserPermissions({user_id, grant_permissions, revoke_permissions})` (or `grantPermissions`/`revokePermissions` shortcuts); target user gets `call.permissions_updated` WS event and the client **auto-stops publishing** revoked tracks ([moderation guide](https://getstream.io/video/docs/javascript/guides/permissions-and-moderation/)).
- **Permission request workflow** (audio-room pattern): `call.requestPermissions({permissions})` → `call.permission_request` event to hosts → `call.grantPermissions(userId, permissions)`; gated by call-type `access_request_enabled` ([same guide](https://getstream.io/video/docs/javascript/guides/permissions-and-moderation/)).
- **Moderation actions**: mute (`call.muteUser(userIds, "audio"|"video"|"screenshare")`, bulk, `muteAllUsers`), kick (`kickUser({user_id, block})`), block/unblock user from call, end call for everyone ([moderation guide](https://getstream.io/video/docs/javascript/guides/permissions-and-moderation/); server equivalents in [moderation overview](https://getstream.io/video/docs/api/moderation/overview/)).
- **Live A/V moderation**: frame recording every ~2s per participant → `call.moderation_blur` (blur a user's video) and `call.moderation_warning` events; audio via transcription/captions; integration with the separate Stream Moderation product ([audio & video moderation](https://getstream.io/video/docs/api/moderation/audio-video/), [frame recording](https://getstream.io/video/docs/api/recording/frame-recording/)).
- Chat-style custom permission predicates (e.g. Chat's custom ACL functions): **not found in docs** for Video — Video grants are flat role→permission lists.

---

## 9. Webhooks + SQS

- **One system for all products**: "Every Stream product can deliver events to your server using webhooks, SQS or SNS" ([platform webhooks](https://getstream.io/docs/platform/webhooks/)). Event-type/payload catalogue for video: [video events reference](https://getstream.io/video/docs/api/webhooks/events/).
- **Config**: `event_hooks` array on app settings (`updateAppSettings`/`update_app`) with `hook_type: "webhook" | "sqs" | "sns"`, `webhook_url`, and `event_types` (empty = all, incl. future types); multiple endpoints per app supported; dashboard config + test buttons also available ([webhooks § Configuring Hooks](https://getstream.io/docs/platform/webhooks/)).
- **Signing & parsing**: every request carries `X-Webhook-Id` (stable across retries — dedupe key), `X-Webhook-Attempt`, `X-Api-Key`, `X-Signature` (HMAC of body with API secret). SDK helper `client.verifyAndParseWebhook(rawBody, xSignature)` verifies + decompresses + parses into typed events, with `UnknownEvent` fallback and one error class per language ([webhooks § Handling/Verifying](https://getstream.io/docs/platform/webhooks/)).
- **Delivery guarantees / retries**: immediate retries, no backoff — 5 attempts per event, 6s timeout per attempt, 15s total budget, retryable on 408/429/5xx (max 3) and network errors (max 2); other non-2xx are final; `Retry-After` not honored ([webhooks § Retries](https://getstream.io/docs/platform/webhooks/)). For zero loss, docs steer to SQS/SNS.
- **Payload compression**: `enable_hook_payload_compression` (default **on** for apps created after May 7, 2026); gzip 70–90% smaller; SQS/SNS payloads gzipped+base64; verify HMAC on uncompressed bytes; <256B payloads stay plain ([webhooks § Payload Compression](https://getstream.io/docs/platform/webhooks/)).
- **SQS integration**: `hook_type: "sqs"` with `sqs_queue_url`, `sqs_region`, `sqs_auth_type: "keys" | "resource"` (keys, or cross-account role via queue policy granting Stream's AWS account `SQS:SendMessage`); required IAM actions `sqs:GetQueueUrl/ SendMessage/ SendMessageBatch/ GetQueueAttributes`; `testSQSSettings`/`check_sqs` test endpoint; SDK-side `parseSqs` helpers; same event list as webhooks ([webhooks § SQS](https://getstream.io/docs/platform/webhooks/)). SNS analogous ([§ SNS](https://getstream.io/docs/platform/webhooks/)). Video-specific webhook payloads/examples per event in the [events reference](https://getstream.io/video/docs/api/webhooks/events/).

---

## 10. Recording / egress

### Recording (4 modes)

([recording introduction](https://getstream.io/video/docs/api/recording/introduction/))

| Mode | Output | Cost | Latency | Notes |
|---|---|---|---|---|
| **Composite** | 1 composed file via headless browser ("web recording"); layouts (grid/spotlight/single-participant/mobile/custom) + custom CSS/external app URL | most expensive | ~5 min | [composite](https://getstream.io/video/docs/api/recording/composite/) |
| **Individual track** | up to 6 files per participant (audio-only / video-only / a+v, screen share variants) | cheaper | ~5 min | [individual](https://getstream.io/video/docs/api/recording/individual-track/) |
| **Raw** | zip of raw track data + metadata; CLI post-processing (extract/mux/mix) | cheapest | ~5 min | [raw](https://getstream.io/video/docs/api/recording/raw/) |
| **Frame** | JPEG stills per participant every ~2s delivered via `call.frame_recording_ready` webhooks | cheapest | ~5 s | built for live moderation/AI; used by Stream Moderation ([frame recording](https://getstream.io/video/docs/api/recording/frame-recording/)) |

- Mixed modes allowed across types; only one recording of the same type per call at a time ([introduction](https://getstream.io/video/docs/api/recording/introduction/)).
- Client API: `call.startRecording()/stopRecording()`, state via `call.state.recording$`, listing via `call.listRecordings()`; `call.recording_stopped` fires before the file exists (~30s+), `call.recording_ready` carries the URL ([client recording guide](https://getstream.io/video/docs/javascript/advanced/recording/)).
- Auto-on modes per call type (`recording.mode: available | disabled | auto-on`), qualities `audio-only|360p…1440p` ([settings](https://getstream.io/video/docs/api/call-types/settings/)); `goLive({start_recording, start_hls, start_closed_caption, start_transcription, recording_storage_name, transcription_storage_name})` ([streaming overview](https://getstream.io/video/docs/api/streaming/overview/)).
- **Storage**: default Stream-managed S3 in the app's region, **2-week retention**; BYO S3/GCS/Azure Blob (up to 10 external storage configs/app, verify via check endpoint, attach to call type) ([recording storage](https://getstream.io/video/docs/api/recording/storage/)). Management (list/delete) via REST + `call.recordings` state; deleting recordings from a session covered in [managing recordings](https://getstream.io/video/docs/api/recording/manage/).

### Broadcast (egress)

- **HLS out**: `call.startHLS()/stopHLS()` or `goLive({start_hls:true})`; playlist URL from `call.state.egress.hls.playlist_url`; ~6s latency, up to 3 quality tracks; events `call.hls_broadcasting_*` ([HLS](https://getstream.io/video/docs/api/streaming/hls/), [client broadcasting](https://getstream.io/video/docs/javascript/advanced/broadcasting/)).
- **RTMP out (restreaming)**: forward a call to any RTMP(s) target (Twitch/YouTube/Facebook…), multiple concurrent targets; composed single stream with selectable layout + quality incl. portrait resolutions ([RTMP broadcasts](https://getstream.io/video/docs/api/streaming/rtmp-broadcasts/)).
- **Ingest**: WebRTC, WHIP (OBS 32.1+), SRT, RTMP — RTMP/WHIP "stream key" is literally a Stream **user token**; RTMP participants appear as regular participants with `source: RTMP` ([streaming overview](https://getstream.io/video/docs/api/streaming/overview/), [RTMP ingress](https://getstream.io/video/docs/api/streaming/rtmp/)). OBS WHIP setup: [WHIP](https://getstream.io/video/docs/api/streaming/whip/); SRT: [SRT](https://getstream.io/video/docs/api/streaming/srt/). Mobile broadcast: [mobile livestreaming](https://getstream.io/video/docs/api/streaming/mobile-livestreaming/).
- **Backstage**: calls created hidden until `goLive()`; `join_ahead_time_seconds`; recording (auto-on) starts in backstage ([backstage](https://getstream.io/video/docs/api/streaming/backstage/), [call lifecycle](https://getstream.io/video/docs/api/call-lifecycle/)).

### Transcription & captions

- `call.startTranscription({language, enable_closed_captions})` / `stopTranscription({stop_closed_captions})`; auto-on mode starts on first join, stops when all leave; captions stream over WS (`call.closed_caption`), transcript file uploaded once at end; language settable at call-type, call, or start-call level; default storage Stream S3, 2 weeks, BYO storage supported ([transcriptions & captions](https://getstream.io/video/docs/api/transcribing/calls/), [transcription storage](https://getstream.io/video/docs/api/transcribing/storage/)).

---

## 11. Other notable findings

- **Multi-region / data residency**: geofencing config per call type or per call — inclusion fences (`european_union`, `united_states`, `canada`, `united_kingdom`, `india`) and exclusion fences (`china_exclusion`, `russia_exclusion`, `belarus_exclusion`, `iran_north_korea_syria_exclusion`) constrain which edge nodes serve a call; restricting *user access* by region is possible but support-configured only; UAE video disabled by default for TDRA compliance ([geofencing](https://getstream.io/video/docs/api/call-types/geofencing/)). Enterprise adds "dedicated AWS region stacks" ([enterprise page](https://getstream.io/enterprise/), via root llms.txt). Multi-tenancy: `team` field on calls + user teams ([multi-tenancy](https://getstream.io/docs/platform/multi-tenancy/)).
- **Reconnect/resume**: `CallingState.RECONNECTING/RECONNECTING_FAILED/OFFLINE/MIGRATING` (SFU shutdown/rebalance migration) with documented state diagrams ([calling state & lifecycle](https://getstream.io/video/docs/javascript/guides/calling-state-and-lifecycle/)); network-disruption cookbook ([network disruptions](https://getstream.io/video/docs/javascript/ui-cookbook/network-disruption/)); WS heartbeats via `health.check` ([events](https://getstream.io/video/docs/javascript/guides/events/)).
- **E2EEE**: call-type-level encryption mode (auto-on/available/disabled, fixed at creation); client `EncryptionManager` (AES-128/256-GCM), keys distributed out-of-band ("Never send key material through Stream"); SFU forwards ciphertext only ([E2EE guide](https://getstream.io/video/docs/javascript/guides/end-to-end-encryption/)).
- **SIP trunking**: inbound trunks, routing rules, DTMF (with `call.dtmf` events + seq ordering), Twilio/Telnyx quickstarts ([SIP overview](https://getstream.io/video/docs/api/sip/overview/), [DTMF](https://getstream.io/video/docs/api/sip/dtmf/)).
- **Platform coverage beyond JS**: Flutter ([docs](https://getstream.io/video/docs/flutter/)), Unity ([docs](https://getstream.io/video/docs/unity/)), ESP32 embedded ([docs](https://getstream.io/video/docs/esp32/)) all listed as first-class client SDKs ([overview](https://getstream.io/video/docs/)). RN specifics: Expo config plugin (`@stream-io/video-react-native-sdk` plugin w/ `androidKeepCallAlive`), background keep-alive via Android foreground service + iOS CallKit (`@stream-io/react-native-callingx`), ringing via FCM/APNs-VOIP + CallKit, deep linking, PiP ([installation RN](https://getstream.io/video/docs/react-native/setup/installation/react-native/), [Expo](https://getstream.io/video/docs/react-native/setup/installation/expo/), [keep alive](https://getstream.io/video/docs/react-native/guides/keeping-call-alive/), [ringing](https://getstream.io/video/docs/react-native/advanced/incoming-calls/ringing/)).
- **Ringing calls**: first-class flow — `ring: true` creation, `call.ring`/`call.accepted`/`call.rejected` (reasons decline/cancel/timeout/busy)/`call.missed`, per-type timeouts `incoming_call_timeout_ms`/`auto_cancel_timeout_ms` (15s on `default`) ([ring calls](https://getstream.io/video/docs/api/ring-calls/), [call lifecycle](https://getstream.io/video/docs/api/call-lifecycle/), [JS ringing](https://getstream.io/video/docs/javascript/advanced/ringing-calls/)).
- **Analytics/QA surfaces**: call attendance, participant metrics with timelines, downloadable user feedback, daily digest, WebRTC stats reports (`call.stats_report_ready`, `getCallStats`) ([analytics pages](https://getstream.io/video/docs/api/analytics/call-attendance/), [stats](https://getstream.io/video/docs/api/quality/stats/), [client stats](https://getstream.io/video/docs/javascript/advanced/stats/)); connection test page ([connection test](https://getstream.io/video/docs/api/quality/connection-test/)).
- **GDPR**: soft/hard delete of calls incl. members/sessions/recordings/transcriptions ([deleting calls](https://getstream.io/video/docs/api/gdpr/calls/)).
- **Developer tooling**: Stream CLI + "Agent Skills" for AI agents, docs readable as markdown with `llms.txt` index ([overview](https://getstream.io/video/docs/), [llms.txt](https://getstream.io/llms.txt)). Vision Agents (separate OSS framework, powered by Stream Video) for AI participants ([visionagents.ai](https://visionagents.ai), [root llms.txt](https://getstream.io/llms.txt)).
- **Not found in docs**: per-feature SLA breakdown beyond marketing claims (99.999% uptime, ~9ms median API) ([root llms.txt](https://getstream.io/llms.txt)); hard max-participant limits per call mode; video-side equivalent of Chat's `before-message-send` custom hook/middleware (the webhooks compression page explicitly mentions the chat hook only — [platform webhooks](https://getstream.io/docs/platform/webhooks/)); public edge PoP list (edges only via API/latency test).
