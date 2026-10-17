---
name: vss-stack
description: How this repo talks to the VAST/NVIDIA/W&B stack — where each upstream client lives, how to add a call, wire it into the live analyser, trace it in Weave, and expose it to the web with generated types. Use when adding any feature that searches the archive, calls Cosmos/YOLO/Embed/Canary, re-ingests video, or uses W&B Inference.
---

# Working with the stack in this repo

Read `docs/vss-api.md` for endpoint shapes. On the lab VM, the organisers' skills in
`~/vast-builders-challenge/.cursor/skills/` are the ground truth for request/response details.

## Where things go

| Task | File |
|---|---|
| New VSS call | `server/app/clients/vss.py` — method on `VSSClient`, `@weave.op` if it's agent-relevant |
| New GPU model call | `server/app/clients/gpu.py` |
| LLM reasoning step | `server/app/clients/llm.py` (`chat`, `chat_json`) |
| Prompt text | `server/app/agent/prompts.py` |
| Live per-frame logic | `server/app/agent/analyser.py` — implement `FrameAnalyser`, select in `build_analyser` |
| New REST route | `server/app/api/<area>.py`, include it in `app/main.py`, then `make gen-api` |
| UI | `web/src/components/<area>/*.tsx` island, mounted in `web/src/pages/*.astro` with `client:only="react"` |

## Steps for a feature

1. Add/extend the client method (typed params, returns parsed JSON).
2. Put the logic in `app/agent/` as small functions; unit-test the pure parts in `server/tests/`.
3. Expose via a route with Pydantic request/response models (so OpenAPI is precise).
4. `make gen-api`, then call it from the web with `api.GET/POST` from `@/lib/api/client`.
5. `make verify`.

## Gotchas

- VSS, S3 and VastDB are private: they only work on the lab VM. Locally, expect `vss` to be down in
  `make probe` — use the stub analyser or mock data.
- Never send the VSS JWT or GPU token to the browser; proxy media via `/api/archive/media`.
- Re-ingest is slow (minutes) and the pipeline is shared by the team: small batches only.
- Cosmos may wrap JSON in prose or `<think>` blocks: always parse with `core.parsing.extract_json`.
- Cosmos Embed vectors are 256-dim; text and video share the space (video-to-text search works).
