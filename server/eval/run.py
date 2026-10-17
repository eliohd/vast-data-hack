"""Run with `uv run python -m eval.run --help` from server/."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from eval.cached_predictions import load_model_cache
from eval.extraction import (
    ClipLabel,
    Prediction,
    evaluate_extraction,
    load_labels,
    load_predictions,
    save_report,
)
from eval.lifecycle import evaluate_lifecycle

FIXTURES = Path(__file__).parent / "fixtures"


def build_report(
    labels_path: Path,
    predictions_path: Path | None = None,
    model_cache_path: Path | None = None,
) -> tuple[dict, list[ClipLabel], list[Prediction]]:
    labels, pending = load_labels(labels_path)
    predictions = load_predictions(predictions_path)
    coverage = None
    if model_cache_path is not None:
        if predictions_path is not None:
            raise ValueError("select predictions JSONL or C's model cache, not both")
        cached, coverage = load_model_cache(model_cache_path, labels_path)
        reviewed_ids = {row.sample_id for row in labels}
        predictions = [row for row in cached if row.sample_id in reviewed_ids]
        coverage["reviewed_sources_scored"] = len({row.sample_id for row in predictions})
    report = {
        "schema_version": "1",
        "publication": {"status": "local_only"},
        "video_interpretation": evaluate_extraction(labels, predictions),
        "pending_clip_labels": pending,
        "lifecycle": evaluate_lifecycle(FIXTURES / "lifecycle_scenarios.json"),
    }
    if coverage is not None:
        report["cached_prediction_coverage"] = coverage
    return report, labels, predictions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, default=FIXTURES / "clip_labels.pending.csv")
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument("--predictions", type=Path)
    inputs.add_argument("--model-cache", type=Path, help="C's saved model_outputs_v2.json")
    parser.add_argument(
        "--synthetic", action="store_true", help="Use caption fixtures, not footage"
    )
    parser.add_argument("--output", type=Path, default=Path("eval/reports/latest.json"))
    parser.add_argument(
        "--publish-weave", action="store_true", help="Use configured W&B credentials"
    )
    args = parser.parse_args()
    labels_path = FIXTURES / "synthetic_captions.csv" if args.synthetic else args.labels
    report, labels, predictions = build_report(labels_path, args.predictions, args.model_cache)
    # Save before trying publication so upstream failure cannot lose local results.
    save_report(args.output, report)
    if args.publish_weave:
        from eval.weave_publish import publish_evaluations

        report["publication"] = asyncio.run(publish_evaluations(report, labels, predictions))
        save_report(args.output, report)
    print(f"Lifecycle: {report['lifecycle']['passed']}/{report['lifecycle']['sample_size']} passed")
    print(
        f"Human-reviewed clips: {report['video_interpretation']['human_reviewed_sample_size']}; "
        f"AI-reviewed clips: {report['video_interpretation']['ai_reviewed_sample_size']}; "
        f"synthetic captions: {report['video_interpretation']['synthetic_sample_size']}; "
        f"pending labels: {report['pending_clip_labels']}"
    )
    print(f"Publication: {report['publication']['status']}. Report: {args.output}")
    return 0 if report["lifecycle"]["passed"] == report["lifecycle"]["sample_size"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
