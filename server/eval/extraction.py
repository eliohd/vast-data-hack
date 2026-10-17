"""Evaluate saved predictions against reviewed labels; never call an LLM here."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Label = Literal["present", "absent", "uncertain"]
Method = Literal["keyword", "structured", "verified"]


class ClipLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sample_id: str = Field(min_length=1)
    source_segment_id: str = Field(min_length=1)
    ride_id: str = Field(min_length=1)
    clip_start_s: float = Field(ge=0, allow_inf_nan=False)
    clip_end_s: float = Field(gt=0, allow_inf_nan=False)
    caption: str
    expected: Label
    negated_caption: bool
    reviewer: str = Field(min_length=1)
    reviewed_at: str = Field(min_length=1)
    development_overlap: bool
    provenance: Literal["recorded", "synthetic"]
    reviewer_kind: Literal["human", "ai"] = "human"
    review_method: str | None = None
    review_notes: str | None = None

    @model_validator(mode="after")
    def valid_range(self) -> ClipLabel:
        if self.clip_end_s <= self.clip_start_s:
            raise ValueError("label clip end must follow start")
        if self.provenance == "recorded" and self.reviewer.lower() in ("placeholder", "pending"):
            raise ValueError("recorded labels require an identified reviewer")
        if self.reviewer_kind == "ai" and (not self.review_method or not self.review_notes):
            raise ValueError("AI reference labels require explicit review method and notes")
        return self


class Prediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sample_id: str = Field(min_length=1)
    source_segment_id: str = Field(min_length=1)
    method: Literal["structured", "verified"]
    assertion: Literal["present", "clear", "unclear"]
    support: Literal["supported", "uncertain", "contradicted"]
    model_id: str = Field(min_length=1)
    prompt_version: str = Field(min_length=1)
    model_call_count: int = Field(ge=0)
    latency_ms: float = Field(ge=0, allow_inf_nan=False)
    provenance: Literal["recorded", "cached_recorded", "synthetic"]


def _boolean(value: str) -> bool:
    if value not in ("true", "false"):
        raise ValueError("CSV booleans must be true or false")
    return value == "true"


def load_labels(path: Path) -> tuple[list[ClipLabel], int]:
    labels: list[ClipLabel] = []
    pending = 0
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            status = row.pop("status")
            row.pop("selection_hint", None)
            if status == "pending":
                pending += 1
                continue
            if status != "reviewed":
                raise ValueError("label status must be pending or reviewed")
            labels.append(
                ClipLabel.model_validate(
                    {
                        **row,
                        "negated_caption": _boolean(row["negated_caption"]),
                        "development_overlap": _boolean(row["development_overlap"]),
                    }
                )
            )
    if len({label.sample_id for label in labels}) != len(labels):
        raise ValueError("duplicate labelled sample")
    return labels, pending


def load_predictions(path: Path | None) -> list[Prediction]:
    if path is None:
        return []
    return [
        Prediction.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def keyword_prediction(caption: str) -> Label:
    """Deliberately naive comparison baseline; negation errors are counted."""
    return (
        "present"
        if re.search(r"\b(blocked|blocking|obstruction|obstructed)\b", caption, re.IGNORECASE)
        else "absent"
    )


def predicted_label(prediction: Prediction) -> Label:
    if prediction.support != "supported" or prediction.assertion == "unclear":
        return "uncertain"
    # This scores visual absence only. It NEVER creates an engine clearance event.
    return "present" if prediction.assertion == "present" else "absent"


def evaluate_extraction(labels: list[ClipLabel], predictions: list[Prediction]) -> dict:
    human_count = sum(
        row.provenance == "recorded" and row.reviewer_kind == "human" for row in labels
    )
    ai_count = sum(row.provenance == "recorded" and row.reviewer_kind == "ai" for row in labels)
    if human_count and ai_count:
        raise ValueError("evaluate human ground truth and AI reference labels separately")
    by_id = {label.sample_id: label for label in labels}
    if len(by_id) != len(labels):
        raise ValueError("duplicate labelled sample")
    if len(
        {(row.ride_id, row.source_segment_id, row.clip_start_s, row.clip_end_s) for row in labels}
    ) != len(labels):
        raise ValueError("same clip labelled repeatedly under different sample IDs")
    indexed: dict[tuple[str, str], Prediction] = {}
    for prediction in predictions:
        key = (prediction.sample_id, prediction.method)
        if key in indexed:
            raise ValueError("duplicate prediction")
        if prediction.sample_id not in by_id:
            raise ValueError("prediction has no reviewed label")
        label = by_id[prediction.sample_id]
        if prediction.source_segment_id != label.source_segment_id:
            raise ValueError("prediction source does not match label")
        if label.provenance == "recorded" and prediction.provenance == "synthetic":
            raise ValueError("synthetic predictions cannot be evaluated as recorded inference")
        if label.provenance == "synthetic" and prediction.provenance != "synthetic":
            raise ValueError("real inference provenance cannot be assigned to synthetic labels")
        indexed[key] = prediction
    report: dict = {
        "sample_size": len(labels),
        "recorded_sample_size": sum(label.provenance == "recorded" for label in labels),
        "synthetic_sample_size": sum(label.provenance == "synthetic" for label in labels),
        "human_reviewed_sample_size": human_count,
        "ai_reviewed_sample_size": ai_count,
        "human_ground_truth_metrics_available": human_count > 0,
        "development_overlap_count": sum(label.development_overlap for label in labels),
        "held_out_claim": False,
        "methods": {},
    }
    for method in ("keyword", "structured", "verified"):
        tp = fp = fn = correct = negation_fp = available = abstentions = calls = 0
        latency_ms = 0.0
        model_versions: set[tuple[str, str]] = set()
        for label in labels:
            prediction = indexed.get((label.sample_id, method))
            if method == "keyword":
                answer = keyword_prediction(label.caption)
                available += 1
            elif prediction is None:
                answer = "uncertain"
            else:
                answer = predicted_label(prediction)
                available += 1
                calls += prediction.model_call_count
                latency_ms += prediction.latency_ms
                model_versions.add((prediction.model_id, prediction.prompt_version))
            tp += label.expected == "present" and answer == "present"
            fp += label.expected != "present" and answer == "present"
            fn += label.expected == "present" and answer != "present"
            correct += label.expected == answer and (method == "keyword" or prediction is not None)
            negation_fp += (
                label.negated_caption and label.expected != "present" and answer == "present"
            )
            abstentions += answer == "uncertain"
        report["methods"][method] = {
            "status": "complete"
            if available == len(labels) and labels
            else ("partial" if available else "unavailable"),
            "available_predictions": available,
            "missing_predictions": len(labels) - available,
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
            "accuracy": correct / len(labels) if labels and available else None,
            "false_positives_from_negation": negation_fp,
            "uncertain_or_missing_predictions": abstentions,
            "model_call_count": calls,
            "total_latency_ms": latency_ms,
            "mean_latency_ms": latency_ms / available if available else None,
            "model_prompt_versions": [list(version) for version in sorted(model_versions)],
        }
        if ai_count:
            metrics = report["methods"][method]
            reference_keys = (
                "true_positives",
                "false_positives",
                "false_negatives",
                "precision",
                "recall",
                "accuracy",
                "false_positives_from_negation",
            )
            reference = {key: metrics[key] for key in reference_keys}
            reference["label_agreement"] = reference.pop("accuracy")
            metrics["ai_visual_reference"] = reference
            metrics["metric_basis"] = "AI sampled-frame review; not human ground truth"
            # Keep conventional accuracy fields unavailable for AI-only reviews.
            for key in reference_keys:
                metrics[key] = None
    return report


def save_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
