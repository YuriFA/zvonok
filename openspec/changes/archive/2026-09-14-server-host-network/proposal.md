# Proposal: server-host-network

## Why

Publishing the mediasoup RTC port range (100 ports x tcp+udp x IPv4/IPv6) through
Docker spawns ~400 `docker-proxy` processes on the VPS - roughly 1.3 GB of RSS
accounting, hundreds of MB of real memory - and puts a userland proxy process in
the path of every RTP packet, adding latency, jitter, and per-packet CPU overhead
to real-time media. An SFU should own its UDP/TCP ports directly.

## What Changes

- **BREAKING** (deployment topology): `server` in `docker-compose.prod.yml` moves
  from the bridge network to `network_mode: host`; the 40000-40099 port
  publishing block is removed (mediasoup binds host ports directly).
- `postgres` in `docker-compose.prod.yml` publishes `127.0.0.1:5432` (loopback
  only): the host-networked server loses container DNS and reaches the database
  via `127.0.0.1:5432` in its `DATABASE_URL`.
- `caddy` in `docker-compose.prod.yml` gets
  `extra_hosts: host.docker.internal:host-gateway` and
  `SERVER_UPSTREAM=host.docker.internal:3000`.
- `Caddyfile.routes` upstream becomes `{$SERVER_UPSTREAM:server:3000}` (env var
  with default) so the dev compose (bridge network, unchanged) keeps working.
- `PORT` (3000) now binds directly on the host: `docs/deployment.md` documents
  that it must be firewalled from the internet and allowed only from Docker
  subnets (`ufw allow from 172.16.0.0/12 to any port 3000 proto tcp`).
- Dev compose (`docker-compose.yml`) is unchanged.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- none

No spec-level product behavior changes: APIs, WebSocket events, media flows, and
auth are untouched. This is a deployment-topology-only change
(`skip_specs: true`).

## Impact

- `docker-compose.prod.yml` (server, postgres, caddy services)
- `Caddyfile.routes` (single upstream line, env-driven)
- `docs/deployment.md` (architecture diagram, ports table, firewall section,
  compose differences table, `PORT` variable row)
- VPS operations (one-time, manual): ufw rule for 3000 from Docker subnets
  before deploy; `docker compose -f docker-compose.prod.yml up -d`
- Rollback: `git revert` + `up -d` (topology change is fully reversible)
