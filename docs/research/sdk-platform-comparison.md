# SDK & API Platform Comparison: VideoSDK vs Stream vs Zvonok

Researched 2026-09-10 against primary sources only (official docs and GitHub of
both vendors; our own `openspec/specs/`, controllers, and package exports).
Raw citation-backed findings live in:

- [sdk-platform-comparison-videosdk.md](sdk-platform-comparison-videosdk.md) - VideoSDK
- [sdk-platform-comparison-getstream.md](sdk-platform-comparison-getstream.md) - Stream

This document condenses them and maps both models onto zvonok's current
surface. Zvonok column reflects implemented behavior per specs and code, not
aspirations.

## How each vendor is built (one paragraph each)

**VideoSDK** is a two-layer client story: `@videosdk.live/js-sdk` (vanilla
`Meeting`/`Participant` classes, kebab-case events) wrapped by
`@videosdk.live/react-sdk` (`MeetingProvider` + `useMeeting`/`useParticipant`
hooks over `react-tracked`), plus a no-code prebuilt UI package and a
server-side SDK family (Node/Go/Rust) that also does token minting and webhook
verification. One HS256 JWT model covers everything: management tokens for the
REST API and participant tokens whose only permissions are entry mode
(`allow_join`/`ask_join`) and moderation (`allow_mod`) - publishing rights are
deliberately not token-controlled. REST v2 covers rooms/sessions/recordings
(4 modes incl. per-participant and per-track)/HLS/RTMP/transcription. Webhooks
are RSA-signed and registered per room at creation time. Egress layouts are
customizable by hosting your own `templateUrl` page that joins as a hidden
participant and is driven over PubSub.

**Stream** is a three-layer monorepo: `@stream-io/video-client` (core client
with an RxJS reactive state store, runs in browser and Node) →
`video-react-bindings` (hooks) → `video-react-sdk` (components, theming, i18n)
plus a RN SDK sharing the same bindings layer. Auth is a public API key +
server-only secret; user JWTs are shared across all Stream products, video adds
call tokens (`call_cids` + role). The `Call` object (`type:id` CID, upsert
semantics, 4 built-in call types) fronts ~50 WS events that mutate ~30
observables per call; React consumes them through `useCallStateHooks()`
selectors. Media runs on cascading Go SFUs across a multi-DC edge network with
simulcast/"Dynascale" adaptive bitrate, AV1, Opus DTX+RED, and viewport-based
subscription pausing. Permissions are a role→capability grant system defined
per call type (~23 capabilities, runtime per-user grant/revoke that
auto-unpublishes tracks). Webhooks share one HMAC-signed event-hook system
with SQS/SNS alternatives.

## Comparison table

| Dimension | VideoSDK | Stream | Zvonok (today) |
|---|---|---|---|
| **Client layering** | js-sdk core → react-sdk wrapper → separate no-code prebuilt | video-client (RxJS state) → react-bindings (hooks) → react-sdk (UI) ; RN on same bindings | `@zvonok/client` core (module subpath exports) → `@zvonok/react` (thin hooks + `ZvonokRoom` prebuilt) |
| **Server SDK** | Yes - Node/Go/Rust incl. token mint + webhook verify | Yes - shared across Chat/Video/Feeds (7 langs) | No - plain REST `/v1` + docs |
| **Server credentials** | API key + secret, HS256 JWTs | Public API key + server-only secret, server JWT `{server:true}` | API key `zk_live_...` (Bearer), hashed in DB, revocable |
| **Client token** | JWT w/ `allow_join`/`ask_join`/`allow_mod`, optional room/participant binding | User JWT (+ call token w/ `call_cids`+role); `tokenProvider` auto-refresh; guest/anonymous | Short-lived room token: single-room bound, name + `publish` + `admin`, dies with key revocation |
| **Room/call model** | `roomId`; idempotent create; 3 join modes (SEND_AND_RECV / RECV_ONLY / SIGNALLING_ONLY) | `Call` = `type:id` CID, upsert; 4 built-in types + custom; members, backstage, ring, sessions | Room `id`+`slug`, status, `maxParticipants` 2-50, project-scoped |
| **State exposure** | Pull props + events; React via `react-tracked` fine-grained tracking | RxJS observables per property; ~30 per call; 250-participant truncation; comparator sorting | Pull + typed callbacks on `ISfuManager`; React layer keeps its own `RoomTracker` |
| **Client events** | Kebab-case strings; ~35 `onXxx` props in React | ~50 typed WS events; watch semantics (join/get/query) | Typed callbacks: peer/track lifecycle, join errors, kick, room-ended, quality |
| **Media topology** | SFU on global edge (docs silent, marketing only); simulcast + `setQuality`/`setViewPort` | Cascading Go SFUs, multi-DC, 100k-participant benchmark; Dynascale (AV1/VP8), Opus DTX+RED; viewport visibility pausing; TURN/TCP-443 | Single self-hosted mediasoup SFU; simulcast layers; stats collector + quality score |
| **React hooks** | `useMeeting`, `useParticipant`, `usePubSub` | `useCallStateHooks()` factory → ~20 selector hooks; full component catalogue + CSS-var theming + i18n; `EmbeddedCall` prebuilt | `useZvonokConnection`, `useParticipants`, `useHostControls`, `useDeviceControls`; `ZvonokRoom` namespaced-CSS prebuilt |
| **REST surface** | `/v2`: rooms, sessions, participants(read), recordings(4 modes), HLS, RTMP, transcription, merge | `/api/v2` + published OpenAPI: calls CRUD, members, mute, permissions grant/revoke, ring, go_live, broadcasts, recordings, transcriptions, calltypes, edges | `/v1`: rooms create/list/end, token mint, egress start/list/inspect/stop, recordings list/download(Range)/delete; `/developers` console surface |
| **Pagination** | `page`/`perPage` | Cursor `next`, Mongo-like filters | None - newest-first full lists |
| **Rate limits** | Undocumented in REST docs | Per-endpoint table + `X-RateLimit-*` headers + SDK auto-retry | Per-key; 60 req/min on mutations; 429 + `Retry-After` |
| **Permissions** | Token `allow_mod`; client-side mute/kick with consent events; no REST mute | Role→capability grants per call type; `own_capabilities` in responses; runtime per-user grant/revoke (auto-unpublish); permission-request workflow | Token booleans (`publish`, `admin`); signalling host controls (kick/mute/mute-all/lock) with typed denials |
| **Webhook config** | Per-room (`endPoint` + event list incl. `*`/regex) at creation | `event_hooks` array: multiple webhook/SQS/SNS endpoints per app | One endpoint per project via `/developers` |
| **Webhook signing** | RSA-SHA256, public key fetched from API | HMAC w/ API secret + `X-Webhook-Id` (dedupe across retries) + attempt counter; optional gzip | `X-Zvonok-Signature: sha256=HMAC(secret, "{ts}.{body}")` + `X-Zvonok-Timestamp` |
| **Webhook retries** | Not documented | 5 immediate attempts, 15s budget, no backoff; SQS/SNS for zero loss | 5 attempts, exponential backoff, best-effort, not persisted |
| **Webhook events** | Large catalogue: participant/session/recording(5 variants)/merge/transcription/HLS/RTMP/AI/SIP | Same event names as client WS (~50) with per-event schemas | 7: `room.started/joined/left/ended`, `egress.started/stopped/failed` |
| **Recording modes** | Room composite (layout GRID/SPOTLIGHT/SIDEBAR), participant, per-track, composite-merge | Composite (headless browser, custom CSS/URL), individual (≤6 files/participant), raw zip, frame (2s JPEGs for moderation) | One: server-side recording per egress session (composited output) |
| **Egress** | RTMP, HLS (playback + live URLs), auto-start on room create, `templateUrl` custom layouts | HLS (≤3 tracks), RTMP out, WHIP/SRT/RTMP ingest, backstage + `goLive` bundling | RTMP (1-3 endpoints) + HLS + record per session; one active session per room |
| **Recording storage** | Their cloud or own S3/Azure/GCS; encryption; resource pooling | Stream S3 (2-week retention) or BYO S3/GCS/Azure (≤10 configs) | Local disk on the deployment; numbered part files survive restarts |
| **Data channel / PubSub** | `meeting.send` 15 KiB; persisted PubSub topics (replay for late joiners) | `sendCustomEvent` 5 KB | None |
| **Extra surface** | Whiteboard, waiting lobby, media relay, room switching, AI agents, SIP/telephony, WHIP/WHEP | Chat integration, E2EEE, ring calls, RN/Flutter/Unity/ESP32, analytics, GDPR deletes, multi-tenancy | In-app whiteboard (yjs) and chat (not in SDK), screen share, docs site + quickstart |
| **Deployment** | SaaS (geo-fenced regions) | SaaS (multi-region, geofencing) | Self-hosted single deployment |

## Mapping to zvonok

### Where zvonok already matches the vendor pattern

- **Layering.** Core SDK + thin React bindings + prebuilt component is the same
  shape as VideoSDK's, and matches Stream's philosophy of "client ships state,
  UI is a layer on top". `ZvonokRoom` ≈ Stream's `EmbeddedCall` /
  VideoSDK's prebuilt.
- **Auth split.** Public-API-key-for-servers + short-lived scoped
  participant tokens is exactly the vendor model. The room token's
  room-binding and key-revocation propagation are guarantees VideoSDK's
  tokens don't document.
- **Webhook signing.** `HMAC(secret, "{ts}.{body}")` with a timestamp header
  is the same construction Stream uses (minus the dedupe id) and is better
  documented than VideoSDK's RSA scheme. Exponential backoff with 5 attempts
  sits between Stream (immediate, 15s) and undocumented.
- **Cross-project opacity.** 404 for "not found" and "not yours" alike
  matches Stream's security posture.
- **Per-key rate limits** with `Retry-After` are a real platform feature;
  VideoSDK doesn't document REST limits at all.

### Divergences that are by design (self-hosted, single region)

- Single SFU node, no edge network, no geo-selection - inherent to
  self-hosting, not an SDK gap.
- Local-disk recordings with part-file crash recovery instead of BYO cloud
  storage.
- No call types / no roles-per-type: one room shape with token booleans.

### Genuine gaps observed against both vendors

Ordered by how much they block external integrators:

1. **No data channel / PubSub.** Both vendors expose one (VideoSDK's is even
   persisted and replayable). This blocks interactive use cases (reactions,
   custom sync, driving external UIs) that a headless SDK audience will hit.
   VideoSDK's own custom-layout egress is built on top of PubSub - a
   demonstration of how load-bearing it is.
2. **No client audio-level / active-speaker hooks in `@zvonok/react`.** The
   primitives exist in `@zvonok/client/audio/*` but the React surface doesn't
   expose them; both vendors ship active/dominant speaker state.
3. **No pagination on `/v1` lists.** Fine at current scale; will bite every
   consumer with project growth. Both vendors paginate.
4. **No published OpenAPI for `/v1`.** Stream publishes its spec; our server
   already carries Swagger decorators - exposing the document is mostly a
   decision, not work.
5. **No server helper package.** Both vendors ship one; our REST is small
   enough that cURL examples suffice today. Revisit only if the API grows.
6. **Token permission granularity.** Spec allows per-media publish grants;
   the minted payload collapses to one `publish` boolean. Both vendors gate
   finer-grained rights (Stream per-capability, VideoSDK via `allow_mod` +
   client consent flows).
7. **Webhook delivery has no replay/log** (best-effort by spec) and one
   endpoint per project. Stream steers lossless consumers to SQS; for a
   self-hosted product a delivery log with replay-by-id may be the closer
   analog.

### Non-gaps worth recording

- **Join modes (viewer-only / signalling-only).** VideoSDK and Stream have
  audience modes; zvonok's rooms are 2-50 participant meetings. Absence is
  consistent with the product shape, not an oversight.
- **Whiteboard.** In-app only. VideoSDK ships `startWhiteboard` in its client
  SDK; if the whiteboard is part of the platform story for external
  developers, it is currently invisible to them.
- **Mobile.** No RN SDK. Both vendors treat mobile as a first-class client.
  Scope decision, not a defect.

Any of the gaps above would be a behavior/API change and therefore an OpenSpec
proposal, not a direct edit.

## Update 2026-09-10 (post-0.3.0 wave)

The 0.3.0 wave closed gap 6 (token permissions are now a `role` enum
resolving to server-side capability bundles, with ack-based host actions and
`useOwnCapabilities`) and added client-initiated egress control with
`egress.recording_ready`. Remaining open gaps: 1 (PubSub/data channel),
2 (active-speaker hooks in `@zvonok/react`), 3 (pagination), 4 (published
OpenAPI), 5 (server helper package), 7 (webhook delivery log/replay). The
"Zvonok (today)" column above reflects the pre-wave state and is kept as the
research-time snapshot.
