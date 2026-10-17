# Architecture

## Topology

```
Phone (Safari/Chrome, HTTPS)
   │  https://hack.elio.ltd            (Cloudflare named tunnel)
   ▼
cloudflared on the lab VM ──► FastAPI :8000 (one origin)
                                 ├── /            web/dist (Astro static build)
                                 ├── /api/*       JSON API
                                 └── /ws/live     live frames
                                       │
             ┌─────────────────────────┼─────────────────────────────┐
             ▼                         ▼                             ▼
   VSS backend (INGRESS_URL)   GPU endpoints (bearer)        W&B Inference + Weave
   S3 + VastDB  [private]      Cosmos Reason / Embed,        (api.inference.wandb.ai)
                               YOLO11, Canary-1B
```

Why the server lives on the VM: the VSS backend, S3 and VastDB are only reachable inside VAST's
network. Why one origin: no CORS, WebSockets just work, one thing to deploy.

## Two lanes from the phone

| Lane | Path | Latency | Used for |
|---|---|---|---|
| Fast | JPEG frame → `/ws/live` → analyser (Cosmos image call) → result | ~0.5–2 s | Live answers, overlays |
| Slow | 10 s clip → `POST /api/clips?ingest=true` → VSS upload → DataEngine pipeline | minutes | Making today's footage searchable next to the archive |

The client keeps **one frame in flight**; the server answers before the next frame is sent, so a
slow model never builds a queue (stale frames are simply not sent).

## Server layers

- `config.py` — all settings. Reads the organisers' `/config/<team>.config` automatically and maps
  their names (USERNAME, INGRESS_URL, COSMOS3_REASON_URL…) onto ours.
- `clients/` — one class per upstream, every call a `@weave.op` so Weave traces the whole agent.
- `agent/` — the product: `FrameAnalyser` implementations + prompts. `StubAnalyser` runs with no
  upstreams (tests, offline dev); `CosmosAnalyser` asks Cosmos about the frame.
- `api/` — `health` (incl. `/api/health/upstreams` probe), `live` (WebSocket), `clips` (upload +
  optional VSS ingest), `archive` (search / ask / explore / media proxy to VSS), `guard` (optional
  demo key + per-IP rate limit, keyed on CF-Connecting-IP).

## Web

Astro builds a static shell; everything interactive is a React island (`client:only="react"`).
Styling is Tailwind 4 with shadcn/ui components (radix-nova preset, Lucide icons, Geist font).
Typed REST calls go through `openapi-fetch` with types generated from the server's OpenAPI.

## Where to put the idea

1. Write the prompt(s) in `server/app/agent/prompts.py`.
2. Add an analyser in `server/app/agent/analyser.py` (or a new module): combine Cosmos on the frame,
   archive precedent (`vss.search` / Cosmos Embed), and a W&B LLM step. Select it in
   `build_analyser`.
3. Put anything it returns in `Analysis.data`; render it in a new island next to `LiveCamera`.
4. Weave shows every step. Add a `weave.Evaluation` over your labelled clips for the numbers.
