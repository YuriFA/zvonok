# Tasks: production-monitoring-stack

## 1. Server metrics module

- [x] 1.1 Add `@willsoto/nestjs-prometheus` to `apps/server`, register the
      module with default Node.js metrics collected, controller bound to
      `metrics` (internal-only: no Caddy/Traefik route added)
- [x] 1.2 Add scrape-time gauges via `makeGaugeProvider` collect callbacks:
      rooms with a live SFU router, connected peers from
      `RoomPresenceService`, open mediasoup transports
- [x] 1.3 Add `apps/server/.env.example` entries (none required for
      metrics; document the endpoint is unauthenticated and internal)
- [x] 1.4 Unit tests covering the spec scenarios: two rooms with three and
      one peers produce rooms=2/peers=4; ending a room returns gauges to
      baseline; metric values are read from live presence/router state,
      not cached
- [x] 1.5 Smoke-verify locally: boot the server, run a room lifecycle via
      the existing API tests path or a scratch script, `curl :3000/metrics`
      and confirm the three gauges appear and change

## 2. Error reporting (GlitchTip client side)

- [x] 2.1 Add `@sentry/nestjs`; env-gated bootstrap (`SENTRY_DSN` unset =
      no reporting, behavior identical to today); install the global
      filter/interceptor for unhandled errors and 5xx responses
- [x] 2.2 Scrub secrets from reports: no cookies, authorization headers,
      or password field values
- [x] 2.3 Add `SENTRY_DSN` to `apps/server/.env.example` with a comment
      pointing at GlitchTip
- [x] 2.4 Unit test: DSN unset leaves bootstrap a no-op; with a DSN, an
      thrown handler error produces a captured event with route + stack
      and no cookie/auth data

## 3. Monitoring stack (monitoring/)

- [x] 3.1 `monitoring/docker-compose.monitoring.yml`: prometheus (host
      network, `--storage.tsdb.retention.time=30d`, scrape config for
      server :3000, node :9100, cadvisor :8080, postgres :9187, traefik
      :8082), node_exporter (host namespaces), cAdvisor
      (`127.0.0.1:8080`), postgres_exporter (read-only monitoring user
      against `127.0.0.1:5432`)
- [x] 3.2 Grafana service with `provisioning/`: Prometheus datasource,
      dashboards (node exporter full, cAdvisor containers, postgres,
      official Traefik 17346, zvonok app overview with rooms/peers/
      transports), alert rules (disk >80 warn / >90 critical, RAM >90,
      container down 2m, scrape target down 5m) and a Telegram contact
      point (token/chat id from env)
- [x] 3.3 Uptime Kuma service with a named volume, Traefik labels for
      `status.yurifa.site` on the `web` network
- [x] 3.4 GlitchTip services (web + worker) with `SECRET_KEY`, Traefik
      labels for `errors.yurifa.site`, `DATABASE_URL` pointing at the
      `glitchtip` database in the existing postgres container
- [x] 3.5 `monitoring/.env.example` listing every variable (Telegram,
      postgres exporter credentials, GlitchTip secret/DSN host, Grafana
      security settings) plus `monitoring/README.md`: deploy steps, the
      manual VPS checklist, first-login notes
- [x] 3.6 `openspec validate` passes with the new files in place

## 4. Documentation

- [x] 4.1 `docs/deployment.md`: monitoring section - architecture sketch
      of the scrape topology, the three new subdomains, the gateway edit,
      swapfile step, and the ordered manual rollout checklist
- [x] 4.2 `docs/adr/0005-adopt-prometheus-grafana-observability.md`:
      record the stack decision, rejected alternatives (Netdata/Beszel +
      Grafana Cloud, self-hosted Sentry, Zabbix, Loki now), and the RAM
      budget rationale
- [x] 4.3 Update the docs-site navigation (apps/docs) if it indexes
      deployment sections (checked: the sidebar links `/deployment` as a
      single page; no per-section index exists, nothing to change)

## 5. VPS rollout (manual, ordered)

- [ ] 5.1 Create a 2 GB swapfile, persist in fstab, verify swappiness
- [ ] 5.2 Edit `~/gateway/docker-compose.yml`: add
      `--metrics.prometheus=true`,
      `--metrics.prometheus.addRoutersLabels=true`, publish
      `127.0.0.1:8082:8082`; recreate Traefik; confirm
      `curl 127.0.0.1:8082/metrics` exposes per-router metrics
- [ ] 5.3 Create the `glitchtip` database and a scoped role inside the
      existing postgres container
- [ ] 5.4 Copy `monitoring/` to `~/monitoring`, fill `.env`, bring the
      project up, confirm all targets are `up` in Prometheus
- [ ] 5.5 Add DNS A records for `grafana.` / `status.` / `errors.
      yurifa.site`, verify LE certificates and first logins
- [ ] 5.6 Register the three HTTPS monitors in UptimeRobot
- [ ] 5.7 Redeploy the server with `SENTRY_DSN` set; trigger a test error
      and confirm the event lands in GlitchTip with no secret data
- [ ] 5.8 End-to-end verification against the spec: two-browser room
      shows rooms/peers gauges in Grafana; stopping a container fires
      the Telegram alert; UptimeRobot and Kuma both report a pulled site
