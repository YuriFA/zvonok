# 0005. Adopt self-hosted Prometheus/Grafana observability stack

- Status: accepted
- Date: 2026-09-14
- Context: production VPS had zero monitoring (research note
  `docs/research/production-monitoring-stack.md`, OpenSpec change
  `2026-09-14-production-monitoring-stack`)

## Context

The production VPS (4 vCPU / 4 GB RAM / 48 GB disk, ~2.9 GB RAM available)
runs the zvonok stack (host-networked NestJS + mediasoup, postgres,
caddy, coturn), a second site behind the same Traefik gateway, a VPN
container, and the gateway itself. Until now there were no metrics, no
uptime checks, and no error tracking: failures surfaced only through user
reports. The operator wanted client/room counts, host and per-site load,
active rooms, and standard production alerting, and had no prior
experience with the Prometheus ecosystem.

## Decision

Adopt the standard self-hosted stack, deployed as a separate compose
project (`monitoring/`, runs at `~/monitoring`):

- App publishes its own metrics (`@willsoto/nestjs-prometheus` at
  internal-only `/metrics`): active rooms (live routers), connected peers,
  open transports, plus default Node.js process metrics.
- Prometheus (host network, 30-day retention) scrapes host loopback:
  app :3000, node_exporter :9100, cAdvisor :8080, postgres_exporter :9187
  (read-only `metrics_reader` role), Traefik :8082
  (`--metrics.prometheus` + `addRoutersLabels` in the shared gateway -
  the only per-site traffic attribution).
- Grafana with provisioned dashboards and alert rules; Telegram contact
  point wired once by hand. Alerts: disk >80/>90%, RAM >90%, scrape target
  down 5m; site downtime via Uptime Kuma plus an external UptimeRobot
  account.
- Errors: GlitchTip (Sentry-compatible) self-hosted, storing into a
  separate database in the existing zvonok postgres; server reports via
  `@sentry/nestjs` with an env-gated DSN and secret scrubbing.
- A 2 GB swapfile precedes rollout (host had none).

## Alternatives rejected

- **Netdata / Beszel + Grafana Cloud free tier**: lighter (~100-200 MB vs
  ~0.7-1 GB), but two loosely joined tools, no single query surface, and
  the in-app SFU metric work is needed either way. Kept as the escape
  hatch if RAM pressure materializes.
- **Self-hosted Sentry**: bundles ClickHouse/Snuba/Relay - too heavy next
  to an SFU on a 4 GB box; SaaS has signup friction from RU and ships
  data off-box.
- **Zabbix**: its own sizing table starts a "small" install at 8 GiB RAM.
- **Loki/Allog now**: json-file rotation already caps disk; central
  logging deferred until grep-through-`docker logs` stops being enough.
- **A maintained mediasoup exporter**: none exists (only an unmaintained
  2021 project), so the app publishes metrics itself.

## Consequences

- One query surface for host, containers, database, per-site traffic, and
  SFU activity; dashboards and alert rules are versioned YAML in the repo.
- Memory budget grows by ~0.7-1 GB on a 2.9 GB headroom; swap absorbs
  spikes, and the hosted fallback is documented.
- New manual VPS steps (gateway edit, swap, DB roles, DNS, contact point)
  are listed in `monitoring/README.md` and `docs/deployment.md`.
- GlitchTip shares the app's postgres instance: an app-database outage
  also takes down error storage (accepted; metrics and uptime stay
  independent).
