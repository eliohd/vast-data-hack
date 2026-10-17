import json
import os
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings
from eval.demo import demo_snapshot
from eval.extraction import (
    ClipLabel,
    Prediction,
    evaluate_extraction,
    load_labels,
    load_predictions,
    save_report,
)
from eval.lifecycle import evaluate_lifecycle
from eval.run import FIXTURES
from eval.weave_publish import evaluation_rows, publish_evaluations


def label(sample: str = "sample", expected: str = "present", **kwargs) -> ClipLabel:
    return ClipLabel.model_validate(
        {
            "sample_id": sample,
            "source_segment_id": f"segment-{sample}",
            "ride_id": "ride",
            "clip_start_s": 0,
            "clip_end_s": 2,
            "caption": "The lane is blocked.",
            "expected": expected,
            "negated_caption": False,
            "reviewer": "synthetic-author",
            "reviewed_at": "2026-10-17",
            "development_overlap": True,
            "provenance": "synthetic",
            **kwargs,
        }
    )


def prediction(sample: str = "sample", assertion: str = "present", **kwargs) -> Prediction:
    return Prediction.model_validate(
        {
            "sample_id": sample,
            "source_segment_id": f"segment-{sample}",
            "method": "structured",
            "assertion": assertion,
            "support": "supported",
            "model_id": "fixture-model",
            "prompt_version": "fixture-v1",
            "model_call_count": 1,
            "latency_ms": 20,
            "provenance": "synthetic",
            **kwargs,
        }
    )


def test_all_explicit_simulator_cases_pass() -> None:
    report = evaluate_lifecycle(FIXTURES / "lifecycle_scenarios.json")
    assert report["sample_size"] >= 12
    assert report["passed"] == report["sample_size"]
    assert all(row["reset_replay_equal"] for row in report["results"])


def test_demo_connects_engine_and_scoring_without_future_clearance_leakage() -> None:
    demo = demo_snapshot()
    assert demo["provenance"] == "synthetic"
    snapshots = demo["snapshots"]
    assert [row["hazards"][0]["state"] for row in snapshots] == ["observed", "stale", "cleared"]
    assert snapshots[0]["hazards"][0]["clearance_evidence_id"] is None
    assert snapshots[2]["decision"]["action"] == "continue"


def test_pending_sheet_is_not_fabricated_human_evaluation() -> None:
    labels, pending = load_labels(FIXTURES / "clip_labels.pending.csv")
    assert labels == []
    assert pending == 10
    report = evaluate_extraction(labels, [])
    assert report["recorded_sample_size"] == 0
    assert report["methods"]["structured"]["precision"] is None


def test_synthetic_captions_do_not_count_as_recorded_clips() -> None:
    labels, pending = load_labels(FIXTURES / "synthetic_captions.csv")
    assert len(labels) == 12 and pending == 0
    report = evaluate_extraction(labels, [])
    assert report["recorded_sample_size"] == 0
    assert report["synthetic_sample_size"] == 12
    assert report["methods"]["keyword"]["false_positives_from_negation"] == 2
    assert report["methods"]["structured"]["status"] == "unavailable"
    assert report["methods"]["structured"]["accuracy"] is None


def test_known_confusion_matrix_and_latency() -> None:
    labels = [
        label("p1"),
        label("p2"),
        label("negative", "absent", negated_caption=True),
        label("unknown", "uncertain"),
    ]
    predictions = [
        prediction("p1"),
        prediction("p2", "unclear"),
        prediction("negative"),
        prediction("unknown", "unclear"),
    ]
    metrics = evaluate_extraction(labels, predictions)["methods"]["structured"]
    assert metrics["true_positives"] == 1
    assert metrics["false_positives"] == 1
    assert metrics["false_negatives"] == 1
    assert metrics["precision"] == 0.5 and metrics["recall"] == 0.5
    assert metrics["false_positives_from_negation"] == 1
    assert metrics["accuracy"] == 0.5
    assert metrics["model_call_count"] == 4 and metrics["total_latency_ms"] == 80
    assert metrics["mean_latency_ms"] == 20


def test_missing_predictions_are_not_scored_as_correct_uncertain_answers() -> None:
    labels = [label("p"), label("u", "uncertain")]
    report = evaluate_extraction(labels, [prediction("p")])
    metrics = report["methods"]["structured"]
    assert metrics["status"] == "partial"
    assert metrics["accuracy"] == 0.5
    assert metrics["missing_predictions"] == 1


def test_contradicted_present_is_uncertain_not_false_obstruction() -> None:
    report = evaluate_extraction(
        [label(expected="uncertain")], [prediction(support="contradicted")]
    )
    assert report["methods"]["structured"]["false_positives"] == 0


def test_no_positive_examples_means_recall_is_null() -> None:
    report = evaluate_extraction([label(expected="absent")], [prediction(assertion="clear")])
    assert report["methods"]["structured"]["recall"] is None


@pytest.mark.parametrize("change", [{"source_segment_id": "wrong"}, {"sample_id": "unknown"}])
def test_source_or_sample_mismatch_rejected(change: dict) -> None:
    with pytest.raises(ValueError):
        evaluate_extraction([label()], [prediction(**change)])


def test_duplicate_predictions_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        evaluate_extraction([label()], [prediction(), prediction()])


def test_fixture_outputs_cannot_count_as_real_model_evaluation() -> None:
    real = label(provenance="recorded", reviewer="reviewed-by-person")
    with pytest.raises(ValueError, match="synthetic"):
        evaluate_extraction([real], [prediction()])


def test_unreviewed_or_invalid_recorded_labels_rejected() -> None:
    with pytest.raises(ValidationError):
        label(provenance="recorded", reviewer="pending")
    with pytest.raises(ValidationError):
        label(clip_end_s=-1)


def test_predictions_load_and_reports_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "predictions.jsonl"
    path.write_text(prediction().model_dump_json() + "\n", encoding="utf-8")
    assert load_predictions(path) == [prediction()]
    report = evaluate_extraction([label()], load_predictions(path))
    output = tmp_path / "nested" / "report.json"
    save_report(output, report)
    assert json.loads(output.read_text(encoding="utf-8")) == report


def test_publication_rows_exclude_captions_reviewers_and_media_urls() -> None:
    row = label(
        source_segment_id="https://upstream/video?token=must-not-leak",
        caption="Private caption",
        reviewer="Private reviewer",
    )
    encoded = json.dumps(evaluation_rows([row], [], "keyword"))
    assert "must-not-leak" not in encoded
    assert "Private" not in encoded
    assert "https" not in encoded
    assert "source_key" in encoded


async def test_unconfigured_weave_is_honestly_local() -> None:
    settings = Settings(wandb_api_key=SecretStr(""), tracing=False)
    assert await publish_evaluations({}, [], [], settings) == {
        "status": "local_only_not_configured",
    }


async def test_weave_evaluations_execute_locally_without_claiming_remote_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import weave

    finished = []

    class LocalClient:
        def finish(self, use_progress_bar: bool = True) -> None:
            finished.append(True)

    monkeypatch.setattr(weave, "init", lambda *args, **kwargs: LocalClient())
    # No global client is created. Run actual SDK Evaluation/Scorer semantics locally.
    monkeypatch.setenv("WEAVE_DISABLED", "true")
    monkeypatch.setenv("WANDB_API_KEY", "previous-test-value")
    settings = Settings(
        wandb_api_key=SecretStr("fixture-key"),
        wandb_team="fixture",
        wandb_project="offline",
        tracing=True,
    )
    report = {
        "video_interpretation": evaluate_extraction([label()], [prediction()]),
        "lifecycle": evaluate_lifecycle(FIXTURES / "lifecycle_scenarios.json"),
    }
    status = await publish_evaluations(report, [label()], [prediction()], settings)
    assert status["status"] == "submitted_unverified"
    assert finished == [True]
    assert os.environ["WANDB_API_KEY"] == "previous-test-value"


async def test_publication_failure_preserves_local_results_and_hides_error_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import weave

    def fail(*args, **kwargs):
        raise RuntimeError("https://private/video?token=do-not-print")

    monkeypatch.setattr(weave, "init", fail)
    settings = Settings(
        wandb_api_key=SecretStr("fixture-key"),
        wandb_team="fixture",
        wandb_project="offline",
        tracing=True,
    )
    status = await publish_evaluations({}, [], [], settings)
    assert status == {"status": "local_only_publication_failed", "local_results_preserved": True}
    assert "do-not-print" not in json.dumps(status)
