# Manual Deploy Research: workstation-initiated VPS deploys without GitHub Actions

> **Date:** 2026-09-15
> **Question:** how do real open-source projects and first-party tools deploy to a VPS
> from a developer workstation without GitHub Actions, so zvonok keeps deploying when
> Actions minutes run out or Actions is otherwise unavailable - and which pattern fits
> this repo (Apple Silicon workstation, amd64 VPS, GHCR-based compose stack)?
> **Method:** primary sources only - official Docker and GitHub docs, kamal-deploy.org,
> and real repositories read directly (Makefiles, launcher scripts, deploy tooling),
> linked per claim; repo facts verified in `.github/workflows/deploy.yml`,
> `docker-compose.prod.yml`, `Makefile`, and the three image Dockerfiles; the user's
> reference implementation was read locally at `~/web/expense-tracker`.
> **Scope:** the deploy must survive Actions being unavailable; GitHub itself (git, GHCR)
> may remain a dependency. Patterns that drop GitHub entirely are covered for comparison.

## Why this question exists (billing facts)

- Actions minutes are consumed **while a workflow runs**: "If you run a workflow on a
  Linux runner and it takes 10 minutes to complete, you'll use 10 minutes." A `docker
  push` from the workstation or a `docker pull` on the VPS runs no workflow, so it
  consumes zero Actions minutes.
  Source: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- Included minutes for private repos: Free 2,000/month, Pro 3,000, Team 3,000,
  Enterprise Cloud 50,000; usage is free in public repositories; "If your account does
  not have a valid payment method on file, usage is blocked once you use up your quota."
  Same source. The current zvonok workflow runs on `ubuntu-latest` for all four jobs
  (`.github/workflows/deploy.yml:20,92,138,184`), so an exhausted quota blocks deploys.
- GHCR storage and bandwidth are currently free: "Container image storage and bandwidth
  for the Container registry is currently free" (GitHub promises one month notice before
  changing this). Source: [Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages).
- Conclusion: moving the build/push off Actions to the workstation costs nothing in
  minutes and keeps GHCR as a free image store. GHCR pushes/pulls are also available
  when Actions is not.

## Current zvonok deploy path (Actions only today)

- Trigger: `workflow_dispatch` only (`.github/workflows/deploy.yml:4`), with a
  `deploy-production` concurrency group (lines 6-8).
- Four images built on GitHub-hosted runners and pushed to GHCR, tagged
  `sha-<short>` + `latest`: server (target `production`, lines 56-67), migrator
  (target `migrator` from the same `apps/server/Dockerfile`, lines 78-88), caddy
  (from `apps/client/Dockerfile`, lines 125-134), docs (from
  `apps/docs/Dockerfile.docs`, lines 171-180).
- Deploy job: scp `docker-compose.prod.yml,Caddyfile.traefik,Caddyfile.routes,
  turnserver.conf` to `~/zvonOK` on the VPS (lines 194-201), then over SSH: create the
  shared `web` network, `docker login ghcr.io` with a PAT, pull with
  `IMAGE_TAG=sha-<short>`, `up -d --remove-orphans`, then prune old images **locally on
  the VPS** (lines 216-236). GHCR keeps every `sha-<short>` tag; the workflow never
  deletes packages.
- The VPS pull path already works without Actions: the compose file only needs
  `GHCR_REPO`, `IMAGE_TAG`, and a `ghcr.io` login
  (`docker-compose.prod.yml:9-12`; image references at lines 17, 29, 119, 159 default
  to `:latest`). The root Makefile exposes this as `prod-pull` / `prod-up` /
  `prod-deploy` (`Makefile:92-110`) - but those targets are meant to run **on the VPS**;
  nothing in the repo builds and pushes images from the workstation today, and
  `prod-deploy` never sets `IMAGE_TAG` (so it deploys whatever `latest` points at).

## Approach a: workstation build + push to GHCR + ssh pull/up (the expense-tracker model)

- How it works (verified in the user's repo at `/Users/yuri/web/expense-tracker`):
  a root Makefile mirrors the CI workflow. `deploy` refuses a dirty tree, builds all
  images with `--platform linux/amd64`, tags `sha-<short>` + `main`, pushes to GHCR,
  then calls `deploy-remote`, which scp's the prod compose file and runs over SSH:
  network create, `docker login ghcr.io`, `IMAGE_TAG=sha-<short> docker compose pull`,
  `up -d --remove-orphans`, prune old local images
  (`Makefile:45-61` and `73-85`). SSH config lives in a gitignored `.deploy.env`
  (`-include .deploy.env` at line 19; `SSH_TARGET` guard at line 21).
  Whatever path deployed last wins; both paths push the same tags to GHCR, so CI and
  workstation deploys are interchangeable (header comment, `Makefile:1-17`).
- Requirements: Docker with buildx + a working amd64 emulation layer on the arm64 Mac
  (see cross-platform section), a GHCR PAT with `write:packages`, an SSH key on the
  VPS, and nothing on the VPS but Docker.
- Failure modes: slow cross-arch builds on the workstation (the price of not using CI);
  forgets to push -> stale `latest`; unauthenticated pulls on the VPS if the PAT lapses;
  workstation offline == no deploys (acceptable: that is already true for the human).
- Real-world usage: this exact pattern (build locally, push to a registry, ssh + compose
  pull/up) is the common manual variant of what the current zvonok workflow automates;
  the expense-tracker repo proves it works for the same kind of stack. GitHub's own
  docs describe the pieces (push from the command line, pull by tag) as first-class
  CLI workflows. Source: [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Approach b: registry-less transfer (`docker save` | ssh `docker load`)

- How it works: `docker save` produces a tar of all parent layers streamed to STDOUT;
  `docker load` restores images and tags from a tar or STDIN, including gzip-compressed
  streams. Piping one through SSH moves an image without any registry:
  `docker save img | ssh host docker load`.
  Sources: [docker image save](https://docs.docker.com/reference/cli/docker/image/save/),
  [docker image load](https://docs.docker.com/reference/cli/docker/image/load/).
- First-party precedent: K3s air-gap installs ship images exactly this way - download
  the release tar, `docker image load k3s-airgap-images-amd64.tar.zst`, or drop the tar
  into `/var/lib/rancher/k3s/agent/images/` for upgrades.
  Source: [K3s Air-Gap Install](https://docs.k3s.io/installation/airgap).
- Real repo usage: `nkonev/videochat`'s Makefile does `docker save $(IMAGE) -o ...`,
  `ssh ... 'docker load ...'`, then `docker stack deploy`
  ([Makefile](https://github.com/nkonev/videochat/blob/master/notification/Makefile));
  `xijaja/gone` has the same `save: docker save | ssh "docker load"` shape
  ([makefile](https://github.com/xijaja/gone/blob/main/makefile)).
- Failure modes: transfers the **entire** image every time ("docker save | ssh ... loads
  even if 90% already exists on the server" - the problem statement in the unregistry
  README), slow on home uplinks; no tag history anywhere (rollback only from local tars);
  needs several GB of free disk on both ends. zvonok's server image carries a full
  node_modules tree plus the mediasoup worker, so full-image transfers are heavy.
- Improved variant with real adoption: `psviderski/unregistry` (4,867 stars) ships
  `docker pussh myapp user@server` - pushes only the missing layers over SSH to a
  temporary registry container on the server. "It's like rsync for Docker images."
  Requires Docker + SSH on the server, nothing else.
  Source: [README](https://github.com/psviderski/unregistry).

## Approach c: build on the VPS (git pull / rsync + build)

- Discourse (canonical example): the official install runs one command on the fresh
  server; "the installer builds your Discourse (~5-10 minutes)" **on the server**;
  upgrades are `./launcher rebuild app` at `/var/discourse`. The repo
  (`discourse/discourse_docker`) is the build-and-run tooling itself, with the
  `launcher` bash script at the repo root. No registry in the loop.
  Sources: [INSTALL-cloud.md](https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md),
  [discourse_docker README](https://github.com/discourse/discourse_docker).
- rsync variant: `PureStorage-OpenConnect/proxmox-pure-snap-restore` has a root
  `deploy-remote` target: `tarball` + `scp` + `ssh ... remote_deploy.sh` which builds
  on the docker host ([Makefile](https://github.com/PureStorage-OpenConnect/proxmox-pure-snap-restore/blob/main/Makefile)).
- Non-docker ancestor of the pattern: Mastodon's official upgrade docs are "SSH in,
  `git fetch --tags && git checkout v3.1.2`, run the release notes, restart services"
  - the build happens on the server.
  Source: [Upgrading to a new release](https://docs.joinmastodon.org/admin/upgrading/).
- Generalized first-party tool: Dokku ("Docker powered mini-Heroku. The smallest PaaS
  implementation you've ever seen", 32,137 stars) turns `git push` into a server-side
  build+deploy; you install it on the VPS once and never script SSH again.
  Source: [dokku/dokku](https://github.com/dokku/dokku).
- Docker-native variant: point the workstation CLI at the VPS daemon - `docker context
  create --docker host=ssh://user@host` (or `DOCKER_HOST=ssh://...`), then
  `docker --context vps compose ...` runs against the remote engine; `docker buildx
  build --builder` can even use the remote as a build node. No registry, no scp, but
  the build executes on the VPS.
  Sources: [docker contexts](https://docs.docker.com/engine/manage-resources/contexts/),
  [SSH daemon access](https://docs.docker.com/engine/security/protect-access/).
- Failure modes for zvonok specifically: the VPS is a small box already running
  mediasoup + postgres + coturn + the Traefik gateway. Building here means a full pnpm
  monorepo install and Vite/Nest builds competing with live WebRTC traffic for CPU and
  RAM, plus build tooling (node, compiler toolchain for bcrypt's postinstall - the
  migrator stage explicitly compiles a native addon, `apps/server/Dockerfile:47`) must
  exist or be pulled in. Disk fills with build cache. Discourse mitigates with swap and
  a server spec floor (1 GB min / 2 GB recommended, INSTALL-cloud.md); zvonok's own
  docs recommend 2-4 GB for the running stack alone
  ([docs/deployment.md](../deployment.md)). This approach trades workstation time for
  production-box risk - the worst fit for a live SFU.

## Approach d: Kamal (basecamp) - opinionated workstation deploys

- What it automates: `kamal setup`/`kamal deploy` connect over SSH (root by default),
  install Docker via get.docker.com, log into the registry locally and remotely, build
  the image from the app's Dockerfile on the workstation, push, pull onto the servers,
  run `kamal-proxy` on ports 80/443, start the new container (versioned by git hash),
  health-check `GET /up` with 200 OK before routing traffic, stop the old container,
  and prune. Sources: [Installation](https://kamal-deploy.org/docs/installation/),
  [repo](https://github.com/basecamp/kamal).
- What it assumes: a registry is part of the core config (`registry: username/password`
  in `config/deploy.yml`); deploy config lives at `config/deploy.yml` in the app repo;
  cross-arch is handled via `builder: arch: amd64`. Same source.
- Registry-less? Not supported out of the box; the official workaround is running a
  `registry:2` container on the server as a Kamal accessory
  ([discussion #510](https://github.com/basecamp/kamal/discussions/510)).
- Rollback: `kamal rollback <version>` restarts the previous container **already on the
  host** - "Nothing needs to be downloaded from the registry" - but old containers are
  pruned after 3 days by default.
  Source: [kamal rollback](https://kamal-deploy.org/docs/commands/rollback/).
- Fit problems for zvonok: (1) Kamal wants to own the edge - `kamal-proxy` binds 80/443,
  while this VPS already has a shared Traefik gateway owning both ports
  (`docker-compose.prod.yml:115-151` labels route through it; the gateway is a separate
  setup at `~/gateway`, see docs/deployment.md). (2) Kamal deploys **one app image**
  plus accessories; zvonok ships four coordinated images (server, migrator that must
  complete first, caddy with baked assets, docs) where compose dependency ordering
  (`service_completed_successfully` on migrate, `docker-compose.prod.yml:67-73`) does
  work Kamal does not model. (3) Ruby toolchain dependency (gem or dockerized run).
  Kamal is excellent greenfield glue for a single app; adopting it here means fighting
  both the gateway and the multi-image migration choreography.

## Approach e: other patterns worth knowing

- Capistrano-style SSH scripting: "Capistrano is a remote server automation tool"
  (script arbitrary workflows over SSH, rolling deploys, rollbacks). It generalizes
  what the Makefile+ssh approach hand-rolls, in Ruby; it has no opinion about Docker,
  so it would wrap compose just like the shell does.
  Source: [What is Capistrano?](https://capistranorb.com/documentation/overview/what-is-capistrano/).
  Verdict: extra framework for what ~15 lines of Make already do at this scale.
- Unregistry/`docker pussh` (covered in approach b) and Dokku (covered in approach c)
  are the two other tools with meaningful adoption in this niche.

## Cross-platform builds: arm64 workstation -> amd64 VPS

- `--platform linux/amd64` from an arm64 host runs the whole build under emulation
  unless the Dockerfile opts into cross-compilation. Docker's docs: emulation via QEMU
  "can be much slower than native builds, especially for compute-heavy tasks like
  compilation"; they recommend cross-compilation (pin the builder stage with
  `FROM --platform=$BUILDPLATFORM` and pass `TARGETPLATFORM` to the compiler) or
  multiple native nodes instead. Docker Desktop bundles QEMU, so "running and building
  multi-platform images under emulation" works with no setup; standalone Linux engines
  may need `tonistiigi/binfmt`. Source:
  [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/).
- Docker Desktop on Apple Silicon can accelerate amd64 emulation with Rosetta 2
  (GA since Docker Desktop 4.25), which is substantially faster than QEMU for x86-64
  binaries. Sources: [Docker Desktop 4.25 announcement](https://www.docker.com/blog/docker-desktop-4-25/),
  toggle: Settings > General > "Use Rosetta for x86_64/amd64 emulation on Apple Silicon".
- The expense-tracker Dockerfiles use the `FROM $BUILDPLATFORM` pattern so builder
  stages run natively and only tiny final stages are emulated
  (`Makefile:24-29` documents the amd64 cross-build and the exec-format failure it
  prevents). The zvonok Dockerfiles do **not**: all stages of
  `apps/server/Dockerfile` (base `node:22-slim` at line 3; builder 14-35; migrator
  39-65; production 68-115) and `apps/client/Dockerfile` (build 7-39; final caddy
  42-44) run under full amd64 emulation from the M1 Pro.
- What that means concretely for zvonok: the server builder stage runs `pnpm install`
  of the whole workspace plus `prisma generate` and the Nest build
  (`apps/server/Dockerfile:24,33-35`) under emulation - the expensive kind of work
  Docker's docs warn about. Native artifacts matter too: bcrypt's postinstall compiles
  a native addon (`apps/server/Dockerfile:47`), and mediasoup fetches a prebuilt
  worker binary "appropriate for current platform and architecture", building from
  source only if none matches
  ([mediasoup installation](https://mediasoup.org/documentation/v3/mediasoup/installation/));
  the production stage then locates that worker
  (`apps/server/Dockerfile:81-87`). Under amd64 emulation the amd64 variants get
  fetched/built - correct, just slow. The client (Vite, `apps/client/Dockerfile:39`)
  and docs (VitePress, `apps/docs/Dockerfile.docs:33`) images are static-output builds
  into tiny final layers (`caddy:2-alpine`, `nginx:alpine`) - emulated cost is modest.
  Note for later: a `--platform=$BUILDPLATFORM` cross-compile split would relocate
  native codegen (Prisma client generation includes a query engine binary - see
  [Prisma generators](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generators))
  to the builder's arch; that is a real change to evaluate, not a free win.

## GHCR auth for workstation pushes

- Machine auth: GitHub Packages supports personal access tokens (classic); scopes:
  `read:packages` to pull, `write:packages` to push; login is
  `echo $CR_PAT | docker login ghcr.io -u USERNAME --password-stdin`. Note the UI
  auto-selects the broad `repo` scope with `write:packages`; the docs give a
  scope-only URL (`https://github.com/settings/tokens/new?scopes=write:packages`)
  to avoid it. Source: [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
- The VPS pulls need `read:packages` (already true today via `GHCR_TOKEN`,
  `.github/workflows/deploy.yml:208,225`).
- Repo-linking gotcha: "When you push a container image from the command line, the
  image is not linked to a repository by default"; the fix is the
  `org.opencontainers.image.source` label. The CI path gets this for free -
  `docker/metadata-action` emits it
  (see the labels in its [README](https://github.com/docker/metadata-action)), and the
  zvonok workflow wires `labels:` through (deploy.yml:64-65). A workstation path must
  add `--label org.opencontainers.image.source=https://github.com/<owner>/<repo>` or
  the pushed images sit unlinked (private, no permission inheritance).
- Registry limits to know: 10 GB per layer, 10-minute upload timeout
  (same GitHub page) - a realistic failure mode when pushing the fat server image over
  a home uplink.

## Rollback practices across the surveyed projects

- expense-tracker: every deploy lands `sha-<short>` + a moving `main` tag in GHCR and
  is marked with a CalVer git tag + GitHub Release (`scripts/tag-deploy.sh:12-14,74-84`);
  `make rollback TAG=v2026.09.14` accepts either a deploy tag or an image tag and
  re-runs `deploy-remote` with the resolved `sha-<short>` - no rebuild
  (`Makefile:63-70`, `scripts/resolve-image-tag.sh:20-29`).
- Kamal: rollback reuses the previous container image still on the host, no registry
  download, with a 3-day local retention before pruning
  ([kamal rollback](https://kamal-deploy.org/docs/commands/rollback/)).
- Discourse: no first-class rollback - recovery means rebuilding a previous config
  (`./launcher rebuild`), or restoring backups.
- Mastodon: rollback is git-based - check out the previous tag on the server and rerun
  the upgrade steps ([Upgrading](https://docs.joinmastodon.org/admin/upgrading/)).
- zvonok today: rollback is possible but manual and undocumented - GHCR retains every
  `sha-<short>` tag (the workflow only prunes images on the VPS, deploy.yml:231-236),
  so `IMAGE_TAG=sha-<old> docker compose ... up -d` after a pull restores a prior
  version; but the Makefile prod targets never set `IMAGE_TAG`
  (`Makefile:92-110`) and there is no rollback target, no deploy tagging, no releases.

## Root Makefile vs a separate infra/deploy/Makefile

- Surveyed projects put the deploy entry point at the repo root, not in an infra
  subtree: expense-tracker (root Makefile, workstation deploy path), zvonok today (root
  Makefile with `prod-*` targets), proxmox-pure-snap-restore (root `deploy-remote`
  wrapping `deploy/*.sh` assets), discourse_docker (root `./launcher` script with
  config in `containers/`), Kamal (root `config/deploy.yml`), Dokku (no repo config at
  all - the tool is server-side). Ops-heavy assets (templates, monitoring, backup
  scripts) live in subdirectories everywhere; none of the surveyed repos gates deploys
  behind a second Makefile in an `infra/` dir.
- This repo already has the shape that favors a root entry point: `make help` /
  `make up` / `make prod-deploy` are the documented muscle memory
  (`Makefile:1-17,92-110`), while `infra/` holds **assets consumed by compose**
  (backup scripts, monitoring compose, gateway compose) - adding `infra/deploy/` would
  create a second top-level way to do the same thing.

## Comparison

| Approach | Build runs on | Needs registry | Needs GitHub | VPS load | Rollback story | zvonok fit |
|---|---|---|---|---|---|---|
| a. workstation build + GHCR push + ssh pull | workstation (emulated amd64) | yes (GHCR) | yes (registry + optional tag push) | none (pull only) | strong: sha tags kept in GHCR + deploy tags | best: mirrors existing CI path exactly |
| b. `docker save` \| ssh `docker load` | workstation | no | no | none (receive only) | weak: whatever tars you kept | fallback when GHCR unreachable; fat full-image transfers |
| b'. unregistry `docker pussh` | workstation | no | no | light (layer transfer) | weak (image on host only) | nice GHCR-free alternative; extra tool |
| c. build on VPS (git pull / rsync / context) | VPS | no | no (git remote or rsync) | heavy (pnpm + native builds next to SFU) | varies (rebuild previous) | poor: small box, live mediasoup traffic |
| d. Kamal | workstation (pushes via registry) | yes by default | no (any registry) | light, but installs kamal-proxy on 80/443 | strong, host-local, 3-day window | poor: gateway conflict, single-app model vs 4 images + migrate gate |
| e. Capistrano-style scripting | either | n/a | n/a | light | depends on script | unnecessary framework at this scale |

## Recommendation for zvonok

1. Adopt approach (a) as the Actions-independent path, modeled directly on the
   expense-tracker root Makefile: gitignored `.deploy.env` with `SSH_TARGET`;
   `PLATFORM ?= linux/amd64` (with the exec-format-error warning comment);
   `deploy` = dirty-tree guard -> build all four images (`server` target `production`,
   `migrator` target `migrator`, `caddy` from `apps/client/Dockerfile`, `docs` from
   `apps/docs/Dockerfile.docs`) tagged `sha-<short>` + `latest` -> push ->
   `deploy-remote` = scp the same four files + ssh (network create, `docker login
   ghcr.io` with a `read:packages` PAT, `IMAGE_TAG=sha-<short>` pull, `up -d
   --remove-orphans`, prune). This is byte-for-byte the same VPS-side sequence the
   workflow already runs (deploy.yml:216-236), so both paths stay interchangeable.
2. Keep GHCR as the registry (free storage/bandwidth, zero Actions minutes, rollback
   history), and add `org.opencontainers.image.source` labels on workstation pushes so
   the packages stay linked to the repo.
3. Add the rollback target while at it: `rollback TAG=` accepting `sha-<short>` or a
   git ref, reusing `deploy-remote` with no build - today's GHCR tag history already
   supports it; only the Makefile plumbing is missing.
4. Expect the first amd64 build on the M1 Pro to be slow (full emulation of the pnpm
   install + Nest build; caddy/docs are comparatively cheap). Enable Rosetta emulation
   in Docker Desktop; add a shared pnpm cache mount so repeat builds warm up. If build
   time proves unacceptable, the escape hatches are Docker Build Cloud / a tiny amd64
   build node via `docker buildx create` - both keep the deploy path unchanged.
5. Keep `docker save | ssh docker load` (or `docker pussh`) in the back pocket as the
   GHCR-unreachable fallback, not as the primary path: no tag history, fat transfers.
   Do not adopt build-on-VPS (prod box does real-time media) or Kamal (gateway and
   multi-image mismatches).

## Open decisions for the user

- Should the workstation path be the primary deploy or the documented fallback? (The
  two paths can coexist exactly because they produce identical tags; expense-tracker
  runs both.)
- Adopt CalVer deploy tags + GitHub Releases (`vYYYY.MM.DD`) as deploy markers like
  expense-tracker, or keep `sha-<short>` as the only rollback currency?
- Is the emulated server-image build time acceptable? Measure once; if not, decide
  between Docker Build Cloud (paid, off-VPS) vs a cheap amd64 build node
  (`docker buildx node` on the VPS itself or a small instance) vs leaving the CI build
  as the default and the workstation path for emergencies.
- Whether to touch the Dockerfiles at all (`FROM --platform=$BUILDPLATFORM` split) -
  only worth it if workstation builds become the norm, and it needs verification around
  native codegen (bcrypt addon, mediasoup prebuilt worker, Prisma client generation).
- Which PATs to standardize: one `write:packages` (workstation push) + one
  `read:packages` (VPS pull, already exists as `GHCR_TOKEN`), and whether the VPS
  token should be a fine-grained/classic PAT per current GHCR docs (classic only, per
  the docs today).
