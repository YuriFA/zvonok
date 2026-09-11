# Platform Gap Audit: What zvonok Still Lacks for External Integrators

Audited 2026-09-11 against the current code and `openspec/specs/` (post-0.3.0
wave). Input: the six open gaps listed in
[sdk-platform-comparison.md](sdk-platform-comparison.md#update-2026-09-10-post-030-wave)
(gaps 1, 2, 3, 4, 5, 7 — gap 6 was closed by the role/capability work), the two
raw vendor research files
([VideoSDK](sdk-platform-comparison-videosdk.md),
[Stream](sdk-platform-comparison-getstream.md)), and the repo itself. Every
zvonok claim below cites `file:line` from the working tree. Each gap carries:
status (open / partial / closed), evidence, integrator impact, and rough size
(S ≤ a day, M ≤ a week, L beyond).

## Part 1 — The six known gaps, re-verified

### Gap 1 — Data channel / PubSub: **OPEN**

The `/sfu` namespace accepts exactly these client messages:
`sfu:join`, `sfu:leave`, `sfu:create-send-transport`,
`sfu:create-recv-transport`, `sfu:connect-transport`, `sfu:produce`,
`sfu:consume`, `sfu:resume-consumer`, `sfu:pause-producer`,
`sfu:resume-producer`, `sfu:kick-peer`, `sfu:mute-peer`, `sfu:mute-all`,
`sfu:lock-room`, `sfu:set-preferred-layers`, `sfu:close-producer`
(`apps/server/src/sfu/sfu.gateway.ts:67-211`) plus `egress:start` / `egress:stop`
on the same namespace (`apps/server/src/egress/egress-signal.gateway.ts:33,44`).
No broadcast/custom-message handler exists. The client router mirrors this: its
full registration list has no data/custom event
(`packages/client/src/sfu/event-router.ts:84-143`). The only server→room
broadcast helper is `broadcastToRoom`
(`apps/server/src/sfu/sfu.service.ts:88-91`), used solely for `egress:status`
(`apps/server/src/egress/egress.service.ts:481`).

Both vendors ship one: VideoSDK `meeting.send` (15 KiB, reliable/unreliable) and
persisted replayable PubSub topics (videosdk.md:102, :111); Stream
`sendCustomEvent` (5 KB) (getstream.md:114).

- **Impact:** blocks reactions, custom sync, and external-UI driving — the
  headless-SDK use case. VideoSDK's custom egress layouts are literally built
  on PubSub (videosdk.md:186).
- **Size: M** (signalling event + size cap + client API + React hook; decide
  persistence/replay semantics).

### Gap 2 — Active-speaker / audio-level hooks in `@zvonok/react`: **OPEN**

The primitives exist and are publicly exported from the core package:
`ActiveSpeakerDetector` (`packages/client/src/audio/active-speaker-detector.ts:14`)
and `AudioLevelSampler` (`packages/client/src/audio/audio-level-sampler.ts:20`),
reachable via the subpath exports `./audio/active-speaker-detector` and
`./audio/audio-level-sampler` (`packages/client/package.json:10-18`). But the
React entry point exports no audio hook — the complete export list is
connection, participants, host controls, capabilities, egress state/controls,
room tracker, device controls, quality controls, errors, and `ZvonokRoom`
(`packages/react/src/index.ts:7-48`). Both vendors surface speaker state
(VideoSDK `activeSpeakerId`/`isActiveSpeaker`, videosdk.md:51, :110; Stream
`dominantSpeaker` observable + `useDominantSpeaker`, getstream.md:93, :159).

- **Impact:** every integrator building a participant grid reinvents the
  wiring the core already has.
- **Size: S** (wrap existing primitives; no server work).

### Gap 3 — Pagination on list endpoints: **OPEN**

All three `/v1` lists are unpaginated newest-first full scans:

- rooms: `listRooms` → `prisma.room.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } })` — no `take`/`skip`/cursor (`apps/server/src/room/room.service.ts:36-39`);
- egress sessions: `listForRoom` → `findMany` + `orderBy startedAt desc` (`apps/server/src/egress/egress.service.ts:202-209`);
- recordings: `list` → `findMany` + `orderBy startedAt desc` (`apps/server/src/egress/recordings.service.ts:79-88`).

The controllers accept no paging query params
(`apps/server/src/platform/platform.controller.ts:41-45`,
`apps/server/src/platform/recordings.controller.ts:34-38`), and the developer
console lists are identical full scans
(`apps/server/src/developer/developer.service.ts:134-137,153-157,189-195,244-246`).
The docs pin the contract as "newest first, full room rows"
(`docs/api-reference.md:60-62`). Both vendors paginate (VideoSDK
`page`/`perPage`, videosdk.md:122; Stream cursor `next`, getstream.md:171).

- **Impact:** fine today; every list consumer breaks silently (payload growth)
  as a project accumulates rooms/recordings.
- **Size: S-M** (cursor or page params on 3 endpoints + response envelope;
  additive but a public-contract change, so an OpenSpec proposal).

### Gap 4 — Published OpenAPI for `/v1`: **PARTIAL** (served but not published)

The server *does* serve a Swagger document unconditionally:
`SwaggerModule.setup('swagger', …, { jsonDocumentUrl: 'swagger/json' })`
(`apps/server/src/bootstrap.ts:15-25`, invoked from
`apps/server/src/main.ts:18`). However:

1. **Production deliberately hides it**: the deployment guide states
   `/swagger*` → "not proxied in production (dev only, via SSH port-forward)"
   (`docs/deployment.md:347`). External integrators on a deployed server never
   see it.
2. **The document is not curated for them**: generic title "API documentation
   for the NestJS server", whole-app — it includes internal `auth`, `users`,
   `rooms`, `chat` endpoints alongside `platform` (`apps/server/src/bootstrap.ts:16-19`;
   every module carries `@ApiTags`, e.g. `apps/server/src/platform/platform.controller.ts:26`,
   `apps/server/src/room/room.controller.ts:19`).
3. **No published spec artifact**: Stream ships OpenAPI files in a public repo
   (getstream.md:167); zvonok's public reference is hand-written markdown
   (`docs/api-reference.md:1-4`) with no generated document linked.

- **Impact:** integrators can't codegen clients or validate payloads; the
  machine-readable contract exists but is gated behind SSH.
- **Size: S** (decision + curate: split or tag-filter the document, expose
  `/swagger/json` (or a static export) through the gateway, link it from the
  docs site).

### Gap 5 — Server helper package: **OPEN** (unchanged)

`packages/` contains exactly five workspaces: `@zvonok/client`
(`packages/client/package.json:2`), `@zvonok/react`
(`packages/react/package.json:2`), `@zvonok/video-layout` (private,
`packages/video-layout/package.json:2,4`), `@zvonok/whiteboard-core`
(`packages/whiteboard-core/package.json:2`), `@zvonok/whiteboard-react`
(`packages/whiteboard-react/package.json:2`). No server SDK. Both vendors ship
one (VideoSDK Node/Go/Rust incl. token mint + webhook verify, videosdk.md:20;
Stream 7 languages shared across products, getstream.md:35-37).

- **Impact:** low while the REST surface is ~10 endpoints and cURL examples
  suffice (`docs/api-reference.md`); grows with any of the additions below.
- **Size: M** (new package: typed client, room-token minting, HMAC webhook
  verification). Defer until the API grows — the highest-value piece (webhook
  verify) is ~20 lines integrators copy from docs today.

### Gap 7 — Webhook delivery log / replay: **OPEN**

Delivery is fully in-memory best-effort: per-project FIFO chains held in a
`Map<string, Promise<void>>` (`apps/server/src/webhooks/webhook-queue.ts:19`),
retried via in-process timers with backoff
`[10s, 30s, 2m, 10m, 30m]` (`apps/server/src/webhooks/webhook-queue.ts:7-9,45-54`),
and dropped with a log line after 6 attempts
(`apps/server/src/webhooks/webhook-queue.ts:55-61`). The event catalogue is 8
types (`apps/server/src/webhooks/webhook-dispatcher.service.ts:9-17`); config
and secret are re-read before each attempt
(`apps/server/src/webhooks/webhook-dispatcher.service.ts:161-169`). The Prisma
schema has no delivery model at all — the only webhook columns anywhere are
`Project.webhookUrl` / `Project.webhookSecret`
(`apps/server/prisma/schema.prisma:92-93`; full model list: `User` :17,
`CallRecord` :35, `Room` :51, `DeveloperAccount` :74, `Project` :87,
`ApiKey` :103, `Egress` :115, `Message` :149). The spec pins the behavior:
"events are not persisted for redelivery across server restarts"
(`openspec/specs/webhooks/spec.md:63-67`). Stream's analog for lossless
consumption is SQS/SNS (getstream.md:198-200); for self-hosted, a persisted
delivery log with replay-by-id is the closer fit. Note Stream also adds a
stable `X-Webhook-Id` dedupe header (getstream.md:197) — worth bundling.

- **Impact:** a restart or a 30-minute endpoint outage silently loses events;
  integrators building billing/attendance on webhooks have no recovery path.
- **Size: M** (delivery table + retention + list/replay endpoint + spec
  change; touches the retry chain's persistence boundary).

## Part 2 — Non-gaps, re-checked

- **Whiteboard external visibility.** Confirmed invisible to SDK consumers:
  the whiteboard namespace authenticates only registered-user access JWTs and
  approved-guest JWTs via `resolveRoomSocketIdentity`
  (`apps/server/src/whiteboard/whiteboard.gateway.ts:56-63`;
  `apps/server/src/auth/helpers/room-socket-auth.helper.ts:6-8,20-30`) — the
  room-token path used by platform participants does not exist there. The
  whiteboard packages (`@zvonok/whiteboard-core`, `@zvonok/whiteboard-react`)
  are app-facing panel plumbing, not part of the documented platform SDK
  (`packages/whiteboard-react/package.json:2,15-18` exports a panel component).
  VideoSDK ships `startWhiteboard` in its client SDK (videosdk.md:52, :180).
  → Reclassify as **gap candidate** (see Part 3) if whiteboard is platform
  story; it is a scope decision, not an oversight.
- **Viewer/join modes.** The `viewer` role exists and correctly strips send
  capabilities at join (`openspec/specs/platform-api/spec.md:68-73`;
  `openspec/specs/sfu/spec.md:231-233`), but it is a publish-permission role,
  not an audience mode: a viewer still joins the SFU as a full peer with
  transports and counts against `maxParticipants` 2-50
  (`openspec/specs/platform-api/spec.md:34-46`). No `RECV_ONLY` /
  `SIGNALLING_ONLY` analogue (videosdk.md:90) and no backstage (getstream.md:227).
  Consistent with the 2-50 meeting product shape — stays a non-gap.
- **Mobile RN.** No RN package exists (`packages/` listing above). Both vendors
  treat mobile as first-class (videosdk.md:15; getstream.md:20). Scope decision,
  unchanged.

## Part 3 — Newly-found gap candidates (never compared in the table)

Capabilities present in the vendor raw files but absent from the comparison
table, checked against our code:

1. **SDK reconnection / rejoin semantics — OPEN, M.** Stream documents a full
   calling-state machine (`RECONNECTING`, `RECONNECTING_FAILED`, `MIGRATING`,
   `OFFLINE`) and network-disruption handling (getstream.md:73, :238), plus a
   `tokenProvider` that auto-refreshes expiring tokens (getstream.md:56);
   VideoSDK notes token expiry mid-meeting is harmless (videosdk.md:40). Our
   SDK: socket.io auto-reconnects the transport (10 attempts,
   `packages/client/src/sfu/connection.ts:37-44`), but on reconnect nothing
   re-emits `sfu:join` — `handleConnected` only flips state
   (`packages/client/src/sfu/manager.ts:700-703`) while `handleDisconnected`
   has already torn down all transports/producers
   (`packages/client/src/sfu/manager.ts:705-719`). The public status
   vocabulary has no reconnecting state
   (`packages/react/src/types.ts:6`). The app spec promises automatic
   reconnection with resumed media (`openspec/specs/client/spec.md:53-59`), but
   an external SDK consumer of `useZvonokConnection` gets a dead room after a
   network blip. There is also no token-refresh path: the token is passed once
   at join (`packages/react/src/use-zvonok-connection.ts:182`). **Impact:**
   dropped calls on wifi blips for every integror — the most damaging
   reliability gap in the SDK layer.
2. **No REST visibility into live participants — OPEN, M.** VideoSDK exposes
   session participants via REST (videosdk.md:131); Stream via query endpoints
   (getstream.md:169). Our `/v1` inventory is create/list/end rooms, mint
   token, egress CRUD, recordings CRUD
   (`apps/server/src/platform/platform.controller.ts:33-100`;
   `apps/server/src/platform/recordings.controller.ts:34-80`) — no way to ask
   who is in a room. **Impact:** integrators must reconstruct room occupancy
   from webhook joins/leaves with no reconciliation path.
3. **No custom participant identity/metadata in tokens — OPEN, S.** VideoSDK
   tokens bind `participantId` and participants carry `metaData`
   (videosdk.md:34, :50, :53); Stream tokens carry `user_id` and calls carry
   `custom` (getstream.md:54, :72). Our mint collapses identity to a
   server-generated `randomUUID()` plus a ≤50-char display name and role
   (`apps/server/src/platform/platform.service.ts:49-56`;
   `apps/server/src/platform/dto/platform.dto.ts:35-58`). **Impact:**
   integrators cannot correlate zvonok participants with their own user ids
   except by display-name string matching.
4. **Prebuilt has no i18n — OPEN, S.** Stream's components are i18n-aware with
   translation overrides (getstream.md:149, :153). `ZvonokRoom` hardcodes
   English strings — "Join room" (`packages/react/src/prebuilt/ZvonokRoom.tsx:152`),
   "Display name" (:155), "Your name" (:159), "Camera" (:180, :513), "Join"
   (:184), "Leave" (:537). **Impact:** non-English products must hide or fork
   the prebuilt.
5. **No room update / configuration endpoints — OPEN, M (update) / S
   (auto-start).** Stream has `call.update` + settings overrides
   (getstream.md:71); VideoSDK configures rooms at create time incl. egress
   auto-start (videosdk.md:129, :166). Our `/v1` rooms accept only create
   (name, maxParticipants — `apps/server/src/platform/dto/platform.dto.ts:21-33`),
   list, end; no rename, no limit change, no auto-start egress, no room-level
   settings anywhere (`apps/server/src/platform/platform.controller.ts:33-52`).
   **Impact:** typos are permanent; recording-always rooms are impossible.
6. **No idempotent room creation — OPEN, S.** VideoSDK creation is idempotent
   on `customRoomId` (videosdk.md:141); Stream call creation has upsert
   semantics (getstream.md:70). `POST /v1/rooms` always mints a fresh
   server-side slug; the DTO accepts no client-supplied room id
   (`apps/server/src/platform/dto/platform.dto.ts:21-33`). **Impact:** a
   timed-out create retried by a sane HTTP client produces duplicate rooms.
7. **Chat unreachable for SDK participants — OPEN (scope), M.** Stream ships
   chat integration alongside video (getstream.md:41). Our `/chat` namespace
   authenticates registered users and approved guests only
   (`apps/server/src/chat/chat.gateway.ts:51-63,162-166` via
   `resolveRoomSocketIdentity`); room-token participants have no path. Same
   shape as the whiteboard: in-app features invisible to the platform SDK.
8. **No Node-runtime / headless client — OPEN (defer), L.** Stream's
   `video-client` "runs in browser and Node.js environments" (getstream.md:17);
   VideoSDK's custom egress layouts are driven by a hidden participant
   (videosdk.md:186). `@zvonok/client` is browser-bound
   (`mediasoup-client` dependency, `packages/client/package.json:113`; its
   default URL even reads Vite's `import.meta.env`,
   `packages/client/src/sfu/connection.ts:9-11`), and the egress program is a
   fixed server-side composite (`openspec/specs/egress/spec.md:37-56`) with no
   custom-layout hook. Depends on Gap 1 (PubSub) for the vendor-pattern
   solution. **Impact:** no bots, no AI participants, no custom egress layouts.
9. **E2EE — OPEN by design, L (defer).** Stream has call-level E2EEE
   (getstream.md:239). zvonok's SFU composites decoded media for egress
   (`openspec/specs/egress/spec.md:37-56`), which is architecturally
   incompatible; self-hosting also weakens the threat model. Record as
   deliberate divergence, revisit only if multi-tenant hosting arrives.
10. **Minor, note-only:** no `X-RateLimit-*` response headers (Stream has them,
    getstream.md:172; ours is 429 + `Retry-After` only,
    `openspec/specs/platform-api/spec.md:23-28`); no per-participant consent
    events for remote mute (VideoSDK `mic-requested`/`webcam-requested`,
    videosdk.md:71 — ours is server-authoritative pause + notify by spec,
    `openspec/specs/sfu/spec.md:110-113`); no server-side session quality-stats
    endpoint (videosdk.md:130). None block integrators today.

**Verified non-gaps among candidates:** device hot-swap mid-call *is* exposed —
`useDeviceControls` returns `switchDevice(deviceId)` for camera and mic
(`packages/react/src/use-device-controls.ts:16,69-75`); the prebuilt has a
skippable pre-join device stage (`openspec/specs/sdk/spec.md:76-79`), matching
VideoSDK's Precall (videosdk.md:100).

## Part 4 — Prioritized shortlist for 0.4.0

Ordered by integrator value ÷ cost, constrained to what composes:

1. **Gap 2 — active-speaker/audio hooks in `@zvonok/react` (S).** Pure lift of
   already-exported core primitives; table stakes; zero server work.
2. **Gap 1 — data channel/PubSub (M).** The biggest unforced functional gap
   against both vendors; unlocks reactions/sync and is the prerequisite for the
   headless/custom-layout story (candidate 8).
3. **Candidate 1 — reconnect/rejoin + token refresh in the SDK (M).** The
   biggest unforced *reliability* gap; every integrator hits it on the first
   wifi blip. Ship together with a `reconnecting` status in the public
   vocabulary.
4. **Gap 3 — pagination (S-M).** Cheap now, contract-breaking later; do it
   before the API accumulates more consumers.
5. **Gap 4 — finish OpenAPI publication (S).** Curate the document to the
   platform surface, expose `swagger/json` through the gateway, link from the
   docs site.
6. **Candidate 3 — custom participant id/metadata in minted tokens (S).**
   Highest integrator value per line of code; small DTO + claims change.
7. **Gap 7 — webhook delivery log + replay-by-id (M).** Pairs naturally with
   an `X-Zvonok-Id` dedupe header; needed before event-driven integrators
   depend on webhooks for billing.
8. **Candidate 6 — idempotent create / client room id (S).** One DTO field +
   unique constraint.

Defer with recorded rationale: Gap 5 (server package — revisit when the API
grows; the webhook-verify snippet is the only pain today), candidates 5/7/8/9
(room config, chat-for-SDK, Node client, E2EE — all scope decisions needing
their own proposals), mobile RN (unchanged scope decision).
