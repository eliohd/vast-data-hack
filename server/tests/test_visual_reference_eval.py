from pathlib import Path

import pytest
from pydantic import ValidationError

from eval.extraction import ClipLabel, evaluate_extraction, load_labels
from eval.run import FIXTURES, build_report
from eval.weave_publish import evaluation_rows

CACHE = FIXTURES.parents[1] / "fixtures/rideahead/cache/model_outputs_v2.json"


def test_ai_reference_agreement_does_not_become_human_accuracy() -> None:
    report, labels, predictions = build_report(
        FIXTURES / "clip_labels.ai.csv", model_cache_path=CACHE
    )
    assert len(labels) == 10 and len(predictions) == 20
    metrics = report["video_interpretation"]
    assert metrics["ai_reviewed_sample_size"] == 10
    assert metrics["human_reviewed_sample_size"] == 0
    assert metrics["human_ground_truth_metrics_available"] is False
    for method in metrics["methods"].values():
        assert method["accuracy"] is None
        assert method["precision"] is None
        assert method["recall"] is None
        assert method["ai_visual_reference"]["recall"] is None  # No positive control.
        assert method["ai_visual_reference"]["label_agreement"] is not None
    assert all(row["reference_kind"] == "ai" for row in evaluation_rows(labels, [], "keyword"))


def test_ai_labels_cannot_omit_method_and_review_notes() -> None:
    labels, _ = load_labels(FIXTURES / "clip_labels.ai.csv")
    values = labels[0].model_dump()
    values["review_notes"] = None
    with pytest.raises(ValidationError, match="explicit review method and notes"):
        ClipLabel.model_validate(values)


def test_mixed_human_and_ai_reference_metrics_are_rejected() -> None:
    labels, _ = load_labels(FIXTURES / "clip_labels.ai.csv")
    human = labels[1].model_copy(update={"reviewer_kind": "human"})
    with pytest.raises(ValueError, match="separately"):
        evaluate_extraction([labels[0], human], [])


def test_human_sheet_remains_unreviewed() -> None:
    labels, pending = load_labels(FIXTURES / "clip_labels.pending.csv")
    assert labels == [] and pending == 10
    assert Path(FIXTURES / "clip_labels.ai.csv").is_file()


def test_unrelated_denial_is_not_target_obstruction_negation() -> None:
    labels, _ = load_labels(FIXTURES / "clip_labels.ai.csv")
    assert {row.sample_id for row in labels if row.negated_caption} == {"gx010001-c03-s1"}
    report = evaluate_extraction(labels, [])
    keyword = report["methods"]["keyword"]["ai_visual_reference"]
    assert keyword["false_positives_from_negation"] == 1
