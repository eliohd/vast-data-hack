# hack

Real-time video agent for the **VAST Builders Challenge London** (17 Oct 2026).
Live at **https://hack.elio.ltd**.

> One-line pitch goes here once the idea is locked.

A phone camera streams frames to a FastAPI server that reasons over them with **NVIDIA Cosmos**
(Reason + Embed), **YOLO11**, the team's video archive on **VAST AI OS** (DataEngine, VastDB, VSS
search) and **W&B Inference**, with every step traced in **Weave**.

## Stack

| Layer | Tech |
|---|---|
| Web | Astro 6 (static) + React 19 islands, Tailwind 4, shadcn/ui, Lucide |
| API | FastAPI, httpx, Pydantic, uv, Python 3.12 |
| Video understanding | NVIDIA Cosmos Reason, Cosmos Embed1, YOLO11, Canary-1B on CoreWeave GPUs |
| Archive | VAST DataEngine ingest pipeline, VastDB vectors + metadata, VSS hybrid search |
| LLM + observability | W&B Inference, Weave traces and evals |
| Hosting | Lab VM behind a Cloudflare named tunnel (`hack.elio.ltd`) |

## Getting started

```bash
make setup                     # pnpm install + uv sync
cp server/.env.example server/.env   # optional locally; on the VM /config/<team>.config is read
make dev                       # API :8000 + web :4321
```

Open http://localhost:4321. With no upstreams configured the server runs the `stub` analyser,
so the whole camera → WebSocket → result loop works offline.

| Command | What it does |
|---|---|
| `make dev` | API with reload on :8000, web dev server on :4321 (proxies `/api`, `/ws`) |
| `make verify` | ruff, pyright, pytest · prettier, eslint, astro check, vitest, build |
| `make gen-api` | Server OpenAPI → `web/src/lib/api/schema.d.ts` |
| `make serve` | Production-like single origin on :8000 |
| `make probe` | Which upstreams are reachable from this machine |
| `make phone-tunnel` | HTTPS URL for testing the camera on a phone |
| `make deploy VM=bc-<you>` | Build web, sync to the lab VM, restart |

## Docs

- [Architecture](docs/architecture.md): topology, the two lanes, where the idea plugs in
- [Deploy](docs/deploy.md): lab VM, Cloudflare tunnel, demo key
- [VSS + model endpoints](docs/vss-api.md): what each upstream does and how it's wrapped
- [AGENTS.md](AGENTS.md): conventions for coding agents

## Data and licences

Archive footage is the event's pre-indexed corpus, used under the organisers' terms. Clips
recorded on the day were filmed by the team with consent of everyone in frame.

## Team

- Elio Haddad
