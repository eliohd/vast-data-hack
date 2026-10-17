"""Lane C cache builder: runs the sponsor models once over the shortlist and caches the outputs.

    cd server && uv run python -m app.agent.perception_build

For each shortlisted segment: W&B Inference `chat_json` with OBSERVATION_EXTRACTION_PROMPT over the
stored caption + YOLO11 counts, and Cosmos Reason `ask_video` with `verification_prompt()` on the
5-second clip (fetched server-side through VSS). Weave is initialised so every call is traced.
Calls run one at a time. The cache stores model ids, prompt versions, latency and the video's
SHA-256, never media URLs, tokens or video bytes. The app reads this cache; it makes no model
calls at session creation.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.agent.prompts import (
    EVIDENCE_VERIFICATION_PROMPT_VERSION,
    OBSERVATION_EXTRACTION_PROMPT,
    OBSERVATION_EXTRACTION_PROMPT_VERSION,
    verification_prompt,
)
from app.clients.gpu import CosmosReason
from app.clients.llm import LLM
from app.clients.vss import VSSClient
from app.config import get_settings
from app.core.parsing import extract_json
from app.services import init_tracing

CACHE = Path(__file__).resolve().parents[2] / "fixtures" / "rideahead" / "cache"
SEGMENT_PREFIX = "s3://team-46-vss-chunks-segments/segments/"
QUESTION = (
    "A motor vehicle is stopped or parked in, or partially in, the bicycle lane or the "
    "cyclist's riding lane ahead, so a rider would have to leave that lane."
)
EXTRA = ["gx010001-c14-s3"]  # added after the stored-YOLO lane search (handoff-C)


def _segment_file(seg_id: str, captions: dict[str, Any]) -> str:
    if seg_id in captions:
        return captions[seg_id]["segment_file"]
    chunk, seg = int(seg_id.split("-c")[1][:2]), int(seg_id.rsplit("-s", 1)[1])
    stamps = {11: "074125", 12: "074151", 13: "074216", 14: "074241", 15: "074307", 16: "074332"}
    return f"20261008_{stamps[chunk]}_GX010001_chunk_{chunk:04d}_segment_{seg:03d}_of_006.mp4"


async def _caption(vss: VSSClient, source: str) -> tuple[str, dict[str, int]]:
    meta = await vss.segment_metadata(source)
    counts = json.loads(meta.get("perception_json") or "{}").get("object_counts", {})
    return meta.get("reasoning_content") or "", counts


async def main() -> None:
    s = get_settings()
    traced = init_tracing(s)
    manifest = json.loads((CACHE / "ride_gx010001_manifest.json").read_text())
    captions = {
        c["id"]: c
        for c in json.loads((CACHE / "captions_gx010001_shortlist.json").read_text())["segments"]
    }
    seg_ids = [x["id"] for x in manifest["shortlist"]] + EXTRA
    async with httpx.AsyncClient(timeout=s.upstream_timeout_s, verify=s.vss_verify_tls) as http:
        vss = VSSClient(http, s.vss_url, s.vss_username, s.vss_password.get_secret_value())
        cosmos = CosmosReason(
            http, s.cosmos_reason_url, s.gpu_bearer_token.get_secret_value(), s.cosmos_reason_model
        )
        llm = LLM(
            s.llm_base_url, s.wandb_api_key.get_secret_value(), s.wandb_entity_project, s.llm_model
        )
        cosmos_model = await cosmos.model()
        results: list[dict[str, Any]] = []
        for seg_id in seg_ids:
            filename = _segment_file(seg_id, captions)
            source = SEGMENT_PREFIX + filename
            if seg_id in captions:
                caption, counts = captions[seg_id]["caption"], captions[seg_id]["object_counts"]
            else:
                caption, counts = await _caption(vss, source)

            started = time.perf_counter()
            extraction = await llm.chat_json(
                OBSERVATION_EXTRACTION_PROMPT,
                f"Clip description:\n{caption}\n\nYOLO11 object counts (max per frame): "
                f"{json.dumps(counts)}",
                temperature=0.0,
            )
            extract_ms = round((time.perf_counter() - started) * 1000)

            res = await http.get(await vss.stream_url(source))  # JWT URL: never stored
            res.raise_for_status()
            mp4 = res.content
            started = time.perf_counter()
            raw, parsed = "", None
            try:
                raw = await cosmos.ask_video(
                    mp4, verification_prompt(QUESTION), max_tokens=700, temperature=0.0
                )
                parsed = extract_json(raw)
            except httpx.HTTPError as exc:
                raw = f"error: {type(exc).__name__}"
            verify_ms = round((time.perf_counter() - started) * 1000)
            verdict = (parsed or {}).get("verdict")
            if verdict not in {"supported", "contradicted", "unclear"}:
                verdict = "unclear"

            results.append(
                {
                    "segment_id": seg_id,
                    "segment_file": filename,
                    "caption": caption,
                    "object_counts": counts,
                    "extraction": {
                        "model": s.llm_model,
                        "prompt_version": OBSERVATION_EXTRACTION_PROMPT_VERSION,
                        "parsed": extraction,
                        "latency_ms": extract_ms,
                    },
                    "verification": {
                        "model": cosmos_model,
                        "prompt_version": EVIDENCE_VERIFICATION_PROMPT_VERSION,
                        "question": QUESTION,
                        "verdict": verdict,
                        "parsed": parsed,
                        "raw_text": raw[-600:],
                        "latency_ms": verify_ms,
                    },
                    "video_sha256": hashlib.sha256(mp4).hexdigest(),
                }
            )
            ex = extraction or {}
            print(
                f"{seg_id}: extract={ex.get('assertion')}/{ex.get('support')} ({extract_ms} ms) "
                f"cosmos={verdict} ({verify_ms} ms)"
            )
    out = CACHE / "model_outputs_v2.json"
    out.write_text(
        json.dumps(
            {
                "provenance": "cached recorded",
                "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "weave_traced": traced,
                "weave_project": s.wandb_entity_project if traced else None,
                "results": results,
            },
            indent=1,
        )
        + "\n"
    )
    print("wrote", out, "| weave traced:", traced)


if __name__ == "__main__":
    asyncio.run(main())
