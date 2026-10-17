"""Read C's saved model outputs without calling models or treating them as labels."""

from __future__ import annotations

import csv
import json
from collections import Counter
from hashlib import sha256
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from eval.extraction import Prediction, keyword_prediction, predicted_label


class ExtractionAnswer(BaseModel):
    assertion: Literal["present", "clear", "unclear"] = "unclear"
    support: Literal["supported", "uncertain", "contradicted"] = "uncertain"


class Visibility(BaseModel):
    road_space_visible: bool | None = None
    obstruction_visible: bool | None = None


class ModelRun(BaseModel):
    model: str = Field(min_length=1)
    prompt_version: str = Field(min_length=1)
    latency_ms: float = Field(ge=0, allow_inf_nan=False)
    parsed: dict | None = None


class VerificationRun(ModelRun):
    verdict: Literal["supported", "contradicted", "unclear"]


class CachedResult(BaseModel):
    segment_id: str = Field(min_length=1)
    segment_file: str = Field(min_length=1)
    caption: str
    extraction: ModelRun
    verification: VerificationRun


def _predictions(result: CachedResult, sample_id: str) -> list[Prediction]:
    extraction = result.extraction
    verification = result.verification
    answer = ExtractionAnswer.model_validate(extraction.parsed or {})
    visible = Visibility.model_validate(verification.parsed or {})
    structured = Prediction(
        sample_id=sample_id,
        source_segment_id=result.segment_id,
        method="structured",
        assertion=answer.assertion,
        support=answer.support,
        model_id=extraction.model,
        prompt_version=extraction.prompt_version,
        model_call_count=1,
        latency_ms=extraction.latency_ms,
        provenance="cached_recorded",
    )
    # A verifier answers a positive-obstruction question. Contradiction is not
    # support for an arbitrary extraction, and disagreement must abstain.
    agrees = (
        answer.support == "supported"
        and visible.road_space_visible is True
        and (
            (
                answer.assertion == "present"
                and verification.verdict == "supported"
                and visible.obstruction_visible is True
            )
            or (
                answer.assertion == "clear"
                and verification.verdict == "contradicted"
                and visible.obstruction_visible is False
            )
        )
    )
    verified = Prediction(
        sample_id=sample_id,
        source_segment_id=result.segment_id,
        method="verified",
        assertion=answer.assertion if agrees else "unclear",
        support="supported" if agrees else "uncertain",
        model_id=f"{extraction.model} + {verification.model}",
        prompt_version=f"{extraction.prompt_version} + {verification.prompt_version}",
        model_call_count=2,
        latency_ms=extraction.latency_ms + verification.latency_ms,
        provenance="cached_recorded",
    )
    return [structured, verified]


def load_model_cache(path: Path, labels_path: Path) -> tuple[list[Prediction], dict]:
    """Select the first run per source, preserving duplicate attempts in cost totals.

    The CSV supplies source/sample alignment and captions, including pending rows.
    Its expected labels and C's frame-review/manifest verdicts are never inputs.
    """
    raw = path.read_bytes()
    cache = json.loads(raw)
    if cache.get("provenance") not in ("cached recorded", "cached_recorded"):
        raise ValueError("model cache must declare cached recorded provenance")
    attempts = [CachedResult.model_validate(row) for row in cache["results"]]
    first: dict[str, CachedResult] = {}
    for result in attempts:
        previous = first.setdefault(result.segment_id, result)
        if previous.segment_file != result.segment_file or previous.caption != result.caption:
            raise ValueError("repeated source ID has conflicting media or caption")

    with labels_path.open(encoding="utf-8", newline="") as handle:
        shortlist = list(csv.DictReader(handle))
    if len({row["sample_id"] for row in shortlist}) != len(shortlist):
        raise ValueError("duplicate shortlist sample")
    if len({row["source_segment_id"] for row in shortlist}) != len(shortlist):
        raise ValueError("same source appears repeatedly in shortlist")

    predictions: list[Prediction] = []
    answers = []
    for row in shortlist:
        result = first.get(row["source_segment_id"])
        if result is None:
            continue
        if row["caption"] != result.caption:
            raise ValueError("shortlist caption does not match cached model input")
        pair = _predictions(result, row["sample_id"])
        predictions.extend(pair)
        answers.append(
            {
                "sample_id": row["sample_id"],
                "keyword": keyword_prediction(result.caption),
                "structured": predicted_label(pair[0]),
                "verified": predicted_label(pair[1]),
            }
        )
    coverage = {
        "status": "predictions_only_not_accuracy",
        "cache_sha256": sha256(raw).hexdigest(),
        "built_at": cache.get("built_at"),
        "source_weave_project": cache.get("weave_project"),
        "source_weave_traced": cache.get("weave_traced") is True,
        "selection_policy": "first cached attempt per source; no frame-review overrides",
        "verification_policy": "extraction and visible-lane verifier must agree; otherwise abstain",
        "shortlist_size": len(shortlist),
        "unique_cached_sources": len(first),
        "covered_shortlist_sources": len(answers),
        "duplicate_attempts_excluded_from_scoring": len(attempts) - len(first),
        "executed_calls": {"structured": len(attempts), "cosmos": len(attempts)},
        "original_run_latency_ms": {
            "structured": sum(row.extraction.latency_ms for row in attempts),
            "cosmos": sum(row.verification.latency_ms for row in attempts),
        },
        "answer_counts": {
            method: dict(Counter(row[method] for row in answers))
            for method in ("keyword", "structured", "verified")
        },
        "answers": answers,
        "notes": [
            "Predictions are not ground truth or engine clearance observations.",
            "Verified cost includes extraction; do not add it to structured cost.",
            "Original cached timings exclude VSS download and are not replay timings.",
        ],
    }
    return predictions, coverage
