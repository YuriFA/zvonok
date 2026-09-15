# ZvonOK - WebRTC Video Conferencing Platform

A modern WebRTC video chat platform built as a pnpm monorepo with NestJS backend and React frontend. Group video calls via mediasoup SFU, plus a developer platform on top: REST API, TypeScript SDKs, live streaming egress, and recordings.

## Features

- **Group Video Calls** — mediasoup SFU for multi-participant rooms, ephemeral TURN credentials via coturn
- **Developer Platform** — `/v1` REST API (rooms, tokens, egress, recordings) with API-key auth and per-key rate limits
- **TypeScript SDKs** — `@zvonok/client` and `@zvonok/react` on npm (sources in `packages/`); `@zvonok/video-layout` is the app's internal layout engine
- **Live Streaming Egress** — push the composited room program to RTMP endpoints or serve it as HLS; server-side recording with Range-supported downloads
- **Webhooks** — signed `room.*` and `egress.*` events with delivery retries
- **Whiteboard** — shared collaborative canvas in rooms
- **Prebuilt Widget** — drop-in room UI component on top of the React SDK
- **Docs Site** — static documentation site served on the VPS
- **Secure Authentication** — JWT with refresh token rotation and reuse detection
- **Production-Ready** — Docker Compose + Caddy, shared Traefik gateway on the VPS (multi-site, automatic HTTPS)

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS v11, PostgreSQL 16, Prisma ORM, Passport.js (JWT), mediasoup |
| Frontend | React 19, Vite 7, Tailwind CSS v4, React Router v7, Base UI, mediasoup-client |
| Signalling | Socket.io |
| Media | mediasoup SFU, FFmpeg (egress pipelines), coturn (TURN) |
| Deployment | Docker Compose, Caddy + shared Traefik gateway in production (multi-site VPS) |

## Prerequisites

- **Node.js** 22+
- **pnpm** (this project uses pnpm only — no npm/yarn)
- **Docker** and **Docker Compose**

## Development Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Server env is ready out of the box at `apps/server/.env.development`.
Client env is at `apps/client/.env.local`.

If missing, create from examples:

```bash
cp apps/server/.env.example apps/server/.env.development
cp apps/client/.env.example apps/client/.env.local
```

Edit `apps/client/.env.local`:

```env
VITE_API_BASE_URL="http://localhost:3000"
VITE_SOCKET_URL="http://localhost:3000"
```

### 3. Start database

```bash
pnpm -C apps/server db:dev
```

This starts PostgreSQL (port 5432) and pgAdmin (port 5050) via Docker.

### 4. Run migrations

```bash
pnpm -C apps/server migrate:dev
```

### 5. Start dev servers

```bash
pnpm dev
```

- **Server**: http://localhost:3000 (Swagger: http://localhost:3000/swagger)
- **Client**: http://localhost:5173

In dev mode, mediasoup listens on `127.0.0.1` (default without env vars) — video/audio works only on the same machine.

## Production Deployment (Docker)

See **[docs/deployment.md](docs/deployment.md)** for the full production setup guide.

Quick version:

```bash
make setup          # create .env from template
$EDITOR .env        # edit with real secrets and your domain/IP
make deploy-local    # build and start all services on this machine
```

This starts 5 services: PostgreSQL, migrations, NestJS server, Caddy (with baked-in client assets), and coturn TURN.

Open: `https://localhost` (self-signed) or `https://your-domain.com` (Let's Encrypt).

Run `make help` to see all available targets.

## Project Structure

```
zvonok/
├── apps/
│   ├── server/             # NestJS backend (port 3000)
│   │   ├── prisma/         # Database schema and migrations
│   │   └── src/
│   │       ├── auth/       # Authentication (JWT, Passport)
│   │       ├── user/       # User CRUD
│   │       ├── room/       # Room management
│   │       ├── chat/       # Room chat
│   │       ├── sfu/        # mediasoup SFU (WebSocket gateway)
│   │       ├── egress/     # RTMP/HLS streaming + server-side recordings
│   │       ├── platform/   # Developer platform: /v1 API, API keys, DTOs
│   │       ├── developer/  # Developer accounts, projects, API keys
│   │       ├── webhooks/   # Signed webhook delivery with retries
│   │       └── whiteboard/ # Shared collaborative canvas
│   └── client/             # React frontend (port 5173)
│       └── src/
│           ├── features/   # Feature modules
│           ├── components/ # Shared UI components
│           ├── hooks/      # Shared hooks
│           └── lib/        # API client, SFU manager, utilities
├── packages/
│   ├── client/             # @zvonok/client — headless SFU/room SDK
│   ├── react/              # @zvonok/react — React bindings + host controls
│   └── video-layout/       # @zvonok/video-layout — composited layout engine
├── docs/                   # Architecture, quickstart, domain docs, ADRs
├── docker-compose.yml      # Production full-stack deployment
├── Makefile                # Production Docker orchestration (make help)
├── Caddyfile               # Caddy config (dev/standalone; imports Caddyfile.routes)
├── Caddyfile.traefik       # Caddy config for prod behind the Traefik gateway
└── .env.production.example # Production env template
```

## Available Commands

### Production (Makefile)

| Command | Description |
|---------|-------------|
| `make help` | Show all available targets |
| `make setup` | Create `.env` from template |
| `make deploy` | Workstation deploy: build amd64 images, push to GHCR, deploy to the VPS (mirrors `deploy.yml`, no GitHub Actions) |
| `make rollback TAG=` | Redeploy a pushed version (`v2026.09.14` deploy tag or `sha-<short>`) |
| `make deploy-local` | Build images and start all services on this machine (local stack) |
| `make down` | Stop all services |
| `make migrate` | Run database migrations |
| `make logs` | Follow logs for all services |
| `make status` | Show local stack status and health |

### Root

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run client + server in development |
| `pnpm test` | Run tests in all workspaces |
| `pnpm test:client` | Client unit tests (CI mode) |
| `pnpm test:server` | Server unit tests |
| `pnpm clean` | Clean caches |

### Server (`apps/server/`)

| Command | Description |
|---------|-------------|
| `pnpm -C apps/server dev` | Development mode with watch |
| `pnpm -C apps/server build` | Compile TypeScript |
| `pnpm -C apps/server lint` | ESLint |
| `pnpm -C apps/server test` | Unit tests |
| `pnpm -C apps/server test:e2e` | E2E tests |
| `pnpm -C apps/server migrate:dev` | Apply Prisma migrations |
| `pnpm -C apps/server db:dev` | Start dev database (Docker) |

### Client (`apps/client/`)

| Command | Description |
|---------|-------------|
| `pnpm -C apps/client dev` | Vite dev server |
| `pnpm -C apps/client build` | Production build |
| `pnpm -C apps/client lint` | ESLint |
| `pnpm -C apps/client test:run` | Unit tests (CI mode) |
| `pnpm -C apps/client test:e2e` | Playwright E2E tests |

### SDK Packages (`packages/`)

| Command | Description |
|---------|-------------|
| `pnpm -C packages/client build` | Build `@zvonok/client` |
| `pnpm -C packages/react build` | Build `@zvonok/react` |
| `pnpm -C packages/video-layout build` | Build `@zvonok/video-layout` |
| `pnpm -C packages/<pkg> test:run` | Run package unit tests (client, react) |
| `pnpm -C packages/<pkg> lint:ts` | Type-check a package (client, react) |

## Documentation

- **[Quickstart](docs/quickstart.md)** — integrate the SDK into an external app
- **[Platform Roadmap](docs/platform-roadmap.md)** — platform direction, stages, checkpoint
- **[Egress](docs/egress.md)** — HLS/RTMP streaming and server-side recordings
- **[Whiteboard](docs/whiteboard.md)** — shared collaborative canvas
- **[Deployment Guide](docs/deployment.md)** — Production Docker setup
- **[ADRs](docs/adr/)** — architecture decision records
- **[OpenSpec Specs](openspec/specs/)** — source of truth: current behavior per domain

## License

MIT
