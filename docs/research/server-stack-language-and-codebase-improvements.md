# Server stack decision: Node/mediasoup vs Go/Rust, and codebase improvement audit

Researched 2026-09-14 against primary sources (mediasoup/LiveKit/Stream official
docs and benchmarks, vendor GitHub orgs) plus a file:line audit of
`apps/server/src`. Question: should the server move to Go/Rust for
performance, and what should improve in place? Prior related notes:
[sdk-platform-comparison.md](sdk-platform-comparison.md) (SDK/API surface),
[stream-video-js-codebase-patterns.md](stream-video-js-codebase-patterns.md)
(client-side patterns).

## Part A - How comparable stacks are actually built

**VideoSDK (videosdk.live).** Their public GitHub org (92 repos) contains
client SDKs and examples only - no SFU/media-server code
(https://github.com/orgs/videosdk-live/repositories?type=all). Their
"server-side SDK" is a token/auth server example, not a media server:
`videosdk-rtc-nodejs-sdk-example` README - "This code sample represents
example of authentication server for video sdk"
(https://github.com/videosdk-live/videosdk-rtc-nodejs-sdk-example); official
Node server example is an Express REST integration
(https://docs.videosdk.live/api-reference/realtime-communication/server-side-examples-nodejs).
What their hosted SFU runs is not disclosed. SILENT on SFU language.

**Stream (getstream.io).** Official docs state the video backend is Go:
"Like our chat and feeds infrastructure, our video backend is written in Go.
Go's excellent concurrency primitives and low memory footprint make it ideal
for handling thousands of simultaneous WebRTC connections per server"
(https://getstream.io/video/docs/react/architecture-and-benchmark/). Their
published benchmark: 100k participants across 132 cascading SFUs, 225 Gbps
peak, 0% packet loss, 4 ms jitter, 600 joins/s - vendor-reported, instance
types not published. The load-bearing detail is where their optimizations
live: batched `sendmmsg`/`recvmmsg`, GSO/GRO, zero-allocation hot paths,
per-core parallelization, direct syscalls (`syscall.Syscall6`) -
"approximately 1 syscall every 8 RTP packets" (same page). That is kernel
networking in the RTP loop, reachable only by owning the data plane. Their
SFU is closed source; GitHub has client SDKs plus a Rust protocol/REST SDK
(`stream-video-rust` combines the REST API with an SFU WebRTC *participant*
client, https://github.com/GetStream/stream-video-rust).

**LiveKit.** Go + Pion: "LiveKit is written in Go, leveraging Pion's Go-based
WebRTC implementation. The SFU is horizontally-scalable... Nodes use
peer-to-peer routing via Redis"
(https://docs.livekit.io/reference/internals/livekit-sfu/); multi-region mesh
(https://livekit.com/blog/scaling-webrtc-with-distributed-mesh). Published
self-hosting benchmark on a 16-core c2-standard-16
(https://docs.livekit.io/transport/self-hosting/benchmark/): 10 pubs/3000
subs audio room at ~959k packets/s out @ 80% CPU; 150/150 meeting at
51k in/763k out pps @ 85%; 1 pub/3000 subs livestream @ 92%. Multi-core
handling via subscriber load-balancing
(https://livekit.com/blog/going-beyond-a-single-core). Egress/recording is a
separate Go service driving headless Chrome/GStreamer
(https://github.com/livekit/egress). Load tooling: `lk load-test`
(https://github.com/livekit/livekit-cli).

**mediasoup (what zvonok uses).** The data plane is a C++ worker subprocess
pinned to one CPU core per worker: "A Worker represents a mediasoup C++
subprocess that runs in a single CPU core"; "a mediasoup C++ subprocess can
typically handle over ~500 consumers in total"; it does no
decode/transcode (https://mediasoup.org/documentation/v3/scalability/).
Scaling guidance is to launch N workers (up to core count) and distribute
routers; multi-host distribution is application-level via `pipeToRouter()`.
A Rust control-plane binding exists - `mediasoup` crate, same C++ worker
("A worker represents a mediasoup C++ thread that runs on a single CPU core",
https://docs.rs/mediasoup) - so "switching to Rust" here only swaps the
orchestration API, not the media engine. Recording pattern per official docs:
PlainTransport/DirectTransport handing RTP to an external FFmpeg/GStreamer
(https://mediasoup.org/documentation/v3/communication-between-client-and-server/) -
RTP flows over a UDP socket from the C++ worker straight to ffmpeg; Node only
orchestrates.

**Others.** ion-sfu (Pion, Go) is unmaintained/archived
(https://github.com/ionorg/ion-sfu); LiveKit is its production successor.
Jitsi Videobridge is Java/Kotlin scaling by bridge cascading (Octo)
(https://webrtchacks.com/sfu-cascading/). Galene is a Go single-binary SFU
(https://galene.org; no first-party benchmark published). Pure-TS (werift,
https://github.com/shinyoshiaki/werift) and pure-Rust (str0m, webrtc-rs)
WebRTC stacks publish no mediasoup/LiveKit-class load numbers. Cloudflare
Calls does not state its SFU language
(https://blog.cloudflare.com/announcing-cloudflare-calls/).

## Part B - Decision: do not rewrite in Go/Rust

**The media path is already native.** In a mediasoup deployment, RTP
forwarding, SRTP, NACK, simulcast layer selection run in the C++ worker
(Part A, mediasoup). Node is a control plane passing small JSON messages
(create transport / connect / pause). A Go/Rust rewrite cannot speed up the
RTP path; it can only replace the SFU engine itself (e.g. Pion), discarding
zvonok's mediasoup-specific work (taps, egress, capability model). No
primary source found documents Node.js as a measured bottleneck for a
mediasoup data plane.

**Stream's Go numbers do not transfer.** Their wins come from owning the RTP
loop at syscall level (1 syscall per 8 packets, GSO/GRO) at 100k-participant
cascade scale. zvonok's product shape is 2-50 participant self-hosted rooms;
that regime is orders of magnitude below where kernel-bypass matters.

**Capacity math (mediasoup's own rule-of-thumb).** ~500 consumers per
worker/core (scalability doc above). A 4-person all-to-all room is ~24
consumers (each peer consumes 3 producers x audio+video) -> ~20 such rooms
per core. One 16-core box with one worker per core is thousands of
consumers - the same envelope as LiveKit's published numbers.

**The actual bottleneck today is that zvonok runs ONE worker** (Part C #1) -
one core of media capacity on any machine. Fixing that is a config-level
change worth more than any language.

**What would justify revisiting:**
1. Sustained socket.io fan-out saturation or event-loop lag from mediasoup
   events at high room counts - measure first (`perf_hooks.monitorEventLoopDelay`).
2. Need for cascading/multi-DC edge distribution - at that point adopt
   LiveKit (Go SFU + egress + mesh, batteries included) rather than writing
   a bespoke Go SFU.
3. Team wanting Rust regardless - `mediasoup-rust` swaps only the control
   API; zero media-path gain, pure churn otherwise.

**What stays in Node in every studied stack:** REST, DB access, auth,
webhooks, billing - LiveKit and Stream both keep application/coordination
services separate from the SFU. The business layer (NestJS + Prisma) is not
the performance-relevant layer, and Go/Rust buys nothing there that justifies
a rewrite.

**Verdict:** stay on Node + mediasoup. Spend the effort on Part C; adopt
LiveKit wholesale if edge/cascade scale ever becomes a requirement.

## Part C - Codebase audit and improvement plan (apps/server/src)

Stack confirmed: NestJS 11, mediasoup ^3.19.17, socket.io ^4.8.3, Prisma
^7.3.0 (@prisma/adapter-pg), Node 22 types. One Node process runs REST, both
Socket.io namespaces (`/sfu`, `/chat`), in-memory presence, and media
orchestration. Single container deploy (docker-compose.prod.yml, apps/server/Dockerfile);
no cluster/PM2/Redis anywhere.

### P0 - highest impact, low risk

1. **One mediasoup worker = one core of media capacity.** `WorkerManager`
   holds exactly one worker (`private worker: MediasoupWorker | null`,
   worker-manager.ts:13) created at module init (:17-19). mediasoup's own
   scaling guidance: launch `numCpus-1` workers and distribute routers
   (Part A). Change `WorkerManager` to spawn N workers and assign routers
   round-robin/least-loaded at createRouter (:61-79). This multiplies media
   capacity by core count without touching any contract.

2. **Worker death silently kills all rooms.** `handleWorkerDeath` clears the
   routers map and restarts blind after a fixed 2 s (worker-manager.ts:40-58);
   routers are not recreated and clients are not notified, so media dies
   while presence keeps seats. Also logs via `console.error` (:32) instead of
   Nest Logger. Fix: on `died`, tear rooms down coherently via presence
   (notify `sfu:room-ended`/`sfu:room-media-reset`, force re-publish) - or
   snapshot router room-ids and recreate them on the new worker.

3. **Chat user path has no room authorization.** Guest sends check
   `room.id !== payload.roomId` (chat.gateway.ts:78-86), but the user-type
   path persists `payload.roomId` straight to `chatService.sendMessage`
   (chat.gateway.ts:115-121) with no check that the identity belongs to that
   room - any connected user can write chat into any room id. Verify
   membership/room binding of the JWT identity before persisting.

4. **Egress orphans ffmpeg on shutdown.** `EgressService` has only
   `onModuleInit` (egress.service.ts:118-153); a SIGTERM (deploy restart)
   leaves running ffmpeg children writing HLS/recordings. Add
   `OnModuleDestroy` finalizing all sessions (`stopped`), mirroring the
   existing boot-time reconciliation (:139-153).

### P1 - hot-path efficiency

5. **O(total rooms) scans per event.** `roomIdOf` iterates every room's peer
   set (room-presence.service.ts:560-565) and runs inside `contextOf` on
   every gateway event; `findRoomSlug` iterates the whole slug map
   (:567-572). Keep a direct `Map<socketId, roomId>` and store the slug on
   the room record.

6. **2 sequential Prisma reads per webhook event.** `WebhookDispatcher.enqueue`
   reads room then project (webhook-dispatcher.service.ts:117-132); a join
   burst costs 2N queries. Collapse to one
   `room.findUnique({ include: { project } })`; config is re-read at delivery
   time anyway (:135-139), so a short-TTL cache of webhook config is safe.

7. **Webhook FIFO blocks a project's whole queue on retries.** Per-project
   chained deliveries (webhook-queue.ts:22-38) with up to 30 min backoff
   (delays at :10-12): one dead endpoint delays every later event for that
   project by up to ~50 min cumulative; restart drops queued deliveries.
   Make retries per-event (no head-of-line blocking) and consider persisting
   deliveries - aligns with platform gap 7 (webhook delivery log/replay) in
   sdk-platform-comparison.md.

8. **Chat hot path:** per-message `client.join(payload.roomId)` used as a
   lazy-join hack (chat.gateway.ts:103, :120) plus duplicate room lookup on
   the guest path (:79 and chat.service.ts re-fetch); `getMessages` runs
   `message.count` per page with offset pagination (chat.service.ts:70-83).
   Join the socket.io room once at connect from verified identity; adopt the
   existing cursor-pagination helper (platform/pagination.helper.ts, already
   used by rooms and egress) and drop the count.

9. **Serial awaits where parallel is safe.** `muteAll` pauses peers
   sequentially (sfu.service.ts:512-520); `endRoom` departs sockets one by
   one (room-presence.service.ts:361-363). Use `Promise.all` /
   `Promise.allSettled`.

10. **Per-event `Logger.log` on every SFU message** (sfu.gateway.ts, each
    handler incl. produce/consume/resume). Demote to verbose/sample; at
    hundreds of events/sec this is pure overhead.

11. **100 RTC UDP ports cap total concurrent transports**
    (rtcMinPort/rtcMaxPort 40000-40099, config/mediasoup.config.ts:101-102).
    Widen (e.g. 40000-40499+) and document capacity math; note one
    WebRtcTransport uses 1 port (RTCP-mux), each egress tap 1 more.

12. **Fan-out loop instead of socket.io rooms.** `broadcastToRoom` emits
    per-socket in a loop (room-presence.service.ts:487-493) while chat
    already uses `server.to(room).emit` (chat.gateway.ts:104, :121). Put SFU
    peers into real socket.io rooms on join and delegate fan-out to the
    adapter - faster and the prerequisite for any multi-instance future (#14).

### P2 - structural

13. **`sfu.service.ts` is 937 lines doing four jobs** (media lifecycle, host
    controls, broadcast, tap ports). The seams exist (`RoomPresence`,
    `RoomMediaSource` ports); extract broadcast + host-control services when
    next touching those areas.

14. **Single-instance state model is the real scaling boundary**: presence in
    plain Maps (room-presence.service.ts:57-70), routers on one worker,
    egress sessions in a Map (egress.service.ts:126), webhook chains in
    memory, no socket.io redis-adapter. A second instance behind an LB would
    silently fragment rooms. Not urgent for single-node self-hosting, but
    document it and pick the upgrade path early (LB room pinning, or
    redis-adapter + Redis presence) - still Node, no rewrite.

15. **Small cleanups:** dead `Peer`/`Room` interfaces nothing uses
    (interfaces/sfu.interface.ts:17-47); stray `void 0;`
    (egress.service.ts:238); fail fast in production when
    `MEDIASOUP_ANNOUNCED_IP` is unset while `MEDIASOUP_LISTEN_IP` is
    loopback (config/mediasoup.config.ts:108-109).

### Already well-designed (keep)

- Port seams `ROOM_PRESENCE` / `RoomMediaSource` keeping identity out of the
  media layer; spec files exist for both sides.
- Disconnect grace seats with silent rejoin restore, terminal kicks,
  room-scoped state (room-presence.service.ts:51-55, 143-153, 229-266).
- Capability authorization resolved server-side from verified tokens only,
  typed ack denials.
- Egress pipeline is the strongest subsystem: PlainTransport UDP taps to
  ffmpeg with `-progress` liveness, debounced membership restarts, bounded
  retries, MPEG-TS parts + lossless concat, SSRF-guarded RTMP targets,
  boot-time orphan reconciliation.
- FFmpeg child-process hygiene (SIGINT->SIGKILL, idempotent stop, bounded
  stderr tail).
- Broadcast validation (topic regex, 8 KiB cap, server-set timestamp).
- TURN REST auth-secret per draft-uberti-rtcweb-turn-rest.

## Bottom line

- **Language:** no Go/Rust rewrite. The media path is already C++; Node is
  control plane; Stream/LiveKit-scale wins need SFU-ownership scale zvonok
  does not operate at. Revisit trigger: cascade/edge distribution -> adopt
  LiveKit, not a bespoke rewrite.
- **Performance:** the win is in using mediasoup fully (multi-worker #1) and
  removing control-plane waste (#5-#12), not in a new language.
- **Security first:** chat authorization gap (#3) and shutdown orphaning (#4)
  matter more than any perf item.
