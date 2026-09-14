## 1. Worker pool (server)

- [x] 1.1 `WorkerManager`: create a pool (default `max(1, availableParallelism() - 1)`, `MEDIASOUP_WORKERS` override), assign each room's Router to the least-loaded Worker, keep one Router per room
- [x] 1.2 `WorkerManager`: on Worker `died` - drop only that Worker, recreate a replacement, recreate the Routers it hosted, and notify subscribers with the affected room ids; close the whole pool on module destroy
- [x] 1.3 `SfuService`: on routers-lost - clear the affected rooms' media state (transports, producers map entries, screen-share locks) without touching presence, then emit `sfu:room-media-reset` with the rebuilt Router capabilities
- [x] 1.4 Unit tests with real mediasoup workers: Router placement spreads across the pool; SIGKILL of one Worker's process triggers replacement, Router recreation, and the reset payload

## 2. SDK media reset (@zvonok/client)

- [x] 2.1 `types.ts` + `event-router.ts`: `SfuRoomMediaResetPayload`, handler slot, event registration
- [x] 2.2 `manager.ts`: `handleRoomMediaReset` - retain live produces, `closeAll`, reload device (transports re-created; existing producers re-announced on recv transport), replay retained produces; no-op before session establishment
- [x] 2.3 Unit tests: event routed to manager; rebuild performs no `joinRoom` emission; retained track re-published after rebuild; pre-join reset ignored

## 3. Verification

- [x] 3.1 Server suite green (`pnpm -C apps/server test`), server build green
- [x] 3.2 `packages/client` suite green, `lint:ts` green
- [ ] 3.3 Archive the change (`/opsx-archive`) once tasks complete
