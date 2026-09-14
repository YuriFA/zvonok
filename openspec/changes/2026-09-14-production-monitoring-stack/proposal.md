# Proposal: production-monitoring-stack

## Why

The production VPS has zero observability: no metrics, no uptime checks, no
error tracking, and no per-site visibility for the two sites (zvonok,
wallet) sharing one Traefik gateway. Failures - OOM under call load, full
disk, a dead container, an expired upstream - are invisible until users
report them. The host has ~1 GB RAM headroom and 20 GB free disk, enough
for a standard self-hosted stack.

## What Changes

- `apps/server`: new metrics module (`@willsoto/nestjs-prometheus`) exposing
  `GET /metrics` with default Node.js metrics plus gauges for active rooms
  (live Routers in `SfuService`), connected peers (`RoomPresenceService`),
  and open mediasoup transports. The endpoint is internal-only: not routed
  through Traefik, scraped by Prometheus over the host network.
- `apps/server`: error reporting via `@sentry/nestjs` pointed at self-hosted
  GlitchTip (Sentry-compatible DSN).
- New `monitoring/` directory in this repo: `docker-compose.monitoring.yml`
  plus Grafana provisioning YAML (dashboards and alert rules versioned).
  On the VPS it runs as a separate compose project alongside `~/gateway`,
  monitoring the whole host (both sites):
  - Prometheus (host network, 30-day retention): scrapes `127.0.0.1:3000`
    (server, host-network mode), `127.0.0.1:9100` (node_exporter),
    `127.0.0.1:8080` (cAdvisor), `127.0.0.1:9187` (postgres_exporter),
    `127.0.0.1:8082` (Traefik).
  - node_exporter, cAdvisor, postgres_exporter (connects to
    `127.0.0.1:5432`).
  - Grafana at `grafana.yurifa.site` behind Traefik (built-in auth) with the
    official Traefik dashboard (17346) plus node/container/app dashboards.
  - Uptime Kuma at `status.yurifa.site`: HTTPS checks for `zvonok.yurifa.site`,
    `docs.zvonok.yurifa.site`, `wallet.yurifa.site`, notifications to
    Telegram.
  - GlitchTip at `errors.yurifa.site`, storing into a separate `glitchtip`
    database in the existing `zvonok-postgres` container (PG16 satisfies its
    PG14+ requirement).
- `~/gateway/docker-compose.yml` (manual edit on the VPS):
  `--metrics.prometheus=true`, `--metrics.prometheus.addRoutersLabels=true`,
  and a loopback publish `127.0.0.1:8082:8082` so host-networked Prometheus
  can scrape per-site router metrics.
- VPS one-time ops: 2 GB swapfile (the host currently has none; mediasoup
  and the monitoring stack must not OOM-kill `zvonok-server`).
- Alert rules in Grafana to Telegram: disk >80% warn / >90% critical,
  RAM >90%, any container down for 2 min, scrape target down 5 min; site
  downtime alerts come from Uptime Kuma and an external UptimeRobot free
  account (pings the sites from outside, catches total VPS death).
- Explicitly out of scope: room admin UI (deferred to its own change; the
  `DELETE /rooms/:id` endpoint already exists), app-level metrics for the
  wallet site (covered at host + Traefik level only), log aggregation
  (Loki deferred; `json-file` rotation already configured).

## Capabilities

### New Capabilities

- `monitoring`: server-side observability behavior - the internal-only
  `GET /metrics` Prometheus endpoint and its metric semantics (rooms,
  peers, transports), and error reporting to the configured
  Sentry-compatible backend.

### Modified Capabilities

- none

No existing product behavior changes: APIs, WebSocket events, media flows,
and auth are untouched. Everything outside `apps/server` is deployment
topology and is tracked by tasks, not specs.

## Impact

- `apps/server/src/` (new metrics module wired into `AppModule`; optional
  Sentry/GlitchTip instrumentation in `main.ts`/bootstrap)
- `apps/server/package.json` (runtime deps)
- `monitoring/` (new: compose file, Grafana provisioning tree, README-ish
  ops notes)
- `docs/deployment.md` (monitoring section, new subdomains, gateway edit)
- VPS manual ops (one-time): gateway edit, swapfile, monitoring compose up,
  Telegram bot token, UptimeRobot account, first-login passwords
- Rollback: `docker compose down` the monitoring project; the `/metrics`
  endpoint is harmless unscraped; error reporting is env-gated
