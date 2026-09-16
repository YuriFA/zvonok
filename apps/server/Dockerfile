# ── Shared base ──────────────────────────────────────────────────────────────
# Single layer enables corepack once; all stages inherit it via FROM base.
FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

# ── Stage 0: Native build tools ──────────────────────────────────────────────
# mediasoup picks a prebuilt worker by the BUILD machine's kernel major
# (os.release()); when no prebuilt matches (e.g. Docker Desktop VM on kernel 7
# while releases publish kernel 6) it falls back to a source build that needs
# python3/pip and a C++ toolchain. Only build stages inherit these; runtime
# images stay on the slim base.
FROM base AS buildtools

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip make g++ && \
    rm -rf /var/lib/apt/lists/*

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Installs all deps (dev + prod), generates Prisma client, compiles NestJS,
# then uses pnpm deploy to create a self-contained production node_modules
# with only prod deps — no symlinks, no .pnpm store, compiled native addons intact.
FROM buildtools AS builder

WORKDIR /app

# Copy workspace manifests first so pnpm install is cached independently of source changes
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/

# Install all dependencies.
# onlyBuiltDependencies in root package.json controls which postinstall scripts run.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy server source files
COPY apps/server ./apps/server

# Generate Prisma client, build NestJS, then create a self-contained production
# deployment with pnpm deploy — no symlinks, no .pnpm store, clean node_modules.
ENV CI=true

RUN pnpm -C apps/server exec prisma generate && \
    pnpm -C apps/server build && \
    pnpm deploy --filter=server --prod --legacy /app/deploy

# ── Stage 2: Migrations runner ────────────────────────────────────────────────
# Has prisma CLI + ts-node for prisma.config.ts; also seeds the DB.
FROM buildtools AS migrator

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/

# Install all dependencies.
# Do NOT use --ignore-scripts: bcrypt requires its postinstall to compile the native addon.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy Prisma schema, config, migrations, and seed.
# seed.ts imports src/developer/api-key.helper.ts (self-contained: node:crypto
# only) and the generated Prisma client - both must exist in the image.
COPY apps/server/prisma ./apps/server/prisma
COPY apps/server/prisma.config.ts ./apps/server/prisma.config.ts
COPY apps/server/tsconfig.json ./apps/server/tsconfig.json
COPY apps/server/src/developer/api-key.helper.ts ./apps/server/src/developer/api-key.helper.ts

WORKDIR /app/apps/server

RUN pnpm exec prisma generate

COPY apps/server/prisma/entrypoint.sh ./prisma/entrypoint.sh
RUN chmod +x ./prisma/entrypoint.sh

CMD ["./prisma/entrypoint.sh"]

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM base AS production

# Install dumb-init for correct signal propagation
RUN apt-get update && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy self-contained production node_modules from pnpm deploy output.
# No symlinks, no .pnpm store — safe to COPY directly.
COPY --from=builder /app/deploy/node_modules ./apps/server/node_modules

# Expose mediasoup worker at a stable, fixed path.
# Using a symlink avoids duplicating the binary already present in node_modules.
# The guard (`test -n`) makes the build fail loudly if the binary is not found.
RUN WORKER=$(find /app/apps/server/node_modules -name 'mediasoup-worker' \
        -path '*/worker/out/Release/mediasoup-worker' | head -1) && \
    { test -n "$WORKER" || { echo "ERROR: mediasoup-worker binary not found in builder" >&2; exit 1; }; } && \
    ln -s "$WORKER" /app/mediasoup-worker

# Copy Prisma schema and generated client from builder
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/apps/server/src/generated ./apps/server/src/generated

# Copy built application from builder
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Copy package.json so version.ts can read it at runtime (process.cwd() = /app/apps/server)
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

ENV MEDIASOUP_WORKER_BIN=/app/mediasoup-worker
ENV NODE_ENV=production

# Drop privileges: node user (uid 1000) ships with node:24-slim.
# chown runs as root before USER; all subsequent commands run as node.
RUN chown -R node:node /app
USER node

WORKDIR /app/apps/server

# Expose HTTP + RTC ports
EXPOSE 3000
EXPOSE 40000-40099/udp
EXPOSE 40000-40099/tcp

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main.js"]

# ── Stage 4: Development image ────────────────────────────────────────────────
# For local dev with hot reload — not used in production CI.
FROM buildtools AS development

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/

# Install all dependencies (dev + prod)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source files
COPY apps/server ./apps/server

WORKDIR /app/apps/server

ENV NODE_ENV=development

EXPOSE 3000

CMD ["pnpm", "dev"]
