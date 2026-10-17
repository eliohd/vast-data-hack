import csv
import json
from pathlib import Path

import pytest

from eval.cached_predictions import load_model_cache
from eval.extraction import predicted_label
from eval.run import FIXTURES, build_report

CACHE = FIXTURES.parents[1] / "fixtures/rideahead/cache/model_outputs_v2.json"
LABELS = FIXTURES / "clip_labels.pending.csv"


def test_real_cache_deduplicates_samples_but_preserves_all_executed_calls() -> None:
    predictions, coverage = load_model_cache(CACHE, LABELS)
    assert len(predictions) == 20
    assert len({(p.sample_id, p.method) for p in predictions}) == 20
    assert coverage["shortlist_size"] == coverage["covered_shortlist_sources"] == 10
    assert coverage["duplicate_attempts_excluded_from_scoring"] == 1
    assert coverage["executed_calls"] == {"structured": 11, "cosmos": 11}
    assert sum(p.model_call_count for p in predictions if p.method == "structured") == 10
    assert sum(p.model_call_count for p in predictions if p.method == "verified") == 20
    assert all(p.provenance == "cached_recorded" for p in predictions)


def test_model_disagreement_and_unclear_extraction_abstain_without_using_frame_reviews() -> None:
    predictions, _ = load_model_cache(CACHE, LABELS)
    indexed = {(p.sample_id, p.method): predicted_label(p) for p in predictions}
    # C16-s2: extraction says clear, Cosmos supports obstruction. Never call it clear.
    assert indexed["gx010001-c16-s2", "structured"] == "absent"
    assert indexed["gx010001-c16-s2", "verified"] == "uncertain"
    # C14-s3: Cosmos positive cannot promote an uncertain extraction.
    assert indexed["gx010001-c14-s3", "verified"] == "uncertain"
    # C15-s1: both models positive. C's conflicting frame review must not be
    # injected into the method under evaluation to improve apparent accuracy.
    assert indexed["gx010001-c15-s1", "verified"] == "present"
    # Agreement on visible absence is an extraction result, never hazard clearance.
    assert indexed["gx010001-c03-s1", "verified"] == "absent"


def test_pending_footage_has_prediction_coverage_but_no_fabricated_accuracy() -> None:
    report, labels, predictions = build_report(LABELS, model_cache_path=CACHE)
    assert labels == predictions == []
    assert report["cached_prediction_coverage"]["covered_shortlist_sources"] == 10
    assert report["cached_prediction_coverage"]["reviewed_sources_scored"] == 0
    assert report["pending_clip_labels"] == 10
    assert report["video_interpretation"]["recorded_sample_size"] == 0
    assert all(m["accuracy"] is None for m in report["video_interpretation"]["methods"].values())
    assert report["lifecycle"]["passed"] == 21


def test_first_attempt_is_selected_without_cherry_picking(tmp_path: Path) -> None:
    cache = json.loads(CACHE.read_text(encoding="utf-8"))
    later = cache["results"][-1]
    assert later["segment_id"] == "gx010001-c14-s3"
    later["extraction"]["parsed"] = {"assertion": "present", "support": "supported"}
    path = tmp_path / "cache.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    predictions, _ = load_model_cache(path, LABELS)
    selected = next(
        p for p in predictions if p.sample_id == later["segment_id"] and p.method == "structured"
    )
    assert predicted_label(selected) == "uncertain"


def test_conflicting_source_identity_or_caption_is_rejected(tmp_path: Path) -> None:
    cache = json.loads(CACHE.read_text(encoding="utf-8"))
    cache["results"][-1]["segment_file"] = "different-video.mp4"
    path = tmp_path / "cache.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    with pytest.raises(ValueError, match="conflicting media"):
        load_model_cache(path, LABELS)
    with LABELS.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    rows[0]["caption"] = "A different model input"
    sheet = tmp_path / "labels.csv"
    with sheet.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with pytest.raises(ValueError, match="caption does not match"):
        load_model_cache(CACHE, sheet)


def test_reviewed_subset_scores_only_matching_sources(tmp_path: Path) -> None:
    # Authored fixture labels exercise selection; never save these as real reviews.
    with LABELS.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    rows[0].update(
        status="reviewed", expected="absent", reviewer="test-fixture", reviewed_at="2026-10-17"
    )
    path = tmp_path / "labels.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    report, _, predictions = build_report(path, model_cache_path=CACHE)
    assert report["cached_prediction_coverage"]["reviewed_sources_scored"] == 1
    assert report["pending_clip_labels"] == 9
    assert len(predictions) == 2
    assert (
        report["video_interpretation"]["methods"]["keyword"]["false_positives_from_negation"] == 1
    )
    assert report["video_interpretation"]["methods"]["verified"]["accuracy"] == 1
