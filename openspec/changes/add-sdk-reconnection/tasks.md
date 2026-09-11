# Tasks: add-sdk-reconnection

## 1. Server: grace period and kick terminality

- [ ] 1.1 `sfu.service.ts` disconnect flow: hold peer seat + identity for the grace window (default 30s, constant), run the normal leave flow on expiry; `sfu:join` within grace with the same participant id restores the seat without room events or join/left webhooks; unit tests for restore, expiry, and webhook silence
- [ ] 1.2 Kick terminality: kicked peers are marked unrestorable for the room; their rejoin is refused with the kick denial; unit test
- [ ] 1.3 Explicit `sfu:leave` stays immediate (no grace); regression test
- [ ] 1.4 e2e: server-side socket disconnect + rejoin within grace (media restored via re-produce, no duplicate webhooks); grace expiry emits `participant.left` reason disconnect; kicked peer's rejoin refused

## 2. SDK: reconnect state machine and tokenProvider

- [ ] 2.1 `packages/client` manager: `reconnecting` status on post-join disconnect, retain local tracks + produce intents, on reconnect replay join pipeline (join, transports, produce, resubscribe), return to `joined`; socket.io `reconnect_failed` -> `failed` typed; kicked denial -> kicked state, stop; unit tests driving the socket mock through disconnect/reconnect
- [ ] 2.2 `tokenProvider` option: manager join options + call-once retry on expired-token denial, persist refreshed token; typed expired-token error without provider; unit tests
- [ ] 2.3 `packages/react`: `ZvonokStatus` gains `reconnecting`, `useZvonokConnection` accepts and passes `tokenProvider`, prebuilt shows the reconnecting notice; doubles + hook tests (blip recovery, provider refresh, kick terminal)
- [ ] 2.4 `apps/client`: exhaustive status switches updated for `reconnecting`; tests green

## 3. Docs and verification

- [ ] 3.1 Quickstart reliability section: reconnecting status, tokenProvider example, kick terminality note
- [ ] 3.2 Verify: server tsc + unit + e2e green; packages/client, packages/react, apps/client tsc + suites + lint green
