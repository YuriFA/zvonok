# Agent Operating Guide

pnpm monorepo for a WebRTC video platform with a developer platform on top: `/v1` REST API, TypeScript SDKs (`@zvonok/client`, `@zvonok/react`), egress/recording, webhooks, whiteboard. Mediasoup SFU for all calls; no P2P path.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | NestJS v11 + PostgreSQL 16 + Prisma + Passport.js (JWT) |
| Frontend | React 19 + Vite 7 + Tailwind CSS v4 + React Router v7 + Base UI |
| WebRTC | Socket.io signalling + native WebRTC API + mediasoup SFU |

## Non-Negotiables

- **Package manager:** `pnpm` only — no npm/yarn
- **Spec-driven:** `openspec/specs/` is the source of truth; behavior changes go through OpenSpec change proposals (see Spec-Driven Workflow)
- **No undocumented work:** architectural/breaking changes require an approved change in `openspec/changes/` before implementation
- **Surgical edits:** touch only what you must; no unrelated refactors
- **No barrel files:** no `index.ts` re-export barrels; import from source
- **No server management:** don't start/stop dev servers or DB; ask user if needed

## Commands

All commands live in README "[Available Commands](README.md#available-commands)" — production make targets plus root, server, client, and packages tables, including single-test invocation examples. Prefer `pnpm -C <dir> <script>` over `cd`.

## Code Style

### General

- TypeScript everywhere; explicit types at module boundaries
- Keep code small; avoid "flexible" abstractions
- **SOLID principles:**
  - **S**ingle Responsibility — one thing per module/function
  - **O**pen/Closed — extend via composition, not modification
  - **L**iskov Substitution — subtypes usable as base types
  - **I**nterface Segregation — small, focused interfaces
  - **D**ependency Inversion — depend on abstractions; NestJS DI (server), context/hooks (client)
- Remove unused imports/vars from your changes
- No secrets in commits (`.env*`, credentials, tokens)

### Imports

- Order: built-ins → external → app absolute (`src/...` / `@/...`) → relative
- Prefer type-only: `import type { X } from '...';`
- Server: `src/...` path mapping; client: `@/*` alias

### Formatting

- Server: Prettier (single quotes, trailing commas)
- Client: match existing file style

### TypeScript / Linting

- Server: type-checked ESLint; `any` allowed; unsafe warned
- Client: strict with `noUnusedLocals`/`noUnusedParameters`

### Types + Naming

- Classes/providers/controllers: `PascalCase`
- Functions/variables: `camelCase`
- React components: `PascalCase`
- Files: server `*.service.ts`, `*.controller.ts`; client kebab-case
- Prefer `type` for unions/aliases; `interface` for object shapes

### Error Handling

- Server: throw NestJS exceptions (`BadRequestException`, `UnauthorizedException`, etc.); never `throw new Error`
- Server: never return sensitive fields (password hashes, refresh token hashes)
- Client: use typed errors from `apps/client/src/lib/api/api.errors.ts`
- Client: avoid `console.error` unless existing code does it

### Boundaries

- Auth logic in `apps/server/src/auth/` (not `user/`)
- Client UI primitives in `apps/client/src/components/ui/`
- Client features in `apps/client/src/features/`

### Testing

- Server: colocated `*.spec.ts`; e2e in `apps/server/test/`
- Client: Vitest; tests under `__tests__/`; jsdom environment
- Update tests for happy path + edge cases + errors

## Architecture

**Source of truth:** `openspec/specs/` - current behavior per domain. See Spec-Driven Workflow below.

```
apps/
├── server/
│   ├── prisma/schema.prisma      # DB schema
│   ├── src/
│   │   ├── auth/                 # AuthModule (helpers, strategies)
│   │   ├── user/                 # UserModule
│   │   ├── room/                 # RoomModule (cleanup, guests)
│   │   ├── chat/                 # ChatModule (messages, guest auth)
│   │   ├── sfu/                  # mediasoup SFU
│   │   ├── egress/               # RTMP/HLS streaming, recordings
│   │   ├── platform/             # Developer platform: /v1 API
│   │   ├── developer/            # Developer accounts, projects, API keys
│   │   ├── webhooks/             # Signed webhook delivery
│   │   ├── whiteboard/           # Shared collaborative canvas
│   │   └── main.ts
└── client/src/
    ├── routes/                   # Pages
    ├── components/ui/            # UI primitives
    ├── features/                 # Feature modules
    ├── hooks/                    # Shared hooks
    ├── lib/                      # Framework-agnostic core
    └── main.tsx
packages/
├── client/                       # @zvonok/client — headless SFU/room SDK
├── react/                        # @zvonok/react — React bindings + host controls
└── video-layout/                 # @zvonok/video-layout — composited layout engine
```

## API Conventions

- **REST:** `/resource` pattern (`/auth/register`, `/rooms`)
- **WebSocket:** `namespace:action` (`join:room`, `webrtc:offer`)
- **JWT:** HTTP-only cookies
- **Errors:** NestJS exceptions

## Environment Variables

- Server env: `apps/server/.env.example` → `.env.development`
- Client env: `apps/client/.env.example` → `.env.local`
- Production: root `.env` from `.env.production.example` (see `docs/deployment.md`)

The environment is the source of truth for the full variable list. Gotchas:
- Production: `MEDIASOUP_ANNOUNCED_IP` must be the server's public IP, or media does not flow.
- Dev: mediasoup listens on `127.0.0.1`, so video/audio works only same-machine.

**Source of truth:** `openspec/specs/` describes current implemented behavior per domain. `openspec/changes/` holds in-flight deltas.


Commands (harness skills are installed locally with `openspec update`):

- `/opsx-explore` - map an unfamiliar area before proposing
- `/opsx-propose` - create a change: proposal.md + delta specs + tasks
- `/opsx-apply` - implement the change tasks
- `/opsx-archive` - merge the delta into specs, move to `openspec/changes/archive/`
- `pnpm openspec:validate` - validate all specs and changes (lefthook runs this on pre-commit when `openspec/**` is staged)

**Change proposal is mandatory for:**

- New capability, module, or page
- Breaking/architectural change: Prisma schema migration, REST/WebSocket contract change, event rename, auth flow change
- Cross-module behavior change

**Direct implementation (no proposal) is fine for:**

- Bug fixes that restore already-specified behavior
- Internal refactors with no contract change, style fixes, dependency bumps

Hard-to-reverse process/architecture decisions get an ADR in `docs/adr/`.

## Documentation

| File | Purpose |
|------|---------|
| `openspec/specs/` | Source of truth: current behavior per domain |
| `openspec/changes/` | In-flight and archived change proposals |
| `docs/adr/` | Architecture decision records |

## Before Implementation

1. Read the relevant domain spec in `openspec/specs/<domain>/`
2. If the change is proposal-mandatory (see workflow above), run `/opsx-propose` and get the proposal approved before touching code
3. State assumptions; if uncertain, ask
4. If simpler approach exists, say so

## During Implementation

- No features beyond request
- No abstractions for single-use code
- No "flexibility" not requested
- Follow SOLID principles
- Follow existing patterns
- If architecture changes -> proposal first, code second

## After Implementation

- Archive the change (`/opsx-archive`) so specs absorb the delta; specs must never lag behind code
- Use Conventional Commits for commit messages (for example: `feat: add room creation validation`)

## Security

- Passwords: bcrypt
- JWT secrets: environment variables
- Refresh tokens: hashed in DB
- Token validation: timing-safe comparison
- API responses: no sensitive data

## Troubleshooting

**WebSocket:**
1. Check CORS in gateway
2. Verify `withCredentials: true` on client
3. Check firewall/proxy

**WebRTC:**
1. Verify STUN servers accessible
2. Check browser console for ICE candidates
3. Ensure camera/mic permissions

## Git Conventions

- Commits: Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`)
- Atomic commits
- Spec updates land via `/opsx-archive` together with the change they belong to
