# Production Deployment Guide

This guide covers deploying ZvonOK with Docker Compose on a Linux server (or locally for testing).

## Architecture Overview

```
Internet
   │
   ├─ HTTPS (443) ──▶ Traefik ──▶ Caddy ──┬── Static files (React SPA from /srv/client)
   │                  (gateway)           ├── /auth/*, /users/*, /rooms/* ──▶ NestJS :3000
   │                  TLS + LE            ├── /socket.io/* ──▶ NestJS :3000 (WebSocket)
   │                  (prod only)         └── /* (fallback) ──▶ index.html (SPA routing)
   │
   ├─ UDP/TCP (40000-40499) ──▶ NestJS :3000 (host network mode — mediasoup binds ports directly)
   │
   └─ UDP/TCP (3478, 5349) ──▶ coturn (STUN/TURN relay)
     └─ UDP (49152-49252)     relay port range (host network mode)
```

In production, a shared **Traefik** gateway (`~/gateway` on the VPS) owns ports 80/443, terminates TLS (Let's Encrypt), and routes by hostname to this stack's Caddy over the shared `web` Docker network. For local/standalone runs Traefik is absent and Caddy manages TLS itself.

**Five services** run via `docker-compose.yml`; production adds a sixth, the docs site:

| Service    | Image / Dockerfile         | Role |
|------------|---------------------------|------|
| `postgres` | `postgres:16-alpine`       | Database |
| `migrate`  | `apps/server/Dockerfile` (target: `migrator`) | Runs `prisma migrate deploy`, then exits |
| `server`   | `apps/server/Dockerfile` (target: `production`) | NestJS API + mediasoup SFU |
| `caddy`    | `apps/client/Dockerfile`   | Caddy reverse proxy with baked-in client static assets; TLS at the edge (Traefik in prod, Caddy itself in dev) |
| `coturn`   | `coturn/coturn:alpine`     | STUN/TURN server for NAT traversal (host network mode) |
| `docs`     | `apps/docs/Dockerfile.docs` | Static documentation site (VitePress build served by nginx); prod compose only, behind Traefik at `docs.<domain>` |

### `docker-compose.yml` vs `docker-compose.prod.yml`

Both files define the same five app services (the `docs` site service exists only in prod) but differ intentionally:

| Difference | `docker-compose.yml` | `docker-compose.prod.yml` | Reason |
|------------|---------------------|---------------------------|--------|
| Images | Builds from local Dockerfiles | Pulls pre-built images from GHCR | Prod uses CI-built images; dev builds locally |
| Server `TURN_*` env vars | Not set | `TURN_URL`, `TURNS_URL`, `TURN_AUTH_SECRET` | In local dev coturn runs without auth; prod mints ephemeral TURN credentials and passes them to clients via `sfu:transport-created` |
| Server `EGRESS_*` env vars | Defaults | `EGRESS_MEDIA_PORT_MIN/MAX`, `EGRESS_HLS_DIR`, `EGRESS_RECORDINGS_DIR` on the `egress_data` volume | HLS trees and recordings persist on a named volume instead of the container filesystem; the RTP ingest range stays disjoint from the mediasoup RTC range |
| Caddy `certs` volume | `./certs:/srv/certs:ro` | Not mounted | Dev uses self-signed certs from `./certs`; prod terminates TLS at Traefik |
| Caddy entrypoint | Host ports 80/443, `Caddyfile` | `expose: 80` behind Traefik, `Caddyfile.traefik` | Prod shares ports 80/443 with other sites via the gateway |
| Server network | Bridge network, RTC `ports:` published | `network_mode: host` | mediasoup binds RTC ports directly on the host; publishing 100 ports (tcp+udp, IPv4+IPv6) spawns ~400 docker-proxy processes and puts a userland hop on every RTP packet |

## Traefik Gateway (Multi-Site Production)

The VPS hosts several independent sites, each in its own repository, each on its own subdomain. A single Traefik container (`~/gateway`) owns host ports 80/443, obtains Let's Encrypt certificates for every domain, and routes by `Host` header to containers on the shared external Docker network `web`. The first-time gateway setup is walked through by `scripts/setup-traefik-gateway.sh`.

Why prod uses `Caddyfile.traefik` instead of the dev `Caddyfile`: with a real domain, the dev config enables automatic HTTPS and redirects every plain-HTTP request to HTTPS. Traefik forwards plain HTTP, so that redirect would loop forever. `Caddyfile.traefik` serves plain HTTP only — no TLS, no redirects; routing rules are shared via `Caddyfile.routes`.

### Adding a New Site to the VPS

Each new repository deploys independently — no changes to the gateway or to zvonok:

1. **Dockerfile** — any stack; the app listens on an internal port (e.g., `3001`).
2. **`docker-compose.yml`** in the site's repo — no host `ports`, only `expose`, plus Traefik labels and both networks:

   ```yaml
   services:
     app:
       image: ghcr.io/USER/REPO/app:latest
       expose: ["3001"]
       labels:
         - "traefik.enable=true"
         - "traefik.http.routers.shop.rule=Host(`shop.example.com`)"
         - "traefik.http.routers.shop.entrypoints=websecure"
         - "traefik.http.routers.shop.tls.certresolver=le"
         - "traefik.http.services.shop.loadbalancer.server.port=3001"
       networks: [default, web]
       restart: unless-stopped

   networks:
     web:
       external: true
   ```

3. **Deploy workflow** — same pattern as zvonok: scp compose to `~/shop` on the VPS, then `docker network create web 2>/dev/null || true && docker compose pull && docker compose up -d`.
4. **Repo secrets** — `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (+ `GHCR_TOKEN` if images live in GHCR).
5. **DNS** — A record `shop.example.com → VPS IP`.

The certificate is issued automatically by Traefik on the first request. Router names (`shop`) must be unique across all containers on the gateway.

## Docs Site

`docs.<domain>` serves the documentation site. It is its own container in the prod stack: `apps/docs/Dockerfile.docs` builds the curated markdown under `docs/` with VitePress and serves the static output with nginx. The `build-docs` CI job publishes it as `ghcr.io/<repo>/docs` with the same `sha-*` / `latest` tags as the app images; `docker compose pull && docker compose up -d` on the VPS picks it up like the other services. For local preview, run `pnpm docs:dev`.

Docs rebuilds are independent from the app edge: the docs container is a separate site on the shared `web` network with its own Traefik router, so redeploying the docs never restarts Caddy (and rebuilding the app never restarts the docs).

## Prerequisites

### VPS Requirements

- **CPU**: 2+ cores (mediasoup compiles a native worker and processes real-time media)
- **RAM**: 2 GB minimum, 4 GB recommended
- **OS**: Ubuntu 22.04+, Debian 12+, or any Docker-compatible Linux
- **Disk**: 20 GB+ (Docker images, database, logs)
- **Network**: Public IPv4 address with unrestricted UDP

### Software Requirements

- Docker Engine 24+ and Docker Compose v2
- `git` (to clone the repository)
- A domain name with DNS A record pointing to the server's public IP (for Let's Encrypt HTTPS)

### Ports

The following ports must be open on the server firewall:

| Port(s) | Protocol | Service | Purpose |
|---------|----------|---------|---------|
| 80 | TCP | Traefik (prod) / Caddy (dev) | HTTP redirect + ACME challenge |
| 443 | TCP + UDP | Traefik (prod) / Caddy (dev) | HTTPS + HTTP/3 |
| 3478 | UDP + TCP | coturn | STUN/TURN |
| 5349 | UDP + TCP | coturn | TURNS (TLS) |
| 40000–40499 | UDP + TCP | mediasoup | WebRTC media transport |
| 49152–49252 | UDP | coturn | TURN relay range |

> For local testing without a domain, `SITE_ADDRESS=localhost` uses Caddy's self-signed certificate.

> **Port 3000 in production**: the `server` container runs in `network_mode: host`, so NestJS binds 3000 directly on the host. It must **not** be open to the internet - the edge (Traefik → Caddy) is the only public entry point. Allow it from Docker subnets only:
>
> ```bash
> sudo ufw allow from 172.16.0.0/12 to any port 3000 proto tcp
> ```
>
> The egress RTP ingest range (42000-42100) is internal FFmpeg ingest inside the server container and stays unreachable from the internet.

## Step 1: DNS & Domain Setup

Before deploying, point your domain to the server:

```bash
# Create a DNS A record:
#   chat.example.com  →  YOUR_SERVER_PUBLIC_IP
#   docs.example.com  →  YOUR_SERVER_PUBLIC_IP   (docs site, before the first deploy)
#
# Verify propagation:
dig +short chat.example.com
# Should return your server IP
```

The `docs.example.com` record must exist before the first deploy; Traefik obtains its certificate on the first request.

If you don't have a domain yet, you can use `SITE_ADDRESS=localhost` for initial testing (Caddy will use a self-signed certificate).

## Step 2: Server Firewall

Configure the firewall before starting services. With `ufw`:

```bash
# SSH (if not already allowed)
sudo ufw allow 22/tcp

# HTTP + HTTPS (Caddy)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp     # HTTP/3

# STUN/TURN (coturn)
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp

# mediasoup RTC media
sudo ufw allow 40000:40499/tcp
sudo ufw allow 40000:40499/udp

# coturn relay range
sudo ufw allow 49152:49252/udp

# NestJS API (prod: host network mode) - Docker subnets only, never public
sudo ufw allow from 172.16.0.0/12 to any port 3000 proto tcp

sudo ufw enable
```

## Step 3: Clone and Configure

```bash
# Clone the repo
git clone <repo-url> && cd zvonok

# Create env file from template
make setup     # equivalent to: cp .env.production.example .env

# Edit .env — fill in ALL required values (see Environment Variables below)
$EDITOR .env
```

Key values to change:
- `SITE_ADDRESS` — your domain (e.g., `chat.example.com`)
- `CLIENT_URL` — full URL (e.g., `https://chat.example.com`)
- `POSTGRES_PASSWORD` — generate a strong random password
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — generate with `openssl rand -hex 64`
- `MEDIASOUP_ANNOUNCED_IP` — your server's public IPv4 address
- `TURN_EXTERNAL_IP` — same public IP as `MEDIASOUP_ANNOUNCED_IP`
- `TURN_AUTH_SECRET` (generate with `openssl rand -base64 32`): shared secret for ephemeral TURN auth, identical on the server and coturn containers

## Step 4: Deploy

```bash
# Build and start all services
make deploy-local    # equivalent to: docker compose up -d --build

# Check all services are healthy
make status    # equivalent to: docker compose ps -a
```

> Run `make help` to see all available Makefile targets.

Expected output of `make status`: `postgres` should show "healthy", `migrate` should show "Exited (0)", and `server`, `caddy`, `coturn` should show "Up".

## Step 5: Verify

1. **Open the app**: Navigate to `https://your-domain.com` — you should see the login page
2. **Register**: Create two user accounts
3. **Test a call**: Create a room, join from two different browsers (or browser + incognito)
4. **Verify media flows**: Both participants should see/hear each other
5. **Test TURN relay**: To specifically verify TURN is working, use [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) with your TURN server credentials, or test from a restrictive network (e.g., mobile hotspot)

If media doesn't flow, see the [Troubleshooting](#troubleshooting) section.

## Deploying from your workstation (without GitHub Actions)

The primary deploy path is the `Deploy` workflow (`.github/workflows/deploy.yml`). The root Makefile carries an equivalent manual path for when Actions minutes are exhausted or you need to ship without CI. Both build the same four images (`server`, `migrator`, `caddy`, `docs`), push them to GHCR as `sha-<short>` + `latest`, and run the identical VPS-side sequence (copy compose files, `pull`, `up -d --remove-orphans`, prune) - whichever path deployed last wins.

One-time setup on the workstation:

```bash
echo 'SSH_TARGET=deploy@203.0.113.10' > .deploy.env   # gitignored; or an ~/.ssh/config alias
docker login ghcr.io -u <github-user>                 # PAT with write:packages
gh auth login                                         # deploy tagging publishes a GitHub Release
```

Deploy and roll back:

```bash
make deploy                    # build amd64, push, deploy current HEAD, tag it (vYYYY.MM.DD + release)
make rollback TAG=v2026.09.14  # redeploy an already-pushed deploy tag or sha-<short> (no rebuild)
```

Notes:
- The VPS needs its stored GHCR login (`scripts/setup-vps.sh`, step 4) to pull; on-box operation is plain `docker compose -f docker-compose.prod.yml ...` (see the setup script output).
- Builds run under amd64 emulation on Apple Silicon; enable Rosetta in Docker Desktop (Settings > General > "Use Rosetta for x86_64/amd64 emulation") for acceptable speed.
- Full analysis of the surveyed alternatives: `docs/research/manual-deploy-without-github-actions.md`.

## Environment Variables

All variables are set in the root `.env` file. Copy from `.env.production.example`.

### Domain & Caddy

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SITE_ADDRESS` | Yes | `localhost` | Domain name for Caddy. Set to your domain (e.g., `chat.example.com`) for automatic Let's Encrypt. Set to `localhost` for self-signed TLS. |

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | NestJS HTTP port. Caddy proxies to it; in production (host network mode) it binds directly on the host - keep it firewalled from the internet |
| `CLIENT_URL` | Yes | `https://localhost` | Full URL of the client (used for CORS). E.g., `https://chat.example.com` |
| `SENTRY_DSN` | No | — | GlitchTip/Sentry-compatible DSN for error reporting. Unset = reporting disabled. Read before ConfigModule: set as a real environment variable in the compose file |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Yes | — | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password (use a strong random value) |
| `POSTGRES_DB` | Yes | — | Database name |

> The `DATABASE_URL` is composed automatically in `docker-compose.yml` from these values.

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_ACCESS_SECRET` | Yes | — | Secret for signing access tokens. Generate with: `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Yes | — | Secret for signing refresh tokens. Generate with: `openssl rand -hex 64` |
| `JWT_ACCESS_EXPIRES_IN_MINUTES` | No | `15` | Access token lifetime in minutes |
| `JWT_DEV_SECRET` | Yes | — | Secret for developer-account session tokens (Swagger/CLI management). Generate like the other JWT secrets. |
| `JWT_ROOM_SECRET` | Yes | — | Secret signing ephemeral room tokens for `/v1` API participants. Must differ from all other secrets. |
| `ROOM_TOKEN_TTL_MINUTES` | No | `60` | Lifetime of minted room tokens. |

### Client

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_BASE_URL` | No | `""` (empty) | API base URL baked into the client build. Leave empty when Caddy proxies everything (same origin). |
| `VITE_SOCKET_URL` | No | `""` (empty) | Socket.io URL. Leave empty for same-origin. |

> These are build-time variables — they are injected during `docker compose build`. Changing them requires rebuilding the `client` service.

### mediasoup / WebRTC Media

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEDIASOUP_LISTEN_IP` | No | `0.0.0.0` | IP to bind RTC transport sockets. `0.0.0.0` is correct for Docker. |
| `MEDIASOUP_ANNOUNCED_IP` | **Yes** | `127.0.0.1` | **Your server's public IP address**. Remote clients use this IP to send/receive media. Must be set to the server's public IP for calls to work. |
| `RTC_MIN_PORT` | No | `40000` | Start of the UDP/TCP port range for RTC media |
| `RTC_MAX_PORT` | No | `40499` | End of the RTC port range. 500 ports supports ~250 simultaneous transports (each peer uses 2). |
| `MEDIASOUP_WORKERS` | No | cores - 1 | mediasoup Worker subprocess count. One worker uses one core; lower it to reserve cores for egress on small hosts. |

**Important**: If `MEDIASOUP_ANNOUNCED_IP` is wrong, video/audio will not work for remote participants. Set it to the server's public IPv4 address. For local Docker testing, use your machine's LAN IP (not `127.0.0.1`, unless testing on the same machine).

### TURN / coturn

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TURN_AUTH_SECRET` | **Yes** | - | Shared secret for ephemeral TURN credentials (coturn `use-auth-secret`). Generate with `openssl rand -base64 32`. Must be identical on the server and coturn containers. |
| `TURN_EXTERNAL_IP` | **Yes** | — | **Server's public IP address** (same as `MEDIASOUP_ANNOUNCED_IP`). coturn uses this to rewrite relay candidates. |
| `TURN_URL` | Yes | — | TURN server URL for clients. Format: `turn:YOUR_SERVER_IP:3478` |
| `TURNS_URL` | No | — | TURNS (TLS) server URL. Format: `turns:YOUR_SERVER_IP:5349` |

> coturn runs in `network_mode: host` to avoid NAT hairpin issues. Its listening ports (3478, 5349) and relay ports (49152–49252) are bound directly to the host.
>
> TURN credentials are never exposed in client source code: the server mints a fresh ephemeral username (`<unix-expiry>:zvonok`, 6h TTL) and password (`base64(HMAC-SHA1(secret, username))`) per transport and sends them via the `sfu:transport-created` WebSocket event. coturn verifies them against the shared secret with `use-auth-secret`.

### coturn auth switch and cutover

coturn runs `use-auth-secret` (ephemeral REST credentials, draft-uberti-rtcweb-turn-rest) instead of static long-term credentials (`lt-cred-mech`). The shared secret is passed to the coturn container as a CLI argument (`--static-auth-secret=$TURN_AUTH_SECRET`) because coturn does not interpolate environment variables in conf files; `turnserver.conf` never contains the real secret.

Upgrading an existing deployment is a single cutover (old static and new REST auth cannot mix):

1. Generate a secret: `openssl rand -base64 32`
2. Set `TURN_AUTH_SECRET` on the server container
3. Add `--static-auth-secret=$TURN_AUTH_SECRET` to the coturn container command, replacing the old `--user=...` argument
4. Restart both containers; clients reconnect and receive ephemeral credentials on their next transport creation

## Example `.env` for Production

```env
# Domain
SITE_ADDRESS=chat.example.com
CLIENT_URL=https://chat.example.com

# Database
POSTGRES_USER=zvonok_admin
POSTGRES_PASSWORD=super-secret-db-password-here
POSTGRES_DB=zvonok

# JWT (generate both with: openssl rand -hex 64)
JWT_ACCESS_SECRET=a1b2c3d4...
JWT_REFRESH_SECRET=e5f6g7h8...

# Developer platform (generate with: openssl rand -hex 64; must differ from the other secrets)
JWT_DEV_SECRET=h9i0j1k2...
JWT_ROOM_SECRET=l3m4n5o6...
ROOM_TOKEN_TTL_MINUTES=60

# Client (leave empty for same-origin behind Caddy)
VITE_API_BASE_URL=
VITE_SOCKET_URL=

# mediasoup
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=203.0.113.42
RTC_MIN_PORT=40000
RTC_MAX_PORT=40499

# TURN (coturn; generate TURN_AUTH_SECRET with: openssl rand -base64 32)
TURN_AUTH_SECRET=super-secret-turn-auth-secret-here
TURN_EXTERNAL_IP=203.0.113.42
TURN_URL=turn:203.0.113.42:3478
TURNS_URL=turns:203.0.113.42:5349
```

## Caddy Routing

Routing is defined in three files in the repo root:

| File | Used by | Purpose |
|------|---------|---------|
| `Caddyfile.routes` | both | The actual routing: API proxies, static SPA fallback, security headers, logging |
| `Caddyfile` | `docker-compose.yml` (dev/standalone) | Adds TLS and HTTP→HTTPS redirect around the routes |
| `Caddyfile.traefik` | `docker-compose.prod.yml` (prod) | Serves the routes on plain `:80` behind the Traefik gateway |

The routes:

- `/auth/*`, `/users/*`, `/rooms`, `/rooms/*`, `/version` → reverse proxy to `server:3000`
- `/swagger*` → not proxied in production (dev only, via SSH port-forward)
- `/v1/*`, `/developers/*` → reverse proxy to `server:3000` (public platform API; `/developers/*` is safe to expose - dev-JWT authenticated, `/v1` is API-key authenticated)
- `/egress/*` → reverse proxy to `server:3000` (HLS playback: playlist and segments)
- `/socket.io/*` → reverse proxy to `server:3000` (WebSocket + polling)
- Everything else → `try_files` for static SPA with `index.html` fallback

All API routes proxy to the env-driven upstream `{$SERVER_UPSTREAM:server:3000}`: `server:3000` (container DNS) in dev, `host.docker.internal:3000` in production where the server runs in host network mode.

**Note**: Caddy's `handle /rooms/*` does NOT match the bare `/rooms` path. That's why there are separate `handle /rooms` and `handle /rooms/*` blocks.

## Developer Platform API

The server exposes a versioned public API for third-party consumers, authenticated with API keys (`Authorization: Bearer zk_live_...`):

| Endpoint | Description |
|----------|-------------|
| `POST /v1/rooms` | Create a room owned by the key's project |
| `GET /v1/rooms` | List the project's rooms |
| `DELETE /v1/rooms/:id` | End a project room (disconnects participants) |
| `POST /v1/rooms/:id/tokens` | Mint a short-lived room token (participant identity + publish/admin permissions) |

Room tokens are consumed by the `/sfu` Socket.IO namespace (`sfu:join` with a `token` field); identity and permissions come from the verified token, not the client payload. Developer accounts, projects, and keys are managed via the `/developers/*` endpoints (see `/swagger`) or seeded with `DEV_SEED_USERNAME` / `DEV_SEED_PASSWORD` / `DEV_SEED_PROJECT` env vars through the seed script. The Caddy routes proxy `/v1/*` and `/developers/*` alongside the existing API paths.

### Custom Domain with Automatic HTTPS

**Production:** TLS is handled by the Traefik gateway — make sure the DNS A record points to the server and ports 80/443 are open; the certificate is issued automatically (TLS-ALPN challenge).

**Standalone/dev:** set `SITE_ADDRESS=your-domain.com` in `.env`. Caddy will automatically obtain a Let's Encrypt certificate itself. Make sure:

1. DNS A record points to your server's IP
2. Ports 80 and 443 are open (Caddy needs port 80 for the ACME HTTP challenge)

### Localhost with Self-Signed TLS

The default `SITE_ADDRESS=localhost` makes Caddy use a self-signed certificate. Browsers will show a security warning — click through to proceed.

## Operations

### Viewing Logs

```bash
# All services
make logs

# Specific service
docker compose logs -f server    # or caddy, postgres, coturn
```

### Rebuilding After Code Changes

```bash
# Rebuild everything
make deploy-local

# Rebuild only the server
docker compose up -d --build --no-deps server

# Rebuild only the client (e.g., after changing VITE_* vars)
# This also restarts Caddy to pick up new static files
docker compose up -d --build --no-deps caddy
```

### Reloading Caddy Config

If you edit `Caddyfile` (it's bind-mounted), reload without restarting:

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### Database Operations

```bash
# Run migrations manually (the migrate service already runs on startup)
make migrate

# Access PostgreSQL shell
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB

# Back up the database
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB
```

### Scaling and Port Range

The default 500-port range (40000–40499) supports approximately 250
concurrent participants (each participant uses a send + receive transport,
each transport uses one port). To support more:

1. Increase `RTC_MAX_PORT` in `.env` (e.g., `40999` for ~500 participants);
   the range must stay disjoint from `EGRESS_MEDIA_PORT_MIN/MAX`
2. Open the additional ports on your firewall
3. Rebuild: `docker compose up -d --build --no-deps server`

### Worker Pool and Instance Boundary

The server runs a pool of mediasoup Workers - one per CPU core by default
(override with `MEDIASOUP_WORKERS`) - so media forwarding uses all cores.
Room state (presence, chat delivery, egress pipelines) is process-local:
run exactly one server instance per deployment. Scaling beyond one machine
means sharding whole deployments per region/site, not load-balancing
instances behind one hostname.

### Stopping

```bash
# Stop all services (preserves data volumes)
docker compose down

# Stop and remove data volumes (destructive — deletes database!)
docker compose down -v
```

## Monitoring

The VPS runs a self-hosted observability stack (separate compose project in
`~/monitoring`, files versioned in `infra/monitoring/`): Prometheus + Grafana,
node_exporter, postgres_exporter, Uptime Kuma (site checks + Docker
container monitors), and GlitchTip. It monitors the whole host, including
other sites behind the shared Traefik gateway (compose versioned in
`infra/gateway/`). Full runbook: `infra/monitoring/README.md`. Note: no
cAdvisor - Docker 28 on this host uses the containerd snapshotter, which
cAdvisor cannot read; per-container liveness comes from Kuma's Docker
monitors instead.

```
Prometheus (host net) --scrapes--> 127.0.0.1:{3000 app /metrics, 9100 node,
    9187 postgres, 8082 traefik}
grafana.yurifa.site   <- Grafana dashboards + alerts (Telegram)
status.yurifa.site    <- Uptime Kuma: site checks + Docker container
                         monitors (with an external UptimeRobot pinger)
errors.yurifa.site    <- GlitchTip (server error reporting via SENTRY_DSN)
```

App metrics (`GET /metrics` on the server, internal-only - no public route):
`zvonok_sfu_active_rooms` (live routers), `zvonok_sfu_connected_peers`,
`zvonok_sfu_open_transports`, plus default Node.js process metrics.

One-time setup (swap file, gateway Traefik-metrics edit, DB roles, DNS,
deploy) is walked through in `infra/monitoring/README.md`.
Keep Prometheus (`9090`) off the public internet: if ufw is active, allow it
only from Docker subnets, same as port 3000.

## Updating

To update the application after pulling new code:

```bash
# Pull latest changes
git pull

# Rebuild and restart (migrations run automatically)
make deploy-local    # docker compose up -d --build

# Verify all services restarted correctly
make status

# Check logs for any errors
make logs
```

For partial updates:

```bash
# Server-only update (no client rebuild)
docker compose up -d --build --no-deps server

# Client-only update (rebuilds static files + restarts Caddy)
docker compose up -d --build --no-deps caddy
```

> Database migrations run automatically via the `migrate` init container on every `docker compose up`. No manual migration step is needed.

## Firewall Rules

See [Step 2: Server Firewall](#step-2-server-firewall) for the full `ufw` commands.

## Troubleshooting

### Video/audio not working for remote participants

1. Verify `MEDIASOUP_ANNOUNCED_IP` is set to the server's **public IP** (not `0.0.0.0` or `127.0.0.1`)
2. Check that ports 40000–40499 (UDP+TCP) are open on the firewall
3. Run `docker compose logs server | grep -i mediasoup` to check for errors
4. Ensure the client can reach the server's public IP on the RTC port range

### TURN not working

1. Verify coturn is running: `docker compose ps coturn` (should show "Up")
2. Check coturn logs: `docker compose logs coturn`
3. Verify `TURN_EXTERNAL_IP` matches the server's **public IP**
4. Ensure ports 3478, 5349 (UDP+TCP) and 49152–49252 (UDP) are open
5. Test TURN with [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/):
   - STUN/TURN URI: `turn:YOUR_SERVER_IP:3478`
   - Username: the ephemeral `<unix-expiry>:zvonok` value the server minted (grab both fields from a `sfu:transport-created` socket payload)
   - Credential: the matching `base64(HMAC-SHA1(secret, username))` value from the same payload
   - You should see `relay` candidates in the results
6. If coturn logs show `error 401`, the secret coturn runs with does not match the server's `TURN_AUTH_SECRET`: verify both containers use the same `--static-auth-secret` value

### 405 Method Not Allowed on POST /rooms

- Ensure the `Caddyfile` has both `handle /rooms` (exact) and `handle /rooms/*` (wildcard) blocks
- Reload Caddy (see [Reloading Caddy Config](#reloading-caddy-config))

### Client shows blank page

- Check that static files are baked into the Caddy image: `docker compose exec caddy ls /srv/client/index.html`
- Check browser console for errors (mismatched `VITE_API_BASE_URL` or CORS issues)

### Database connection errors

- Ensure `postgres` is healthy: `docker compose ps postgres`
- Check that `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` match between services
- The `migrate` service must complete before `server` starts (handled by `depends_on` conditions)
- Check migrate logs: `docker compose logs migrate`

### Caddy not getting Let's Encrypt certificate

- **Production:** TLS certificates are managed by the Traefik gateway (`docker logs traefik`), not Caddy — check the gateway first
- Ensure DNS A record exists and propagated: `dig +short your-domain.com`
- Port 80 **must** be open for the ACME HTTP-01 challenge (dev/standalone mode)
- Check Caddy logs: `docker compose logs caddy`
- If behind a load balancer, ensure the LB forwards port 80 to the server

### Redirect loop (too many redirects) behind Traefik

- The prod stack must use `Caddyfile.traefik` (plain HTTP, no redirects) — check the `caddy` service volumes in `docker-compose.prod.yml`
- The dev `Caddyfile` redirects HTTP→HTTPS, which loops forever behind a TLS-terminating proxy

### Services keep restarting

- Check logs for the crashing service: `docker compose logs <service>`
- Common causes: missing env vars, wrong `MEDIASOUP_ANNOUNCED_IP`, database not ready
- Verify `.env` has no typos or missing required values

## Publishing the SDK packages

The public SDK surface ships as two npm packages: `@zvonok/client`
(framework-free core) and `@zvonok/react` (headless React bindings). Both live
in `packages/` and are published manually - there is no CI release pipeline.

Prerequisites (one-time):

- Own the `@zvonok` organization on npm.com
- `npm login` on the publishing machine (verify with `npm whoami`)

Release flow per package:

```bash
# 1. Bump the version (independently per package)
pnpm -C packages/client exec npm version patch   # or minor / major

# 2. Build and inspect the tarball BEFORE publishing
pnpm -C packages/client build
pnpm -C packages/client pack
tar -tzf zvonok-client-*.tgz   # must contain dist/ only, plus README/LICENSE

# 3. Publish from inside the package directory; answer y at the
#    publish-branch prompt. Do NOT use `pnpm -C <pkg> publish`: on pnpm 10
#    the -C path leaks into the npm delegation as an extra positional
#    argument and npm aborts with EUSAGE. Pack artifacts (*.tgz) are
#    gitignored, so the git-clean check passes without --no-git-checks
#    (that flag also reaches npm and is rejected there).
cd packages/client && pnpm publish --access public
```

Repeat for `packages/react`. Note that plain `npm publish` will NOT apply
`publishConfig` - always publish with pnpm. After publishing, smoke-test the
tarball from a clean directory: `npm i @zvonok/react`, then follow
`docs/quickstart.md` against the production server.

Versioning: semver per package; keep the two in lockstep while the React
binding remains 0.x.
