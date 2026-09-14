# Production Monitoring Research: observability stack for the zvonok VPS

> **Date:** 2026-09-14
> **Question:** what monitoring/admin tooling fits a small VPS where two sites share one
> Traefik gateway and this stack runs postgres 16, NestJS + mediasoup SFU in one container,
> caddy, coturn, and a docs site - covering client traffic, host load, per-site traffic,
> active rooms, room management, logs, errors, uptime, and disk.
> **Method:** primary sources only - official docs and tool READMEs, linked per claim;
> repo facts verified in `apps/server/src`, `docker-compose.prod.yml`, `docs/deployment.md`.
> No `/metrics` endpoint or error tracking exists in the server today.

## Prometheus + Grafana (the standard stack)

- Prometheus: open-source monitoring/alerting toolkit; collects time series via a pull
  model over HTTP, each server standalone with no distributed-storage dependency; Grafana
  is the standard visualization layer.
  Source: [Prometheus overview](https://prometheus.io/docs/introduction/overview/).
- [node_exporter](https://github.com/prometheus/node_exporter): exporter for hardware and
  OS metrics (CPU, memory, disk, network), port 9100; in Docker it needs host namespaces
  (`network_mode: host`, `pid: host`, `--path.rootfs=/host`) to see the host, not itself.
  Source: [README](https://github.com/prometheus/node_exporter).
- [postgres_exporter](https://github.com/prometheus-community/postgres_exporter): PostgreSQL
  metrics exporter (connections, activity, locks, WAL), port 9187; CI-tested against PG
  13-18, so our `postgres:16-alpine` is covered.
  Source: [README](https://github.com/prometheus-community/postgres_exporter).
- [cAdvisor](https://github.com/google/cadvisor): running daemon that collects per-container
  resource usage, historical usage histograms, and network statistics; official Docker
  quick-start exposes a web UI on port 8080 and mounts host paths read-only.
  Source: [README](https://github.com/google/cadvisor).
- [prom-client](https://github.com/siimon/prom-client): the Prometheus client for Node.js
  (counters, gauges, histograms, summaries); `collectDefaultMetrics()` adds event loop lag,
  GC, heap, and process metrics; package renamed to `@prometheus-io/client`, previously
  `prom-client`. Source: [README](https://github.com/siimon/prom-client).
- [@willsoto/nestjs-prometheus](https://github.com/willsoto/nestjs-prometheus): NestJS module
  that registers a `/metrics` endpoint returning default metrics; custom gauges come from
  `makeGaugeProvider` with an optional `inject` array so a `collect` callback can read app
  state (e.g. presence or SFU counters) on every scrape.
  Source: [README](https://github.com/willsoto/nestjs-prometheus).
- Sizing: Grafana needs minimum 512 MB RAM / 1 core, and its "small" tier (< 25 users) starts
  at 2 cores / 2-4 GB RAM with SQLite acceptable only for small instances.
  Source: [Grafana installation](https://grafana.com/docs/grafana/latest/setup-grafana/installation/).
  Prometheus publishes no official RAM/CPU sizing; its docs give a disk formula
  (`retention_time * samples_per_second * 1-2 bytes/sample`) and a default 15-day retention.
  Source: [Prometheus storage](https://prometheus.io/docs/prometheus/latest/storage/).
- Dashboards and data sources are provisioned as YAML files under `provisioning/`, version
  controllable in the repo instead of clicked by hand.
  Source: [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/).

## Traefik observability (per-site traffic attribution)

- Enabling `--metrics.prometheus=true` exposes Prometheus metrics on the `traefik` entrypoint;
  per-router/request metrics require `addRoutersLabels` (default `false`), and Traefik ships
  an official Grafana dashboard (ID 17346). This is the only place where traffic is split by
  Host header, i.e. the way to attribute zvonok vs the other site on this VPS - host-level
  metrics mix both.
  Source: [Traefik metrics](https://doc.traefik.io/traefik/reference/install-configuration/observability/metrics/).
- The built-in dashboard/API (`api: {}` plus a router to `api@internal`) lists all routers
  (`/api/http/routers`) across every site the gateway routes; Traefik warns that exposing it
  in production requires authentication.
  Source: [Traefik API & Dashboard](https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/).
- The gateway is a separate setup at `~/gateway` on the VPS, not part of this repo, so metrics
  and (optionally) the dashboard are enabled there; this repo only consumes the resulting
  scrape target.
  Source: [docs/deployment.md](../deployment.md) ("Traefik Gateway (Multi-Site Production)").

## mediasoup app metrics (clients, active rooms)

- mediasoup is not a standalone server but an unopinionated Node.js module plus C/C++ worker
  subprocesses - so its stats live inside the NestJS process and must be published by the app
  itself; nothing external can scrape the worker directly.
  Source: [mediasoup design](https://mediasoup.org/documentation/v3/mediasoup/design/).
- Available stats APIs: `worker.getResourceUsage()`, `transport.getStats()` (ICE/DTLS/BWE
  counters), `producer.getStats()` / `consumer.getStats()` (score, bitrate), plus observer
  events (`newtransport`, `newrouter`) and `mediasoup.getSupportedRtpCapabilities()`.
  Source: [mediasoup API](https://mediasoup.org/documentation/v3/mediasoup/api/).
- Active rooms = live Routers in this app: `SfuService` creates one router per room
  (`workerManager.createRouter(outcome.roomId)` in
  `apps/server/src/sfu/sfu.service.ts`, with `closeRouter` and `onRoutersLost`), and
  `RoomPresenceService` (`apps/server/src/sfu/room-presence.service.ts`) tracks each joined
  socket as a `PresenceRecord` with a `HeldSeat` reconnect grace - both are already in-process
  gauges waiting to be exposed.
- A Prometheus exporter would normally bridge this; the only GitHub hit is
  [kokutele/mediasoup-exporter](https://github.com/kokutele/mediasoup-exporter) - 7 stars,
  last push June 2021 (verified via GitHub API) - not maintained. Conclusion: publish the
  metrics from the app via prom-client gauges; no third-party exporter.

## Room admin today (apps/server/src/room)

- Deletion already exists: `RoomController` (`apps/server/src/room/room.controller.ts`)
  exposes `DELETE /rooms/:id` ("End room (owner only)") calling
  `RoomService.softDeleteRoom(id)` plus `presence.endRoom(id)` (`apps/server/src/room/room.service.ts`).
- Roles exist and are enforced globally: `RolesGuard` is registered as `APP_GUARD` in
  `apps/server/src/auth/auth.module.ts`, `@Roles(Role.HOST, Role.ADMIN)` is already used in
  `RoomController.createRoom`, and `Role.ADMIN` comes from the Prisma enum.
- Cleanup already exists: `RoomCleanupService` (`apps/server/src/room/cleanup.service.ts`)
  runs an hourly interval that `deleteMany`es rooms with `status: 'ended'` older than 1 hour.
- What is missing: a global "list all rooms" view - `RoomService.listProjectRooms` is
  project-scoped. Smallest path: one admin-guarded endpoint (`@Roles(Role.ADMIN)`) listing
  active rooms and reusing `softDeleteRoom`, plus one small admin page. Admin frameworks
  ([react-admin](https://marmelab.com/react-admin/) - a React B2B admin framework;
  [Refine](https://refine.dev/) - React internal-tool platform) bring data/auth provider
  concepts and their own stack - more weight than one endpoint + one page. Since the user is
  unsure deletion is needed, treat admin delete as optional; metrics come first.

## Lighter alternatives

- [Netdata](https://github.com/netdata/netdata): real-time per-second monitoring with
  zero-configuration auto-discovery; monitors containers (Docker/containerd), processes, and
  packaged apps including postgres; UI on port 19999; free with an optional cloud tier. The
  README cites a University of Amsterdam study ranking it most energy-efficient for
  Docker-based monitoring (CPU, RAM, execution time).
  Source: [README](https://github.com/netdata/netdata),
  [docs](https://learn.netdata.cloud/docs/data-collection/).
- [Beszel](https://github.com/henrygd/beszel): lightweight monitoring with two components -
  a PocketBase-based hub (web dashboard) and a per-host agent; tracks CPU, memory, network
  per Docker/Podman container, disk, load, alerts; MIT, positioned as "smaller and less
  resource-intensive than leading solutions" (vendor claim).
  Source: [README](https://github.com/henrygd/beszel).
- [Zabbix](https://www.zabbix.com/documentation/7.4/en/manual/installation/requirements):
  its own sizing table starts a "small" install (1 000 metrics) at 2 cores / 8 GiB RAM with
  a MySQL/PostgreSQL backend and a PHP frontend - far beyond a 2-4 GB VPS that also runs a
  media server. Source: [Requirements](https://www.zabbix.com/documentation/7.4/en/manual/installation/requirements).
- [VictoriaMetrics](https://github.com/VictoriaMetrics/VictoriaMetrics): single-node
  Prometheus-compatible TSDB, drop-in Prometheus replacement in Grafana, PromQL/MetricsQL;
  vendor benchmarks claim up to 7x less RAM than Prometheus (vendor claim). `vmagent`
  scrapes and remote-writes if Prometheus itself is dropped.
  Source: [README](https://github.com/VictoriaMetrics/VictoriaMetrics).
- [Uptime Kuma](https://github.com/louislam/uptime-kuma): self-hosted uptime tool - HTTP(s),
  TCP, keyword, WebSocket, DNS, and Docker container monitors, 90+ notification integrations,
  status pages; one-container install on port 3001.
  Source: [README](https://github.com/louislam/uptime-kuma).
- Netdata and Beszel cover host + containers but not per-site HTTP attribution (still needs
  Traefik metrics) nor SFU internals; Netdata can also scrape the app's Prometheus endpoint.
  Source: [Netdata README](https://github.com/netdata/netdata).

## Logs and errors

- Disk safety is already handled: `docker-compose.prod.yml` caps `json-file` logs per service
  (`max-size`/`max-file`), which is Docker's default driver with rotation options.
  Source: [json-file driver](https://docs.docker.com/engine/logging/drivers/json-file/),
  repo `docker-compose.prod.yml`.
- Central logging: Grafana's Docker driver plugin ships container logs to Loki, but its docs
  warn about a deadlocked-Docker-daemon failure mode and recommend the Alloy
  `loki.source.docker` component instead. Promtail is end of life since March 2, 2026 -
  Alloy is the successor.
  Source: [Docker driver](https://grafana.com/docs/loki/latest/send-data/docker-driver/),
  [Alloy](https://grafana.com/docs/alloy/latest/),
  [Promtail EOL](https://grafana.com/docs/loki/latest/send-data/promtail/).
- Error tracking: self-hosted Sentry is "feature-complete and packaged up for low-volume
  deployments and proofs-of-concept" and bundles heavy components (ClickHouse storage, Snuba
  bootstrap, Relay, memcached in its compose) - too much next to the app's own Postgres on a
  small VPS. Source: [getsentry/self-hosted](https://github.com/getsentry/self-hosted).
- GlitchTip is the Sentry-compatible lightweight option: PostgreSQL 14+ plus one service
  (Valkey optional), minimum 256 MB RAM all-in-one, 512 MB recommended.
  Source: [GlitchTip install docs](https://glitchtip.com/documentation/install).
- NestJS integration point: the official Sentry guide for NestJS (SDK `@sentry/nestjs`)
  instruments the framework and captures errors.
  Source: [Sentry NestJS guide](https://docs.sentry.io/platforms/javascript/guides/nestjs/).

## Offloading to hosted services

- Grafana Cloud has an always-free tier: 10k active metrics series/month, 50 GB logs/month,
  14-day retention - enough for one server's metrics and logs, with dashboards off-VPS.
  Source: [Grafana Cloud pricing](https://grafana.com/pricing/).
- On a 2-4 GB VPS (repo guidance: 2 GB minimum, 4 GB recommended -
  [docs/deployment.md](../deployment.md)) that must also run a mediasoup SFU, hosted
  dashboards remove the Prometheus + Grafana + Loki containers entirely; the local footprint
  then shrinks to scrapers/agents. Single-agent alternatives (Netdata, Beszel) shrink it even
  further.

## Recommendation for this VPS

Boring default (the standard stack, one new compose file):

1. App metrics: add `@willsoto/nestjs-prometheus` to the server, exposing `/metrics` with
   default Node metrics plus gauges for active rooms (live routers in
   `apps/server/src/sfu/sfu.service.ts`) and connected peers (`RoomPresenceService` records) -
   no maintained mediasoup exporter exists, so the app publishes its own.
2. Exporters: `node_exporter` (host CPU/RAM/disk/network), `cAdvisor` (per-container), and
   `postgres_exporter` (DB), all scraped by a Prometheus with a short retention.
3. Visualization: Grafana with provisioned dashboards (node + containers + Traefik official
   dashboard 17346).
4. Gateway: enable `--metrics.prometheus=true` with `addRoutersLabels` in `~/gateway` -
   the only source of per-site traffic; keep the Traefik dashboard behind auth or skip it.
5. Logs: keep `json-file` rotation (already present); add Loki + Grafana Alloy with
   `loki.source.docker` only when grep-through-`docker logs` stops being enough.
6. Uptime: Uptime Kuma checking the site, docs host, and TURN ports, with Telegram alerts.
7. Errors: GlitchTip self-hosted (256-512 MB) or Sentry's SaaS free tier - do not self-host
   full Sentry on this box.
8. Room admin: optional, later - reuse `RolesGuard` + `Role.ADMIN` with one list endpoint and
   the existing `softDeleteRoom`; skip react-admin/Refine for one table.

Lightweight alternative: Beszel (or Netdata) for host + containers + alerts, plus Grafana
Cloud free tier for dashboards/logs and Traefik metrics still scraped per-site. Tradeoff:
fewer containers and near-zero config, but two loosely joined tools instead of one query
surface, and SFU/room metrics still require the in-app prom-client work - which the default
stack needs anyway. Effort: the default is roughly an afternoon of compose wiring plus one
small NestJS module; the alternative is one to two hours but leaves Prometheus-style queries
off the table until needed.
