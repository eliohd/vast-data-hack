"""Optional publication boundary; the engine itself never imports Weave."""

from __future__ import annotations

import os
from hashlib import sha256

from app.config import Settings
from eval.extraction import ClipLabel, Prediction, keyword_prediction, predicted_label


def evaluation_rows(
    labels: list[ClipLabel], predictions: list[Prediction], method: str
) -> list[dict]:
    """Publish only hashes, labels and saved predictions; never captions or media URLs."""
    indexed = {(p.sample_id, p.method): p for p in predictions}
    rows = []
    for label in labels:
        prediction = indexed.get((label.sample_id, method))
        available = method == "keyword" or prediction is not None
        answer = (
            keyword_prediction(label.caption)
            if method == "keyword"
            else (predicted_label(prediction) if prediction else "uncertain")
        )
        rows.append(
            {
                "sample_key": sha256(label.sample_id.encode()).hexdigest(),
                "source_key": sha256(label.source_segment_id.encode()).hexdigest(),
                "expected": label.expected,
                "saved_output": {"label": answer, "available": available},
                "provenance": label.provenance,
                "reference_kind": label.reviewer_kind
                if label.provenance == "recorded"
                else "synthetic",
            }
        )
    return rows


async def publish_evaluations(
    report: dict,
    labels: list[ClipLabel],
    predictions: list[Prediction],
    settings: Settings | None = None,
) -> dict:
    settings = settings or Settings()
    key = settings.wandb_api_key.get_secret_value()
    project = settings.wandb_entity_project
    if not settings.tracing or not key or not project:
        return {"status": "local_only_not_configured"}
    # Evaluation is a separate command, using the same configured credentials as the app.
    previous_key = os.environ.get("WANDB_API_KEY")
    os.environ["WANDB_API_KEY"] = key
    client = None
    try:
        import weave

        client = weave.init(
            project,
            settings={
                "capture_code": False,
                "capture_system_info": False,
                "implicitly_patch_integrations": False,
                "print_call_link": False,
                "http_timeout": 15,
                "retry_max_attempts": 1,
            },
        )

        @weave.op()
        def replay_saved_output(saved_output: dict) -> dict:
            return saved_output

        @weave.op()
        def label_correct(expected: str, output: dict) -> dict:
            return {"correct": output["available"] and expected == output["label"]}

        for method in ("keyword", "structured", "verified"):
            rows = evaluation_rows(labels, predictions, method)
            if not rows or not any(row["saved_output"]["available"] for row in rows):
                continue
            evaluation = weave.Evaluation(
                name=f"rideahead-{method}"
                + (
                    "-ai-visual-reference"
                    if any(row.reviewer_kind == "ai" for row in labels)
                    else ""
                ),
                dataset=weave.Dataset(rows=weave.Table(rows)),
                scorers=[label_correct],
            )
            await evaluation.evaluate(replay_saved_output)

        @weave.op()
        def scenario_correct(expected: str, output: dict) -> dict:
            return {"correct": expected == output["label"]}

        scenario_rows = [
            {
                "scenario_id": row["scenario_id"],
                "expected": "pass",
                "saved_output": {"label": "pass" if row["passed"] else "fail"},
                "provenance": "synthetic",
            }
            for row in report["lifecycle"]["results"]
        ]
        evaluation = weave.Evaluation(
            name="rideahead-synthetic-lifecycle",
            dataset=weave.Dataset(rows=weave.Table(scenario_rows)),
            scorers=[scenario_correct],
        )
        await evaluation.evaluate(replay_saved_output)

        @weave.op()
        def evaluation_summary(metrics: dict) -> dict:
            return metrics

        evaluation_summary(
            {
                "video_interpretation": report["video_interpretation"],
                "lifecycle_passed": report["lifecycle"]["passed"],
                "lifecycle_sample_size": report["lifecycle"]["sample_size"],
            }
        )
        client.finish(use_progress_bar=False)
        # Background SDK uploads do not provide a durable acknowledgement here.
        # Do not claim a verified remote publication without a read-back receipt.
        return {"status": "submitted_unverified", "local_results_preserved": True}
    except Exception:
        # Exception strings may include authenticated URLs; do not log/serialize them.
        return {"status": "local_only_publication_failed", "local_results_preserved": True}
    finally:
        if previous_key is None:
            os.environ.pop("WANDB_API_KEY", None)
        else:
            os.environ["WANDB_API_KEY"] = previous_key
