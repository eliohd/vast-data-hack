# Agent guide

Rules for coding agents (Claude Code, Cursor) working in this repo. Humans: see README.md.

## What this is

A real-time video agent built at the VAST Builders Challenge London (17 Oct 2026). A phone camera
streams frames to a FastAPI server, which reasons over them with NVIDIA Cosmos, the team's VSS
archive (VAST DataEngine + VastDB) and W&B Inference, then answers in the browser.

```
web/      Astro 6 static shell + React 19 islands, Tailwind 4, shadcn/ui (radix-nova)
server/   FastAPI on Python 3.12 (uv). Runs on the lab VM; VSS/S3/VastDB are private to it.
docs/     architecture.md, deploy.md, vss-api.md
scripts/  deploy.sh (laptop → VM), vm-run.sh (on the VM)
```

## Layers (each only knows the one above it)

server:
```
app/config.py        Settings (env > server/.env > /config/<team>.config)
app/clients/*        one client per upstream: vss, gpu (cosmos/embed/yolo/canary), llm, vastdb
app/agent/*          product logic: analysers, prompts — pure where possible, tested
app/api/*            routes only: validate, call agent/clients, shape the response
app/main.py          wiring: middleware, routers, static web/dist
```
web:
```
src/lib/*            pure TS (protocol, frames, socket, demo key) — unit-tested
src/hooks/*          browser APIs (camera, wake lock, recorder)
src/components/*     React islands; src/components/ui is shadcn (add with `pnpm dlx shadcn@latest add`)
src/pages/*.astro    composition only, islands mounted with client:only="react"
```

## Contracts

- REST: FastAPI is the source of truth. After changing any route/model run `make gen-api`, which
  rewrites `server/openapi.json` and `web/src/lib/api/schema.d.ts`. Call it from the web via the
  typed `api` client in `src/lib/api/client.ts`. Never hand-write REST types.
- WebSocket `/ws/live`: `server/app/core/protocol.py` ⇄ `web/src/lib/protocol.ts`. Change both.

## Rules

- **Secrets**: never print, log, hardcode or commit credentials. They come from env or the team
  config. List env names only: `env | cut -d= -f1 | sort`. Never run bare `env`/`printenv`.
- The browser never sees upstream tokens. Proxy through the server (see `/api/archive/media`).
- New upstream call → add it to the right client, decorate with `@weave.op` so it is traced.
- Prompts go in `app/agent/prompts.py`, not inline.
- Keep `make verify` green: ruff + pyright + pytest, prettier + eslint + astro check + vitest + build.
  Add a unit test for any pure logic you add (parsing, scoring, geometry).
- Don't redeploy or modify the organisers' VSS pipeline. Re-ingest via the VSS API only, and
  only small, deliberate batches (the team shares one pipeline).
- Don't ingest internet video (licensing rule of the event). Our own phone clips are fine.
- Web app only (no native app). Mobile-first: the main device is a phone on HTTPS.

## Useful commands

```
make setup        install everything
make dev          API :8000 + web :4321 (web proxies /api and /ws)
make verify       all checks
make gen-api      regenerate TS types from the server
make serve        one-origin production mode on :8000
make probe        which upstreams are reachable from here
make deploy VM=bc-<you>   build web, sync to lab VM, restart there
```

The organisers' skills (VSS search, re-ingest, upload, VastDB read/write, GPU smoke tests) live
on the lab VM in `~/vast-builders-challenge/.cursor/skills/`. Read them before raw REST calls.
`docs/vss-api.md` summarises what this repo already wraps.
