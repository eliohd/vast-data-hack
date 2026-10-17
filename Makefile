# One entry point for both halves. `make help` lists targets.
SHELL := /bin/bash
.DEFAULT_GOAL := help

API_PORT ?= 8000
WEB_PORT ?= 4321
# Lab VM SSH alias from the workshop page (e.g. bc-elio). Override: make deploy VM=bc-you
VM ?= bc-$(USER)
VM_DIR ?= ~/hack

.PHONY: help setup dev dev-server dev-web verify verify-web verify-server fmt gen-api build serve probe phone-tunnel deploy vm-run

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Install web (pnpm) and server (uv) dependencies
	cd web && pnpm install
	cd server && uv sync

dev: ## Run API (:8000) and web (:4321) together with reload
	@$(MAKE) -j2 dev-server dev-web

dev-server: ## API only, auto-reload
	cd server && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port $(API_PORT)

dev-web: ## Web only (proxies /api and /ws to API_TARGET, default :8000)
	cd web && pnpm dev --port $(WEB_PORT)

verify: verify-server verify-web ## Everything CI runs

verify-server: ## ruff + pyright + pytest
	cd server && uv run ruff format --check . && uv run ruff check . && uv run pyright && uv run pytest -q

verify-web: ## prettier + eslint + astro check + vitest + build
	cd web && pnpm verify

fmt: ## Auto-format both halves
	cd server && uv run ruff format . && uv run ruff check --fix .
	cd web && pnpm format

gen-api: ## Export server OpenAPI → regenerate web/src/lib/api/schema.d.ts
	cd server && uv run python -m app.export_openapi
	cd web && pnpm gen:api

build: ## Static web build into web/dist (FastAPI serves it)
	cd web && pnpm build

serve: build ## Production-like: one origin on :8000 (what the tunnel points at)
	cd server && uv run uvicorn app.main:app --host 0.0.0.0 --port $(API_PORT) --proxy-headers

probe: ## Which upstreams are reachable from this machine? (server must be running)
	@curl -s localhost:$(API_PORT)/api/health/upstreams | python3 -m json.tool

phone-tunnel: ## HTTPS quick tunnel to the local web dev server, for testing on a phone
	cloudflared tunnel --url http://localhost:$(WEB_PORT)

deploy: build ## Build web locally, rsync repo to the lab VM, restart the server there
	VM=$(VM) VM_DIR=$(VM_DIR) ./scripts/deploy.sh

vm-run: ## (on the VM) start/restart the API serving web/dist on :8000 in tmux
	./scripts/vm-run.sh
