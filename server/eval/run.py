"""Run with `uv run python -m eval.run --help` from server/."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from eval.extraction import evaluate_extraction, load_labels, load_predictions, save_report
from eval.lifecycle import evaluate_lifecycle

FIXTURES = Path(__file__).parent / "fixtures"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, default=FIXTURES / "clip_labels.pending.csv")
    parser.add_argument("--predictions", type=Path)
    parser.add_argument(
        "--synthetic", action="store_true", help="Use caption fixtures, not footage"
    )
    parser.add_argument("--output", type=Path, default=Path("eval/reports/latest.json"))
    parser.add_argument(
        "--publish-weave", action="store_true", help="Use configured W&B credentials"
    )
    args = parser.parse_args()
    labels_path = FIXTURES / "synthetic_captions.csv" if args.synthetic else args.labels
    labels, pending = load_labels(labels_path)
    predictions = load_predictions(args.predictions)
    report = {
        "schema_version": "1",
        "publication": {"status": "local_only"},
        "video_interpretation": evaluate_extraction(labels, predictions),
        "pending_clip_labels": pending,
        "lifecycle": evaluate_lifecycle(FIXTURES / "lifecycle_scenarios.json"),
    }
    # Save before trying publication so upstream failure cannot lose local results.
    save_report(args.output, report)
    if args.publish_weave:
        from eval.weave_publish import publish_evaluations

        report["publication"] = asyncio.run(publish_evaluations(report, labels, predictions))
        save_report(args.output, report)
    print(f"Lifecycle: {report['lifecycle']['passed']}/{report['lifecycle']['sample_size']} passed")
    print(
        f"Reviewed recorded clips: {report['video_interpretation']['recorded_sample_size']}; "
        f"synthetic captions: {report['video_interpretation']['synthetic_sample_size']}; "
        f"pending labels: {pending}"
    )
    print(f"Publication: {report['publication']['status']}. Report: {args.output}")
    return 0 if report["lifecycle"]["passed"] == report["lifecycle"]["sample_size"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
