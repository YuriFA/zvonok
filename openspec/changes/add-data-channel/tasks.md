# Tasks: add-data-channel

## 1. Server

- [ ] 1.1 `capabilities.ts`: add `send-data-message` to the `CapabilityId` union and the `host`/`participant` bundles (not `viewer`); spec tests
- [ ] 1.2 `sfu.interface.ts`: `SfuBroadcastMessage` (senderId, topic, payload, timestamp) and broadcast ack/error codes; gateway `sfu:broadcast` handler - capability check, topic validation, 8192-byte serialized cap, ack, relay to room minus sender; unit tests for all four denial paths + relay shape
- [ ] 1.3 e2e: two joined sockets exchange broadcasts (topic/payload/senderId intact, sender gets no echo); viewer-role denial; oversized payload denial

## 2. SDK

- [ ] 2.1 `packages/client`: types, event-router `sfu:broadcast` registration, manager `sendBroadcast(topic, payload)` ack-settled with typed `SfuBroadcastError` (local DISCONNECTED/timeout codes), `onBroadcast` callback + state entry; tests
- [ ] 2.2 `packages/react`: send hook + topic-filtered receive hook, `ZvonokBroadcastError`, doubles (`simulateBroadcast`, `sendBroadcast` mock), hook tests (send settles, denial typed, topic filter, no self-echo)

## 3. Docs and verification

- [ ] 3.1 Quickstart: data-channel section (send + filtered receive example, limits, capability note)
- [ ] 3.2 Verify: server tsc + unit + e2e green; packages/client and packages/react tsc + suites green; apps/client green
