# VSS + model endpoints cheat sheet

Summarised from the organisers' skills (`~/vast-builders-challenge/.cursor/skills/` on the VM).
Already wrapped in `server/app/clients/`.

## VSS backend (`VSS_URL` = organisers' INGRESS_URL) — JWT from `POST /api/v1/auth/login`

| Need | Endpoint | Client method |
|---|---|---|
| Hybrid search (caption + visual vectors) | `POST /api/v1/search` `{query, top_k, llm_top_n, min_similarity, metadata_filters, time_filter}` | `vss.search(body)` |
| Grounded answer + evidence | `POST /api/v1/agent/ask` `{question, original_video?, top_k}` | `vss.ask(...)` |
| Browse indexed videos | `GET /api/v1/videos/explore?scope=all&limit&offset` | `vss.explore(...)` |
| Segments of one video | `GET /api/v1/tools/segments?original_video=` | `vss.segments(...)` |
| One segment's row | `GET /api/v1/videos/metadata?source=` | `vss.segment_metadata(...)` |
| YOLO boxes for a segment | `GET /api/v1/tools/detections?source=` | `vss.detections(...)` |
| Summarise a video | `POST /api/v1/videos/synthesize` | `vss.synthesize(...)` |
| Filter fields + values | `GET /api/v1/metadata/schema` | `vss.metadata_schema()` |
| Scenario presets, prompt max length (800) | `GET /api/v1/metadata/ingest-config` | `vss.ingest_config()` |
| Upload new clip | `POST /api/v1/videos/upload` multipart (`file`, `custom_prompt`/`scenario`, `camera_id`, `location`, …) | `vss.upload(...)` |
| Re-ingest with a new prompt | `POST /api/v1/dashboard/reingest` `{original_video \| stream_id, chunk_count, custom_prompt?}` | `vss.reingest(...)` |
| Re-ingest progress | `GET /api/v1/dashboard/reingest/{job_id}` | `vss.reingest_status(...)` |
| Play a segment | `GET /api/v1/videos/stream?source=&token=` (JWT in query!) | proxied at `/api/archive/media` |

Search response: `results[]` (segments: `source`, `similarity_score`, `reasoning_content`, timing),
`chunk_results[]` (grouped by upload, `best_match_start_sec`…), `llm_synthesis`.

**The prompt decides what gets indexed.** If a search for X comes back empty, the ingest prompt
never asked about X — re-ingest a few clips with a `custom_prompt` that does.

## GPU endpoints (bearer `GPU_BEARER_TOKEN`)

| Model | Call | Health |
|---|---|---|
| Cosmos Reason (`cosmos_reason_url`) | `POST /v1/chat/completions`, content parts `image_url` / `video_url` (data URLs) | `GET /v1/models` |
| Cosmos Embed1 (256-dim) | `POST /v1/embeddings {input, model, request_type: "query"}`; video as `data:video/mp4;base64,…` | `GET /v1/models` |
| YOLO11 | `POST /v1/infer {video_base64, filename, include_frames}` | `GET /healthz` |
| Canary-1B ASR | `POST /v1/audio/transcriptions` multipart `file`, `model` | `GET /v1/health/ready` (`/v1/models` is a 404) |

SF measured Cosmos Reason at ~0.5 s for one 640 px frame, ~0.7 s for 4 frames with JSON output.

## W&B Inference

OpenAI-compatible at `https://api.inference.wandb.ai/v1`, key `WANDB_API_KEY`, project header
`team/project`. Models include `meta-llama/Llama-3.3-70B-Instruct`, `openai/gpt-oss-120b`,
`nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B`, `deepseek-ai/DeepSeek-V4-Pro-0813`, and vision models
`Qwen/Qwen3.6-35B-A3B`, `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B`. Check tool-calling support
on the day before relying on it.

## VastDB direct (`uv sync --extra vast`)

`app/clients/vastdb_client.py`: connect to the data VIP (S3_ENDPOINT), read `vss-collection`
without vector columns, or create our own schema (e.g. `hackathon`) for results. Never drop or
recreate `vss-collection` / `vss-prompts-events`.
