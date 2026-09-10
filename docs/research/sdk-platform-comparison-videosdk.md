# VideoSDK (videosdk.live) — SDK & API Surface Research

Researched 2026-09-10 from primary sources only: official docs (docs.videosdk.live), official REST API reference (docs.videosdk.live/api-reference), and official npm packages (npmjs.com / registry.npmjs.org, maintained by VideoSDK staff `arjunkavazujo` / `_chintan_`). Every claim carries its source URL. Items the docs don't cover are explicitly marked **not found in docs**.

---

## 1. Package landscape

**Client SDKs (official `@videosdk.live` npm scope):**

| Package | Version (2026-09) | Role | Source |
|---|---|---|---|
| `@videosdk.live/js-sdk` | 1.1.1 | Vanilla JS browser client SDK (Meeting/Participant classes, WebRTC). Also distributable via `<script src="https://sdk.videosdk.live/js-sdk/1.1.1/videosdk.js">` | https://www.npmjs.com/package/@videosdk.live/js-sdk ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start |
| `@videosdk.live/react-sdk` | 1.1.1 | React bindings: `MeetingProvider`, hooks (`useMeeting`, `useParticipant`, `usePubSub`). Depends on `@videosdk.live/js-sdk@1.1.1`, `react-tracked@2.0.1`, `events@^3.3.0` (i.e. React SDK is a wrapper over the JS SDK) | https://www.npmjs.com/package/@videosdk.live/react-sdk |
| `@videosdk.live/react-native-sdk` | 1.0.1 | React Native (iOS/Android) client SDK | https://www.npmjs.com/package/@videosdk.live/react-native-sdk |
| `@videosdk.live/rtc-js-prebuilt` | 0.3.46 | "No Code Prebuilt" — drop-in full meeting UI | https://www.npmjs.com/package/@videosdk.live/rtc-js-prebuilt (docs: https://docs.videosdk.live/docs/realtime-communication/sdk-reference/prebuilt-sdk-js/setup) |

**Server-side helpers:**

- `@videosdk.live/server-sdk` (npm, v0.1.1, MIT) — official Node/TypeScript server SDK wrapping the v2 REST API; same functionality also shipped as Go (`github.com/videosdk-live/videosdk-server-sdk-go`) and Rust (`videosdk-server-sdk` crate): rooms, tokens, recordings, HLS, RTMP, telephony, AI agents, webhook verification. Requires Node 18+ / Go 1.23+ / Rust 1.75+. https://docs.videosdk.live/server-sdk/introduction ; https://www.npmjs.com/package/@videosdk.live/server-sdk
- Reference API docs: Node https://docs.videosdk.live/server-sdk-reference-node/ , Go https://pkg.go.dev/github.com/videosdk-live/videosdk-server-sdk-go , Rust https://docs.rs/videosdk-server-sdk (linked from https://docs.videosdk.live/server-sdk/introduction)
- Token-server examples in many languages (official repos): https://github.com/videosdk-live/videosdk-rtc-api-server-examples (linked from https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/server-setup)

**Companion/auxiliary packages (all official scope, via npm registry search `@videosdk.live`):**
- React Native ecosystem: `@videosdk.live/react-native-webrtc` (their fork), `react-native-incallmanager`, `react-native-foreground-service`, `react-native-pip-android`, `react-native-media-effects` (virtual backgrounds), `expo-config-plugin`, `expo-ios-screen-share`. https://registry.npmjs.org/-/v1/search?text=%40videosdk.live
- Web media extras: `videosdk-media-processor-web`, `videosdk-virtual-background-web`, `videosdk-noise-suppressor-web`, `videosdk-face-detection-web`, `room-stats`, `speedtest` (bandwidth measurement component). Same registry search.
- Quickstart monorepo with runnable samples (`react-rtc`, `js-rtc`, `js-hls`, `interactive-live-streaming/js-ils`): https://github.com/videosdk-live/quickstart (linked from both quickstarts above).

---

## 2. Auth model

- Credentials: `API_KEY` + `SECRET` from the dashboard (https://app.videosdk.live/api-keys). https://docs.videosdk.live/api-reference/realtime-communication/intro
- Everything is a **JWT signed with HS256** using the secret. Payload: `apikey` (mandatory), `permissions` (mandatory): `allow_join` | `ask_join` | `allow_mod`; optional `version` (must be `2` for v2 API and required when using `roomId`/`participantId`/`roles`), `roomId` (bind token to one room), `participantId` (bind to one participant), `roles`: `crawler` (server-API-only token) vs `rtc` (join-only token). https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/server-setup and https://docs.videosdk.live/api-reference/realtime-communication/intro
- **Permissions embedded in the token are deliberately minimal and exhaustive**: they control only entry mode (`allow_join`/`ask_join`) and moderation (`allow_mod`). No token permission restricts publishing, screen share, recording, etc. — docs explicitly tell you to enforce that in your own app/server. https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/server-setup (note block)
- Without grants, a token defaults to `allow_join` + `allow_mod`. https://docs.videosdk.live/server-sdk/authentication-and-tokens
- Two token classes: **management tokens** (server→API; SDK generates/refreshes automatically) and **participant tokens** (server→client, to join a room); builder API `accessToken().setParticipant().grant().forRoom().expiresIn().toJwt()`. https://docs.videosdk.live/server-sdk/authentication-and-tokens
- REST auth scheme: `Authorization: <jwt>` header with **no prefix** ("not include any prefix such as 'Basic ' or 'Bearer '"). https://docs.videosdk.live/api-reference/realtime-communication/create-room
- Token generation must happen **server-side** in production (dashboard-issued temp tokens only for dev); docs warn that a token cannot restrict the join mode — any valid token holder can join `SEND_AND_RECV`. https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/server-setup ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start-ILS (caution box)
- Token is validated once at join; expiry mid-meeting is harmless. Expired token → join fails with "Token is invalid or expired". https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/server-setup
- Client passes token via `VideoSDK.config(token)` before `initMeeting`. https://docs.videosdk.live/javascript/api/sdk-reference/initMeeting

---

## 3. Client SDK architecture

Main objects (JS SDK; React SDK wraps the same core):

- **`VideoSDK`** namespace: `config(token)` then factory `initMeeting(params)` returns a **`Meeting`** instance. https://docs.videosdk.live/javascript/api/sdk-reference/initMeeting
- `initMeeting` params: `meetingId`*, `name`*, `participantId`, `micEnabled` (default true), `webcamEnabled` (default true), `maxResolution` `sd|hd`, `multiStream` (default true), `customCameraVideoTrack`/`customMicrophoneAudioTrack` (MediaStream), `mode` (`SEND_AND_RECV` | `SIGNALLING_ONLY`; default SEND_AND_RECV), `metaData`, `debugMode`. https://docs.videosdk.live/javascript/api/sdk-reference/initMeeting (React's `MeetingProvider` adds `RECV_ONLY` mode: https://docs.videosdk.live/react/api/sdk-reference/meeting-provider)
- **`Meeting` class** — properties: `id`, `activeSpeakerId`, `activePresenterId`, `hlsState`, `livestreamState`, `recordingState`, `hlsUrls`, `localParticipant`, `participants` (Map), `pubsub`, `selectedCameraDevice`, `selectedMicrophoneDevice`. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/introduction
- Meeting methods: `join`, `leave`, `end`, `enableWebcam`/`disableWebcam`, `unmuteMic`/`muteMic`, `enableScreenShare`/`disableScreenShare`, `startRecording`/`stopRecording`, `startLiveStream`/`stopLiveStream`, `startHls`/`stopHls`, `startTranscription`/`stopTranscription`, `startWhiteboard`/`stopWhiteboard`, `getWebcams`/`changeWebcam`/`setWebcamQuality`, `getMics`/`changeMic`, `on`/`off`, `pauseAllStreams`/`resumeAllStreams`, `requestMediaRelay`/`stopMediaRelay`, `switchTo`, `send`, `uploadBase64File`/`fetchBase64File`. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/introduction
- **`Participant` class** — properties `id`, `displayName`, `streams`, `metaData`; methods `enableWebcam`/`disableWebcam`, `enableMic`/`disableMic`, `pin`/`unpin`, `remove`, `setQuality`, `setViewPort`, `getAudioStats`/`getVideoStats`/`getShareStats`/`getShareAudioStats`/`getTransportStats`, `captureImage`; events `stream-enabled`, `stream-disabled`, `media-status-changed`. Local via `meeting.localParticipant`, remotes via `meeting.participants` Map. https://docs.videosdk.live/javascript/api/sdk-reference/participant-class/introduction
- **Lifecycle / initialization flow**: create room via REST `POST /v2/rooms` → `config(token)` → `initMeeting(...)` → register event handlers → `await meeting.join()`. Since v1.0.0 SDK methods are async Promises; `join()` resolves when the join request is *accepted* — wait for `meeting-joined` before other calls. https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start
- `ask_join` tokens: `join()` doesn't join directly — an `entry-requested` event fires on `allow_join` participants, decision comes back as `entry-responded` (waiting-lobby flow). https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods
- `leave()` (self), `end()` (ends session for everyone). https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods
- **State exposure**: vanilla JS = pull properties + event callbacks; React = context + hooks (see §6). Docs terminology page defines Meeting/Participant/Streams/Active speaker/Active presenter/Main participant. https://docs.videosdk.live/api-reference/realtime-communication/architecture
- Typed API references (typedoc): JS https://docs.videosdk.live/js-sdk-reference/ , React https://docs.videosdk.live/react-sdk-reference/ (linked from https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording-and-live-streaming/record-meeting and search index)

---

## 4. Event model

- Vanilla JS: `meeting.on("event-name", handler)` / `participant.on(...)` / `.off()`; event names are **kebab-case strings**. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start
- React: the same events surface as **`onXxx` callback props** to `useMeeting`/`useParticipant` (`onMeetingJoined`, `onParticipantJoined`, `onStreamEnabled`, …). https://docs.videosdk.live/react/api/sdk-reference/use-meeting/introduction
- `VideoSDK.Constants` enum-like helpers (`Constants.modes`, `Constants.recordingEvents`, `Constants.hlsEvents`). https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording-and-live-streaming/record-meeting ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start-js-ils

Meeting event categories (full list): https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/introduction
- Lifecycle: `meeting-joined`, `meeting-left`, `meeting-state-changed`, `error`
- Participants: `participant-joined`, `participant-left`, `participant-mode-changed`, `speaker-changed`, `presenter-changed`
- Entry/moderation consent: `entry-requested`, `entry-responded`, `webcam-requested`, `mic-requested`
- Egress state: `recording-started`/`recording-stopped` (+`recording-state-changed`), `livestream-started`/`stopped`, `hls-started`/`stopped` (+ `hls-state-changed` in React), `whiteboard-started`/`stopped`
- AI: `transcription-state-changed`, `transcription-text`
- Stream control / network: `paused-all-streams`, `resumed-all-streams`, `quality-limitation`
- Cross-room: `media-relay-request-received`, `media-relay-request-response`, `media-relay-started`, `media-relay-stopped`, `media-relay-error`
- Data channel: `data`

Participant events: `stream-enabled`, `stream-disabled`, `media-status-changed`. https://docs.videosdk.live/javascript/api/sdk-reference/participant-class/introduction

Server-side (webhook) event model: see §8.

---

## 5. Media layer

**Topology:**
- The docs' architecture page defines terminology only (Meeting/Participant/Streams/speakers) — no SFU/P2P statement on it: https://docs.videosdk.live/api-reference/realtime-communication/architecture
- VideoSDK's official interactive-live-streaming page states hosts/co-hosts connect through a **Selective Forwarding Unit (SFU) on a global edge network** (official site, marketing page): https://www.videosdk.live/interactive-live-streaming — an explicit topology statement in the developer docs themselves: **not found in docs**.
- Scale claims: js-sdk npm page advertises "5,000+ participants" (https://www.npmjs.com/package/@videosdk.live/js-sdk); the low-latency ILS quickstart documents **up to 100 hosts/co-hosts and 2,000 viewers in real-time (WebRTC)**, with HLS recommended for standard streaming at "6-7 second latency" with playback support: https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start-js-ils and https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start-ILS
- Participant modes: `SEND_AND_RECV` (produce+consume), `RECV_ONLY` (audience, consume-only), `SIGNALLING_ONLY` (no media; used for HLS viewers). https://docs.videosdk.live/react/api/sdk-reference/meeting-provider ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start-js-ils

**Remote track consumption:**
- Streams arrive per-participant as `stream-enabled` events carrying a stream object with `kind` (`video` | `audio` | `share` | `share_audio`) and a raw `track` (MediaStreamTrack). You wrap it yourself: `new MediaStream(); mediaStream.addTrack(stream.track); videoElm.srcObject = mediaStream`. Canonical pattern shown in the custom-template example. https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording/custom-template
- In React, tracks are exposed declaratively: `webcamStream`, `micStream`, `screenShareStream` + boolean `webcamOn`/`micOn`/`screenShareOn` from `useParticipant`. https://docs.videosdk.live/react/api/sdk-reference/use-participant/introduction

**Simulcast / quality:**
- `multiStream: true` (default) = "send multi resolution streams while publishing video". https://docs.videosdk.live/javascript/api/sdk-reference/initMeeting
- Downstream selection: `participant.setQuality("low"|"med"|"high")` and `participant.setViewPort(width, height)` (quality driven by rendered viewport). https://docs.videosdk.live/javascript/api/sdk-reference/participant-class/methods

**Device controls:** `getWebcams()`, `changeWebcam()`, `setWebcamQuality()`, `getMics()`, `changeMic()` + `selectedCameraDevice` / `selectedMicrophoneDevice` state. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/introduction ; React docs also offer a pre-join **Precall** screen for device/network testing: https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/setup-call/precall

**Other media capabilities:** custom tracks on join (`customCameraVideoTrack`/`customMicrophoneAudioTrack`, https://docs.videosdk.live/javascript/api/sdk-reference/initMeeting); screen share with `presenter-changed` (https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods); WebRTC stats per participant/stream — jitter, bitrate, packetsLost, rtt, codec, plus transport `availableBitrate`/`targetBitrate` (https://docs.videosdk.live/javascript/api/sdk-reference/participant-class/methods); data channel `meeting.send(payload, {reliability: "reliable"|"unreliable"})` max **15 KiB** (https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods); cross-room **media relay** ("PK host" battles) via `requestMediaRelay({destinationMeetingId, token, kinds})` with accept/reject consent on destination (https://docs.videosdk.live/javascript/guide/interactive-live-streaming/relay-media).

---

## 6. React bindings

- **Provider/consumer model**: `MeetingProvider` (React context) takes `token` + config (`meetingId`, `name`, `micEnabled`, `webcamEnabled`, `participantId`, `multiStream`, custom tracks, `mode`, `metaData`, `debugMode`, and `joinWithoutUserInteraction` — auto-join without calling `join()`, mutually exclusive with manual `join()`). `MeetingConsumer` is the render-prop escape hatch. https://docs.videosdk.live/react/api/sdk-reference/meeting-provider ; https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/quick-start
- **`useMeeting`**: returns state (`meetingId`, `localParticipant`, `mainParticipant`, `activeSpeakerId`, `presenterId`, `pinnedParticipants`, `participants`, `localMicOn`/`localWebcamOn`/`localScreenShareOn`, `isRecording`, `isLiveStreaming`, `hlsState`, `livestreamState`, `recordingState`, `hlsUrls`, `selectedCameraDevice`, `selectedMicrophoneDevice`) + actions (`join`/`leave`/`end`, `toggleMic`/`toggleWebcam`/`toggleScreenShare`, `startRecording`/`stopRecording`, `startHls`/`stopHls`, `startLivestream`, `changeMode`, `changeWebcam`/`changeMic`, `pauseAllStreams`/`resumeAllStreams`, `requestMediaRelay`, `switchTo`, `send`, player controls `startVideo`/`seekVideo`/`pauseVideo`) and accepts ~35 `onXxx` event callbacks. https://docs.videosdk.live/react/api/sdk-reference/use-meeting/introduction
- **`useParticipant(participantId, events)`**: `displayName`, `webcamStream`, `micStream`, `screenShareStream`, `webcamOn`, `micOn`, `screenShareOn`, `isLocal`, `isActiveSpeaker`, `mode`, `metaData`; methods `enableMic`/`disableMic`, `enableWebcam`/`disableWebcam`, `pin`/`unpin`, `remove`, `setQuality`, stats getters, `captureImage`. https://docs.videosdk.live/react/api/sdk-reference/use-participant/introduction
- **`usePubSub(topic, {onMessageReceived, onOldMessagesReceived})`** → `{ publish, messages }`; `publish(message, {persist, sendOnly}, payload)`; persisted messages replay to late joiners. https://docs.videosdk.live/react/api/sdk-reference/use-pubsub
- **State management approach**: context + `react-tracked` (proxy-based fine-grained tracking) per the package's dependency list — https://www.npmjs.com/package/@videosdk.live/react-sdk . Docs describe the Meeting Context as re-rendering consumers on change: https://docs.videosdk.live/react/guide/video-and-audio-calling-api-sdk/quick-start
- **Components**: the React SDK ships **no UI components** — hooks/provider only (per the API reference sections above). Ready-made UI is a separate product: `@videosdk.live/rtc-js-prebuilt` (https://www.npmjs.com/package/@videosdk.live/rtc-js-prebuilt) and HLS UI-kit examples (https://github.com/videosdk-live/videosdk-hls-react-sdk-example).

---

## 7. REST API (v2)

- **Base URL**: `https://api.videosdk.live`. https://docs.videosdk.live/api-reference/realtime-communication/intro
- **Auth**: `Authorization: <JWT>` (raw, no Bearer/Basic prefix), token per §2; `Content-Type: application/json` on writes. https://docs.videosdk.live/api-reference/realtime-communication/create-room
- **Scope per intro page**: "APIs for Rooms, Sessions, Recordings, RTMP and HLS". https://docs.videosdk.live/api-reference/realtime-communication/intro
- **Pagination**: `page` and `perPage` query params (e.g. `GET https://api.videosdk.live/v2/sessions/?roomId=xyz&customRoomId=xyz&page=1&perPage=20`). https://docs.videosdk.live/api-reference/realtime-communication/fetch-session . The server SDK additionally exposes cursor-based iteration (`page`, `perPage`, cursor, `hasNextPage`, async-iterable pages): https://docs.videosdk.live/server-sdk/pagination
- Responses use HATEOAS-ish `links` (e.g. `get_room`, `get_session`). https://docs.videosdk.live/api-reference/realtime-communication/start-hlsStream

**Verified resource endpoints (doc pages fetched):**

| Resource | Endpoints | Source |
|---|---|---|
| Rooms | `POST /v2/rooms` (create; body: `customRoomId`, `webhook{endPoint,events}`, `autoCloseConfig{type,duration}`, `autoStartConfig{recording,hls}`), validate, fetch details, deactivate, end session | https://docs.videosdk.live/api-reference/realtime-communication/create-room ; /validate-room ; /fetch-room-details ; /deactivate-room ; /end-session |
| Sessions | `GET /v2/sessions/` (list, filter `roomId`/`customRoomId`, paged), fetch session, session quality stats | https://docs.videosdk.live/api-reference/realtime-communication/fetch-session ; /fetch-session-quality-stats (linked from https://docs.videosdk.live/javascript/api/sdk-reference/participant-class/methods) |
| Participants | fetch (all) participants of a session | https://docs.videosdk.live/api-reference/realtime-communication/fetch-participants |
| Recordings | start/stop room recording (config + `awsDirPath` + `templateUrl`), start participant recording, start track recording, fetch recordings | https://docs.videosdk.live/api-reference/realtime-communication/start-recording ; /start-participant-recording ; /start-track-recording ; /fetch-recordings |
| HLS | `POST /v2/hls/start`, `POST /v2/hls/end` (body: `roomId`, `templateUrl`, `transcription`, `summary`, `config`) → `playbackHlsUrl`, `livestreamUrl`, `downstreamUrl` (deprecated) | https://docs.videosdk.live/api-reference/realtime-communication/start-hlsStream ; /stop-hlsStream |
| RTMP livestream | start/stop livestream to external RTMP endpoints | https://docs.videosdk.live/api-reference/realtime-communication/start-livestream |
| Transcription | start/stop realtime transcription; post-transcription + summary fetch under separate base `https://api.videosdk.live/ai/v1/post-...` | https://docs.videosdk.live/api-reference/realtime-communication/start-realtime-transcription ; /stop-realtime-transcription ; /fetch-a-post-transcription-summary |
| Post-processing | composite-merge transcode jobs + cancel | https://docs.videosdk.live/api-reference/realtime-communication/cancel-composite-merge (also webhook list §8) |
| SIP/telephony webhooks CRUD | create/fetch webhooks (registered per user, event subscriptions) | https://docs.videosdk.live/api-reference/realtime-communication/sip/webhook/create-webhook ; /sip/webhook/fetch-all-webhooks |

- **Templates**: a dedicated `/v2/templates`-style REST resource — **not found in docs** (probes of `list-templates`/`update-template`/`fetch-templates` pages 404). Layout "templates" are instead a `templateUrl` parameter on recording/HLS/livestream start (https://docs.videosdk.live/api-reference/realtime-communication/start-hlsStream; tutorial: https://docs.videosdk.live/docs/tutorials/customized-layout).
- The newer **server SDK** surface (mirrors v2 REST) enumerates the full resource map: Rooms, Sessions, Participants, Recordings, HLS, RTMP, Transcription, Transcodings, **WHIP, WHEP, Socket ingest, SIP, Batch calls, Connectors, AI Agents**, Webhooks. https://docs.videosdk.live/server-sdk/introduction
- Room semantics: `roomId` == `meetingId`; creation is idempotent on `customRoomId`; `geoFence` regions (`us002`, `eu001`, `in002`, …); `allowedParticipantIds` join restriction. https://docs.videosdk.live/server-sdk/reference/rooms
- Official Postman workspace: linked from every endpoint page, e.g. https://docs.videosdk.live/api-reference/realtime-communication/create-room
- Server-side examples (Node/PHP/Rust): https://docs.videosdk.live/api-reference/realtime-communication/server-side-examples-nodejs etc.

---

## 8. Webhooks

- **Registration**: per-room at creation (`webhook: {endPoint, events: [...]}`, supporting exact names, `*`, and regex patterns like `recording-*`), and per-operation `webhookUrl` (e.g. `startRecording(webhookUrl, ...)`, recording `webhookUrl` option). https://docs.videosdk.live/api-reference/realtime-communication/create-room ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording-and-live-streaming/record-meeting ; https://docs.videosdk.live/server-sdk/reference/recordings/room
- **Payload shape**: `{ "webhookType": "<event>", "data": { ... } }` — `data` always carries `meetingId`/`sessionId` plus event fields; recording events carry composer resource `id` and on completion `filePath`/`fileUrl` (+ `encryption{keyUrl,metaUrl}` when encrypted); HLS events carry `playbackHlsUrl`/`livestreamUrl` (`downstreamUrl` deprecated). https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks
- **Event list** (same page): participant (`participant-joined`, `participant-left`), session (`session-started`, `session-ended` with `reason`/`error`), recording lifecycle (`recording-starting/started/stopping/stopped/failed`), participant recording (`participant-recording-*`), track recording (`participant-track-recording-*`), merge (`merge-recording-completed/failed`), composite merge (`composite-merge-started/completed/failed/cancelled`), composite recording (`composite-recording-*`), transcription/translation (`transcription-started/stopped/failed` with `type: "post"|"realtime"`, `translation-*`), knowledge base (`knowledgebase-processing/activated/failed`), livestream RTMP (`livestream-starting/started/stopping/stopped/failed`), HLS (`hls-starting/started/playable/stopping/stopped/failed`), resource pooling (`resource-acquired`/`resource-released`), AI agents (`agent-session-starting/started/stopping/stopped/failed`), batch calls (`batchcall-started/completed`), and SIP call events (`call-started/answered/ringing/missed/hangup/update`, `call-transfer-*`, `switch-room-*`). Full payloads with examples at the URL above.
- **Signature verification**: every delivery is signed with **RSA-SHA256 over the raw request body**, delivered in the `videosdk-signature` header (base64). The RSA **public key is fetched from `https://api.videosdk.live/v2/public/rsa-public-key`** (GET); you recompute and compare. https://docs.videosdk.live/api-reference/realtime-communication/webhook-verification
- Server SDK helper: `client.webhooks.verify(rawBody, signature)` (needs the **raw unparsed** body; public key fetched+cached, or pinned via config; Rust SDK: manual verification). https://docs.videosdk.live/server-sdk/reference/webhooks
- **Retry policy**: **not found in docs** — neither the webhooks list nor the verification page specifies retry/backoff behavior (checked 2026-09-10).
- SIP webhooks have a separate CRUD API + config doc: https://docs.videosdk.live/api-reference/realtime-communication/sip/webhook/create-webhook ; https://docs.videosdk.live/telephony/managing-calls/sip-webhooks

---

## 9. Recording / egress

**Recording modes** (all verified in docs):
1. **Room (composed) recording** — single composited file; client `meeting.startRecording(webhookUrl, awsDirPath, config, transcription)` or REST `POST /v2/recordings/start`-equivalent (`start-recording`). Config: `layout{type: GRID|SPOTLIGHT|SIDEBAR, priority: SPEAKER|PIN, gridSize ≤4}`, `theme: DARK|LIGHT|DEFAULT`, `mode: video-and-audio|audio`, `quality: low|med|high` (SD/HD/FHD), `orientation: landscape|portrait`. https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording-and-live-streaming/record-meeting ; https://docs.videosdk.live/api-reference/realtime-communication/start-recording
2. **Participant recording** — record one participant (audio+video) to `webm`; REST `start-participant-recording` (roomId + participantId). https://docs.videosdk.live/api-reference/realtime-communication/start-participant-recording
3. **Participant track recording** — per-track (`kind: audio|video`, `fileFormat: webm`); REST `start-track-recording`. https://docs.videosdk.live/api-reference/realtime-communication/start-track-recording
4. **Composite recording / composite-merge** — server-side merge of participant recordings into one MP4 (`composite-recording-*`, `composite-merge-*` webhooks; `cancel-composite-merge` API). https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks ; /cancel-composite-merge
5. **Auto-start** — `autoStartConfig.recording` / `.hls` on room creation (optionally with transcription+summary and layout). https://docs.videosdk.live/api-reference/realtime-communication/create-room

**Storage options:**
- VideoSDK cloud (files in dashboard https://app.videosdk.live/meetings/recordings, CDN `fileUrl`) **or customer-owned storage**: AWS S3, Azure Blob, GCP Cloud Storage configured in the dashboard; `awsDirPath` param for bucket paths. https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording-and-live-streaming/record-meeting (Storage Configuration section)
- Newer server SDK adds `preSignedUrl` (upload straight to your bucket) and `dirPath` prefix; `fileUrl` is `null` in webhooks when stored on your own credentials. https://docs.videosdk.live/server-sdk/reference/recordings/room ; https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks
- Recording **encryption** supported (`encryption.keyUrl`/`metaUrl` in `recording-stopped`). https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks
- Enterprise **resource pooling**: pre-reserve a recorder resource (`resourceId`) to remove recording start-up delay. https://docs.videosdk.live/server-sdk/reference/recordings/room

**HLS egress:** `startHls`/`stopHls` from SDK or `POST /v2/hls/start` REST; `hls-playable` webhook + `hlsUrls` give `playbackHlsUrl` (with DVR playback) and `livestreamUrl` (live-only); playback with standard `hls.js`; portrait orientation, quality, themes; can bundle recording + transcription on the HLS job. https://docs.videosdk.live/api-reference/realtime-communication/start-hlsStream ; https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/quick-start-ILS ; https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks
- RTMP restream out to external platforms: `start-livestream` REST + `livestream-*` webhooks. https://docs.videosdk.live/api-reference/realtime-communication/start-livestream

**Post-processing (AI):**
- **Post transcription + summary**: enabled in recording/HLS config (`transcription{enabled, summary{enabled, prompt}}`); transcripts fetched via Post Transcription API (`https://api.videosdk.live/ai/v1/post-...`). https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording-and-live-streaming/record-meeting ; https://docs.videosdk.live/api-reference/realtime-communication/fetch-a-post-transcription-summary
- **Realtime transcription & translation**: `meeting.startTranscription()` / REST `start-realtime-transcription`; live text via `transcription-text` events; `translation-*` webhooks. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/introduction ; https://docs.videosdk.live/api-reference/realtime-communication/start-realtime-transcription ; https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks
- Whiteboard egress exists (`startWhiteboard`/`stopWhiteboard`). https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/introduction

---

## 10. Notable extras

- **Custom UI templates for egress**: recording/HLS/RTMP render any web page you host (`templateUrl`). The "VideoSDK Template Engine" opens the URL as a hidden participant — query params `token`, `meetingId`, `participantId` (auto-added) let it join invisibly — and you drive the layout at runtime over **PubSub topics**. Sample: https://github.com/videosdk-live/videosdk-custom-recording-template-js-example . https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/recording/custom-template
- **Prebuilt no-code UI**: `@videosdk.live/rtc-js-prebuilt` for full meeting UI without building components. https://www.npmjs.com/package/@videosdk.live/rtc-js-prebuilt
- **Playground**: only an **AI Agents Playground** is documented (interactive agent testing: https://docs.videosdk.live/ai_agents/playground). A general in-browser meeting playground — **not found in docs**. Local setup story = clone https://github.com/videosdk-live/quickstart + run a token server from https://github.com/videosdk-live/videosdk-rtc-api-server-examples.
- **Simulcast**: `multiStream` on publish + `setQuality`/`setViewPort` on subscribe (see §5). Dynamic receive-side quality switching is SDK-level, no server call.
- **Runtime permissions / moderation**: token `allow_mod` lets a participant call `participant.disableMic()`/`disableWebcam()` on others — the target gets `mic-requested`/`webcam-requested` consent events; `participant.remove()` kicks; `meeting.end()` ends the session for all. All client-SDK driven. https://docs.videosdk.live/javascript/api/sdk-reference/participant-class/methods . A REST API to mute a specific remote participant — **not found in docs** (REST surface is rooms/sessions/participants-read/recordings/etc.; no mute endpoint documented).
- **Waiting lobby**: `ask_join` token permission → `entry-requested`/`entry-responded` admission flow. https://docs.videosdk.live/javascript/guide/video-and-audio-calling-api-sdk/setup-call/waiting-lobby ; https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods
- **Room switching without reconnect**: `meeting.switchTo(meetingId, token)`. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods
- **Cross-room media relay** ("PK battles"): see §5. https://docs.videosdk.live/javascript/guide/interactive-live-streaming/relay-media
- **Geo-fenced media regions** (`us002`, `eu001`, `in002`, …) chosen at room creation. https://docs.videosdk.live/server-sdk/reference/rooms
- **AI platform breadth** (newer surface): AI voice agents (join rooms, `agent-session-*` webhooks, Agents Playground), knowledge bases (`knowledgebase-*` webhooks), batch outbound calling, SIP/telephony gateways with transfer + room switching, and standards-based **WHIP/WHEP** ingest/playback plus socket ingest. https://docs.videosdk.live/server-sdk/introduction ; https://docs.videosdk.live/api-reference/realtime-communication/user-webhooks ; https://docs.videosdk.live/ai_agents/playground
- **debugMode** ships SDK logs to the VideoSDK dashboard for troubleshooting. https://docs.videosdk.live/javascript/api/sdk-reference/initMeeting
- **Temporary file storage**: `meeting.uploadBase64File()`/`fetchBase64File()`. https://docs.videosdk.live/javascript/api/sdk-reference/meeting-class/methods
