# Makefile - Docker orchestration and deploy entry points for ZvonOK.
#
# Two interchangeable deploy paths (both push sha-<short> + latest to GHCR;
# whatever deployed last wins):
#   - CI: .github/workflows/deploy.yml (primary)
#   - Workstation: `make deploy` - same images, tags, and VPS-side steps as the
#     workflow, no GitHub Actions involved
#
# Usage:
#   make help            Show available targets
#   make ci              Run the CI checks (lint, typecheck, tests); deploy runs them first
#   make rollback TAG=   Redeploy an already-pushed version (git tag or sha-<short>)
#   make deploy-local    Build and start the local stack on this machine
#   make up / down       Start / stop the local stack
#   make migrate         Run database migrations
#
# One-time workstation setup:
#   1) echo 'SSH_TARGET=deploy@203.0.113.10' > .deploy.env   # gitignored
#      (or use an ~/.ssh/config alias: SSH_TARGET=vps)
#   2) docker login ghcr.io -u <github-user>   # PAT with write:packages
#   3) gh auth login                           # deploy tagging needs gh
#
# VPS prerequisites (same as the CI path): Docker, ~/zvonOK/.env with GHCR_REPO,
# and a stored GHCR login (scripts/setup-vps.sh, step 4).
#
# Prerequisites for the local stack:
#   - Docker and Docker Compose v2+
#   - .env file (run `make setup` to create from template)

.PHONY: help setup ci deploy deploy-local rollback deploy-remote deploy-check deploy-guard \
        up down migrate logs status

# Default env file
ENV_FILE ?= .env

# Compose command
DC := docker compose --env-file $(ENV_FILE)

##@ General
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Setup
setup: ## Create .env from template (will not overwrite existing)
	@if [ -f $(ENV_FILE) ]; then \
		echo "$(ENV_FILE) already exists. Edit it manually or remove it first."; \
	else \
		cp .env.production.example $(ENV_FILE); \
		echo "Created $(ENV_FILE) from .env.production.example"; \
		echo "Edit $(ENV_FILE) with your production values before deploying."; \
	fi

check-env: ## Verify .env file exists
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "Error: $(ENV_FILE) not found. Run 'make setup' first."; \
		exit 1; \
	fi

## Workstation deploy path - mirrors .github/workflows/deploy.yml
-include .deploy.env

REGISTRY   := ghcr.io
GHCR_REPO  ?= $(shell git remote get-url origin 2>/dev/null | sed -E 's,.*github.com[:/],,; s,\.git$$,,' | tr '[:upper:]' '[:lower:]')
SSH_TARGET ?= $(error SSH_TARGET is not set: put SSH_TARGET=user@host into .deploy.env (see the header of this Makefile) or pass SSH_TARGET=... on the command line)
DEPLOY_DIR ?= ~/zvonOK
# The VPS is amd64; an Apple Silicon workstation must cross-build or the
# containers crash-loop with exec format error (exit 255). Docker Desktop's
# Rosetta emulation (Settings > General) keeps the amd64 build time acceptable.
PLATFORM   ?= linux/amd64

SHORT_SHA    := $(shell git rev-parse --short HEAD)
IMAGE_TAG    := sha-$(SHORT_SHA)
SOURCE_LABEL := org.opencontainers.image.source=https://github.com/$(GHCR_REPO)
BUILD        := docker build --platform $(PLATFORM) --label $(SOURCE_LABEL)

deploy-check: ## Verify workstation deploy prerequisites
	@test -n "$(GHCR_REPO)" || { echo "ERROR: cannot derive GHCR_REPO from 'git remote get-url origin'"; exit 1; }
	@test -n "$(SHORT_SHA)" || { echo "ERROR: not a git checkout"; exit 1; }

deploy-guard: ## Refuse to deploy a dirty tree or without gh (deploy tagging needs it)
	@[ -z "$$(git status --porcelain)" ] || { echo "ERROR: working tree dirty - commit or stash first (a deploy tag must name exactly what ships)"; exit 1; }
	@command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 \
		|| { echo "ERROR: deploy tagging needs gh: brew install gh && gh auth login"; exit 1; }

## ci: the checks .github/workflows/ci.yml runs, minus the e2e suite (kept out:
## slow). `make deploy` runs them first, so broken code never reaches GHCR.
ci: ## Run CI checks locally: lint, typecheck, unit tests
	pnpm -C apps/server exec prisma generate
	pnpm lint
	pnpm lint:ts
	pnpm test:client
	pnpm test:package
	pnpm test:server

## deploy: run the CI checks (ci), then build all four images from HEAD
## (linux/amd64), push sha-<short> + latest to GHCR, deploy to the VPS, then
## tag the deploy (v<date>) and publish its GitHub Release (scripts/tag-deploy.sh).
deploy: deploy-check deploy-guard ci ## Run CI checks, build amd64 images, push to GHCR, deploy to VPS
	$(BUILD) -t $(REGISTRY)/$(GHCR_REPO)/server:$(IMAGE_TAG)   -t $(REGISTRY)/$(GHCR_REPO)/server:latest   -f apps/server/Dockerfile --target production .
	$(BUILD) -t $(REGISTRY)/$(GHCR_REPO)/migrator:$(IMAGE_TAG) -t $(REGISTRY)/$(GHCR_REPO)/migrator:latest -f apps/server/Dockerfile --target migrator .
	$(BUILD) -t $(REGISTRY)/$(GHCR_REPO)/caddy:$(IMAGE_TAG)    -t $(REGISTRY)/$(GHCR_REPO)/caddy:latest    -f apps/client/Dockerfile .
	$(BUILD) -t $(REGISTRY)/$(GHCR_REPO)/docs:$(IMAGE_TAG)     -t $(REGISTRY)/$(GHCR_REPO)/docs:latest     -f apps/docs/Dockerfile.docs .
	docker push $(REGISTRY)/$(GHCR_REPO)/server:$(IMAGE_TAG)
	docker push $(REGISTRY)/$(GHCR_REPO)/server:latest
	docker push $(REGISTRY)/$(GHCR_REPO)/migrator:$(IMAGE_TAG)
	docker push $(REGISTRY)/$(GHCR_REPO)/migrator:latest
	docker push $(REGISTRY)/$(GHCR_REPO)/caddy:$(IMAGE_TAG)
	docker push $(REGISTRY)/$(GHCR_REPO)/caddy:latest
	docker push $(REGISTRY)/$(GHCR_REPO)/docs:$(IMAGE_TAG)
	docker push $(REGISTRY)/$(GHCR_REPO)/docs:latest
	@echo ">> images pushed, deploying $(IMAGE_TAG)"
	$(MAKE) deploy-remote IMAGE_TAG=$(IMAGE_TAG)
	./scripts/tag-deploy.sh

## rollback: redeploy an already-pushed version without building. TAG is a git
## deploy tag (v2026.09.14) or an image tag (sha-<short-sha>).
rollback: deploy-check ## Redeploy a pushed version without building: TAG=<v2026.09.14 | sha-xxx>
	@test -n "$(TAG)" || { echo "Usage: make rollback TAG=<v2026.09.14 | sha-03aad8d>"; exit 1; }
	@image_tag=$$(./scripts/resolve-image-tag.sh "$(TAG)"); \
		echo ">> rolling back to $$image_tag ($(TAG))"; \
		$(MAKE) deploy-remote IMAGE_TAG=$$image_tag

## deploy-remote: ship the prod compose files to the VPS and recreate the stack
## with IMAGE_TAG. Same sequence as the deploy job of deploy.yml; the VPS uses
## its stored GHCR login (scripts/setup-vps.sh, step 4).
deploy-remote: deploy-check ## Ship prod compose files to the VPS and recreate the stack with IMAGE_TAG
	scp docker-compose.prod.yml Caddyfile.traefik Caddyfile.routes turnserver.conf "$(SSH_TARGET):$(DEPLOY_DIR)/"
	ssh $(SSH_TARGET) 'set -e; cd $(DEPLOY_DIR); \
		docker network create web 2>/dev/null || true; \
		IMAGE_TAG=$(IMAGE_TAG) docker compose -f docker-compose.prod.yml pull; \
		IMAGE_TAG=$(IMAGE_TAG) docker compose -f docker-compose.prod.yml up -d --remove-orphans; \
		docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" \
			| grep "^$(REGISTRY)/$(GHCR_REPO)/" \
			| grep -v ":$(IMAGE_TAG) \|:latest " \
			| awk "{print \$$2}" \
			| sort -u \
			| xargs -r docker rmi || true'

deploy-local: check-env ## Build and start the local stack (docker-compose.yml) on this machine
	$(DC) up -d --build

up: check-env ## Start local stack with already-built images
	$(DC) up -d

down: ## Stop the local stack
	$(DC) down

##@ Database
migrate: check-env ## Run database migrations only
	$(DC) up migrate

##@ Logs
logs: ## Follow logs for all services
	$(DC) logs -f

##@ Status
status: ## Show local stack status and health
	$(DC) ps -a

