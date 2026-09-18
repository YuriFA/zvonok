# Design: production-monitoring-stack

## Context

VPS: 4 vCPU, 3.9 GB RAM (2.9 GB available), 48 GB disk (58% used), **no
swap**, load ~0.15. Workloads: zvonok stack (server in host network mode
since 542b60c, postgres loopback-published on 127.0.0.1:5432), the wallet
site (separate compose project), an AmneziaWG VPN container, and the
shared Traefik gateway in `~/gateway`. Domains: `zvonok.yurifa.site`,
`docs.zvonok.yurifa.site`, `wallet.yurifa.site`.

## Goals / Non-Goals

**Goals:**

- One self-hosted stack, versioned in this repo, that observes the whole
  host: both sites, all containers, the app, and uptime.
- Call-activity metrics (rooms, peers, transports) published by the app
  itself, since no maintained mediasoup exporter exists.
- Errors visible in a self-hosted Sentry-compatible UI (GlitchTip).
- Alerts reach Telegram without the operator watching dashboards.

**Non-Goals:**

- Room admin UI (separate change).
- App-level instrumentation of the wallet site (host + Traefik metrics
  cover it).
- Log aggregation (Loki deferred; json-file rotation already caps disk).
- Hosted Grafana Cloud (kept as fallback if RAM pressure appears).

## Decisions

1. **Standard stack over lightweight alternatives.** Prometheus + Grafana
   + node_exporter + cAdvisor + postgres_exporter instead of
   Beszel/Netdata + Grafana Cloud. Rationale: 4 vCPU / 48 GB disk fit it,
   it gives one query surface for host, containers, DB, Traefik, and app
   metrics, and the in-app prom-client work is needed under either option.
   Memory budget ~0.7-1 GB against 2.9 GB available.
2. **App publishes its own SFU metrics.** The only mediasoup Prometheus
   exporter (kokutele/mediasoup-exporter) is unmaintained (last push
   2021, 7 stars). Gauges read live state at scrape time via collect
   callbacks: live routers in the SFU worker manager, the presence
   service's per-room peer map, open transports. No polling loops, no new
   background work per scrape.
3. **Prometheus runs in host network mode.** The app server is already
   host-networked (542b60c) with port 3000 firewalled to Docker subnets;
   a bridge-network Prometheus cannot reach it. Host-mode Prometheus
   scrapes everything uniformly over loopback: server :3000/metrics,
   node_exporter :9100, cAdvisor :8080, postgres_exporter :9187 (which
   connects to 127.0.0.1:5432), Traefik :8082.
4. **`/metrics` stays internal-only.** No public gateway route, no extra
   auth surface. Debugging happens over SSH (curl on the host or tunnel).
5. **Traefik metrics via loopback publish.** Gateway compose gains
   `--metrics.prometheus=true`, `--metrics.prometheus.addRoutersLabels=true`,
   and `127.0.0.1:8082:8082`. This is the only per-site traffic
   attribution on the box (host-level metrics mix zvonok and wallet).
   The built-in Traefik dashboard is skipped: the official Grafana
   dashboard 17346 covers it.
6. **GlitchTip, self-hosted, reusing zvonok-postgres.** Sentry SaaS has
   signup friction from RU and ships data off-box; self-hosted Sentry
   bundles ClickHouse/Snuba/Relay, too heavy next to an SFU. GlitchTip
   needs PG14+ and ~512 MB; a separate `glitchtip` database in the
   existing postgres container avoids a second database server. The
   server integrates via `@sentry/nestjs` with an env-gated DSN.
7. **Two-layer uptime checking.** Uptime Kuma on this host (HTTPS checks
   for all three sites, Telegram notifications) plus an external free
   UptimeRobot account doing the same checks from outside: Kuma cannot
   report the death of its own host.
8. **Alert set fixed up front** (Grafana to Telegram): disk >80% warn /
   >90% critical, RAM >90%, container down 2 min, scrape target down
   5 min. Site downtime comes from Kuma and UptimeRobot.
9. **Monitoring stack as a separate compose project.** Files live in
   `monitoring/` in this repo (compose + Grafana provisioning YAML so
   dashboards and alerts are versioned), deployed to `~/monitoring` with
   the same scp + `docker compose up -d` pattern as the other sites.
10. **30-day Prometheus retention.** A few hundred series at this scale
    cost well under 200 MB by the official disk formula, so the longer
    lookback is free.
11. **2 GB swapfile before rollout.** The host has no swap; a monitoring
    stack plus a call-driven mediasoup memory spike must degrade to
    swapping, not OOM-kill `zvonok-server`.

## Risks / Trade-offs

- **RAM budget**: the stack adds ~0.7-1 GB to 2.9 GB available. Swap
  cushions spikes; if pressure persists, the escape hatch is dropping
  local Prometheus/Grafana for Grafana Cloud free tier (agents stay).
- **cAdvisor overhead** has no official number; it is the least essential
  exporter and can be dropped first if it shows up in its own metrics.
- **GlitchTip shares the app's postgres instance**: an app-database
  outage also takes down error storage. Accepted - metrics and uptime
  stay independent, and a second postgres costs more than it protects.
- **Metric cardinality**: per-room gauges are bounded by real usage; if
  label churn ever matters, rooms can switch from per-room labels to a
  single total gauge.
- **Manual VPS steps** (gateway edit, swapfile, Telegram token,
  UptimeRobot, first-login passwords) are listed in tasks and
  `docs/deployment.md`; they cannot be automated from this repo without
  widening blast radius.
