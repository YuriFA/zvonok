# infra/monitoring/

Self-hosted monitoring stack for the production VPS: Prometheus, Grafana,
node_exporter, postgres_exporter, Uptime Kuma, and GlitchTip. Monitors the
whole host - both sites (zvonok, wallet) behind the shared Traefik gateway.
Decision rationale:
`docs/adr/0005-adopt-prometheus-grafana-observability.md`,
OpenSpec change `2026-09-14-production-monitoring-stack`.

## Topology

```
Prometheus (host net, :9090) --scrapes--> 127.0.0.1:{3000 app /metrics,
    9100 node_exporter, 9187 postgres_exporter, 8082 traefik}
node_exporter (host net, :9100)
postgres_exporter (host net, :9187 -> 127.0.0.1:5432)
grafana        -- web network --> grafana.yurifa.site  (datasource:
                  host.docker.internal:9090)
uptime-kuma    -- web network --> status.yurifa.site; also watches Docker
                  containers through a read-only docker.sock mount
glitchtip      -- web + zvonok networks --> errors.yurifa.site,
                  DB = `glitchtip` database in the zvonok postgres container
```

No cAdvisor: Docker 28 on this host stores layers via the containerd
snapshotter, which cAdvisor cannot read (no per-container labels). Container
liveness is covered by Uptime Kuma Docker monitors; host metrics by
node_exporter.

`zvonok-server` exposes `GET /metrics` on host port 3000 (internal-only; no
public route). Traefik must publish its own metrics on `127.0.0.1:8082`
(one-time gateway edit, below).

## One-time VPS setup (ordered)

1. **Swap** (host currently has none):
   `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile &&
   swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`
2. **Firewall**: keep monitoring ports off the internet. If ufw is active
   (default deny), allow Docker subnets to reach Prometheus:
   `ufw allow from 172.16.0.0/12 to any port 9090 proto tcp`
   Without an active firewall, `9090`/`9100`/`9187` (Prometheus,
   node_exporter, postgres_exporter - all auth-less) would be public:
   enable ufw first.
3. **Gateway metrics** (`~/gateway/docker-compose.yml`, versioned in this
   repo at `infra/gateway/` - the checked-in compose already includes this).
   Traefik exposes metrics on a dedicated entrypoint bound to host loopback;
   on hosts deployed before this was checked in, add to the compose:

   ```yaml
   command:
     # ...existing web/websecure args, plus:
     - --entrypoints.metrics.address=:8082
     - --metrics.prometheus=true
     - --metrics.prometheus.entrypoint=metrics
     - --metrics.prometheus.addRoutersLabels=true
   ports:
     - 127.0.0.1:8082:8082
   ```

   Recreate Traefik and verify:
   `curl -s 127.0.0.1:8082/metrics | grep traefik_service_requests_total`
   (counters appear after the first request through any router).
   Also confirm the public edge does NOT serve metrics:
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:80/metrics`
   should not answer 200.
4. **Database roles**: replace the passwords in
   `infra/monitoring/sql/monitoring-init.sql`, then run it inside the VPS
   postgres container (name and user from `docker exec zvonok-postgres env
   | grep POSTGRES`):
   `docker exec -i zvonok-postgres psql -U zvonok_admin -d zvonok < infra/monitoring/sql/monitoring-init.sql`
5. **DNS**: A records for `grafana.` / `status.` / `errors.yurifa.site`
   pointing at the VPS IP (Traefik issues LE certs on first request).
6. **Deploy**:
   `scp -r infra/monitoring/ vps:~/monitoring`, then on the VPS:
   `cp ~/monitoring/.env.example ~/monitoring/.env` (fill every value;
   check `docker network ls` for the zvonok network name), and
   `docker compose -f ~/monitoring/docker-compose.monitoring.yml up -d`.

## First logins and manual wiring

- **Grafana** `https://grafana.yurifa.site` - `.env` admin credentials.
  Alert rules are provisioned; create the Telegram contact point (bot token
  from @BotFather + chat id) and set it as the default notification policy
  (Alerting - Contact points / Notification policies).
- **Uptime Kuma** `https://status.yurifa.site` - create the admin account on
  first visit; add HTTPS monitors for `zvonok.yurifa.site`,
  `docs.zvonok.yurifa.site`, `wallet.yurifa.site`; add a Telegram
  notification; also register the same three monitors in a free external
  pinger (UptimeRobot) - Kuma cannot report the death of its own host.
  Additionally add **Docker monitors** in Kuma (Monitors - Setup - Kuma
  detects the socket mounted at /var/run/docker.sock): watch the critical
  containers (zvonok-server, zvonok-postgres, zvonok-coturn, traefik).
  Container-down alerts come from Kuma - Prometheus does not see
  per-container liveness on this host (no cAdvisor, see the note above).
- **GlitchTip** `https://errors.yurifa.site` - register the first user
  (becomes org owner), create a project, take the DSN, set it as
  `SENTRY_DSN` in the zvonok server compose environment, and redeploy the
  server.

## App metrics

`zvonok_sfu_active_rooms`, `zvonok_sfu_connected_peers`,
`zvonok_sfu_open_transports` - published by the server at `/metrics`
(read from live router/presence/transport state at scrape time). Dashboards
are provisioned from `dashboards/` (app overview plus node/Traefik/postgres
community dashboards). Alert rules: `provisioning/alerting/`.

## Rollback

`docker compose -f ~/monitoring/docker-compose.monitoring.yml down`
(volumes keep history); revert the gateway edit; unset `SENTRY_DSN`.
The app's `/metrics` endpoint is harmless unscraped.
