## Why

The server runs exactly one mediasoup Worker (`apps/server/src/sfu/worker-manager.ts`), which caps media capacity at one CPU core regardless of machine size. mediasoup's own scalability guidance is one Worker per core with routers distributed across them (~500 consumers per worker/core). Research into comparable server stacks (docs/research/server-stack-language-and-codebase-improvements.md) confirms the media path is already native C++; using all cores is the largest server-side performance lever available short of multi-host distribution.

Related gap: when the Worker process dies, the current handler discards every room's router and restarts blind after 2 s - clients keep dead media with no signal, while the sfu spec already promises "a new Worker is started and rooms recover their routers". The implementation violates that scenario today; this change fulfils it instead of weakening it.

## What Changes

- Server: `WorkerManager` runs a pool of mediasoup Workers (default one per CPU core minus one, minimum 1; `MEDIASOUP_WORKERS` override) and assigns each room's Router to the least-loaded Worker. One Router per room, on exactly one Worker, unchanged.
- Server: Worker death now replaces the Worker, recreates the Routers of the rooms it hosted, clears those rooms' server-side media state (transports are dead; screen-share locks included), and emits a new `sfu:room-media-reset` event carrying the room's router RTP capabilities to every affected participant.
- SDK (`@zvonok/client`): handles `sfu:room-media-reset` by retaining live local tracks, tearing down local media objects, reloading the device, and replaying produces/consumes through the rebuilt transports - without a new join and without touching presence, chat, or room lifetime.
- No REST change; one additive WebSocket event.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sfu`: replaces the "Single worker with router per room" requirement with "Worker pool with router per room"; the worker-crash scenario now includes Router recovery and participant notification via `sfu:room-media-reset`.
- `sdk`: new requirement - the SDK rebuilds its media session when `sfu:room-media-reset` arrives.

## Impact

- `apps/server/src/sfu/worker-manager.ts` (pool, least-loaded placement, crash recovery)
- `apps/server/src/sfu/sfu.service.ts` (reset handling, per-room media clearing)
- `apps/server/src/sfu/interfaces/sfu.interface.ts`, `packages/client/src/sfu/` (event contract, manager rebuild flow)
- Tests: server sfu suites (with real mediasoup workers), packages/client suites
- Spec deltas: `openspec/specs/sfu/spec.md`, `openspec/specs/sdk/spec.md`
