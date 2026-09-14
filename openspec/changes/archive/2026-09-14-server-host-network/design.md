# Design: server-host-network

## Context

Production (`docker-compose.prod.yml`) runs on a multi-site VPS: an external
Traefik gateway (`~/gateway`) owns host ports 80/443 and routes to this stack's
Caddy over the shared `web` Docker network; Caddy proxies to NestJS
(`server:3000`) over the project's `default` bridge network. coturn already runs
in `network_mode: host` (same reason: media should not traverse a userland
proxy). The server publishes RTC ports 40000-40099 tcp+udp, which spawns one
docker-proxy per binding - 4 per port, ~400 processes total. See proposal.md.

## Goals / Non-Goals

**Goals:**

- mediasoup RTC traffic reaches the SFU without a docker-proxy hop
- eliminate the ~400 docker-proxy processes (memory + process-table pressure)
- keep the dev compose (`docker-compose.yml`) and its topology untouched
- port 3000 must never be reachable from the internet

**Non-Goals:**

- no changes to dev compose, app code, mediasoup config, or TURN setup
- no multi-host / scaling work; this targets the single-VPS deployment
- no Traefik gateway changes (edge routing to Caddy is unaffected)

## Decisions

### 1. `network_mode: host` for the server (prod compose only)

Same rationale as coturn's existing host-mode deployment. mediasoup binds RTC
ports directly on the host; ufw rules for 40000-40099 apply as normal host
rules (docker-published ports bypass ufw via DOCKER chains, so this also
improves firewall control).

Alternatives considered:

- `userland-proxy: false` in `daemon.json` - kills all docker-proxy processes
  globally with one line, but is a host-wide switch affecting every project on
  the VPS (amnezia, trata, gateway) and still routes RTP through kernel DNAT +
  conntrack. Rejected: too broad, and the SFU owning its ports is the correct
  end state.
- Keep bridge + published ports (status quo) - rejected: the proxy zoo and
  per-packet userland hop are exactly the problem.

### 2. Caddy -> server via `host.docker.internal` + env-driven upstream

In host mode the server leaves container DNS, so Caddy cannot resolve
`server`. Caddy gets `extra_hosts: host.docker.internal:host-gateway` and the
shared `Caddyfile.routes` uses `reverse_proxy {$SERVER_UPSTREAM:server:3000}`.
The env default (`server:3000`) keeps the dev compose (unchanged, bridge
network) working; prod compose sets
`SERVER_UPSTREAM=host.docker.internal:3000`.

Alternative: fork `Caddyfile.routes` into a prod variant - rejected: routing
rules are deliberately shared between dev and prod; a single env knob is
smaller than a config fork.

### 3. Server -> postgres via loopback publish

The server's `DATABASE_URL` switches from `postgres:5432` (container DNS) to
`127.0.0.1:5432`; postgres adds `ports: ["127.0.0.1:5432:5432"]`. Loopback-only
binding keeps the database unreachable from the internet. The `migrate` job
stays on the bridge network and keeps using `postgres:5432` - only the
host-networked service needs the loopback path.

### 4. Firewall contract for port 3000

`app.listen(port)` binds 0.0.0.0; in host mode that is the host interface.
UFW default-deny keeps it closed from the internet; the runbook adds
`ufw allow from 172.16.0.0/12 to any port 3000 proto tcp` so Caddy (any Docker
subnet, current or future) can reach it. The rule is added before the deploy,
not after.

## Risks / Trade-offs

- [Active calls drop during the one-time cutover (`up -d` recreates server)]
  -> Deploy at an idle moment; rollback is `git revert` + `up -d`.
- [Port 3000 accidentally exposed if UFW default policy is permissive]
  -> Runbook step verifies `ufw status verbose` shows `deny (incoming)` before
  deploy; post-deploy check curls the public IP and must time out.
- [Egress RTP ingest range (42000-42100) now binds on the host]
  -> It was never published before either (internal FFmpeg ingest over
  loopback); ufw does not list it, so external reachability is unchanged.
  Documented in deployment.md ports section.
- [Dev and prod topologies now differ (bridge vs host)]
  -> Already true for the edge (Caddyfile vs Caddyfile.traefik, ports vs
  expose); documented in the compose differences table. Default env value in
  `Caddyfile.routes` keeps shared routing working in both.

## Migration Plan

1. (VPS, before deploy) `ufw allow from 172.16.0.0/12 to any port 3000 proto tcp`
2. Merge + deploy: `git pull && docker compose -f docker-compose.prod.yml up -d`
3. Verify: `ss -tulpn` shows server on 3000/40000-40099 on the host;
   `ps aux | grep [d]ocker-proxy | wc -l` drops to ~8; `curl http://<public-ip>:3000/`
   from an external machine times out; test call (video + audio, ideally one
   client from a mobile network to exercise TURN).
4. Rollback if needed: `git revert` + `docker compose -f docker-compose.prod.yml up -d`;
   the ufw rule can stay (harmless without a host-bound 3000).

## Open Questions

None.
