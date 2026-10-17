"""D: replay real cached evidence without treating model agreement as ground truth."""

import json
from pathlib import Path

from app.agent.hazards import build_engine
from app.agent.models import Observation, SessionConfig

SCENARIO = Path(__file__).parents[1] / "fixtures/rideahead/scenario_broadway.json"


def _observations() -> list[Observation]:
    scenario = json.loads(SCENARIO.read_text(encoding="utf-8"))
    return [Observation.model_validate(row) for row in scenario["cached_observations"]]


def test_recorded_work_zone_replay_has_no_future_evidence_or_duplicate_refresh() -> None:
    first, later = _observations()
    engine = build_engine(SessionConfig())
    # Store future evidence first: historical snapshots must still exclude it.
    engine.ingest(later)
    engine.ingest(first)
    assert engine.snapshot(first.session_time_s - 1) == []
    observed = engine.snapshot(first.session_time_s)[0]
    assert observed.state == "observed"
    assert observed.observation_ids == [first.observation_id]
    assert observed.last_supported_s == first.session_time_s

    # A repeated inference over the same source cannot create a second witness
    # or refresh the clock, even under a new observation ID and receipt time.
    engine.ingest(
        first.model_copy(
            update={"observation_id": "same-clip-reprocessed", "session_time_s": 100.0}
        )
    )
    replayed = engine.snapshot(100)[0]
    assert replayed.last_supported_s == first.session_time_s
    assert replayed.state == "observed"
    assert replayed.confirmation_kind is None


def test_same_street_camera_supports_persistence_and_never_implies_clearance() -> None:
    first, later = _observations()
    assert first.observer_id == later.observer_id
    assert first.evidence[0].camera_id == later.evidence[0].camera_id
    assert first.evidence[0].segment_id != later.evidence[0].segment_id
    engine = build_engine(SessionConfig())
    engine.ingest(first)
    engine.ingest(later)
    confirmed = engine.snapshot(later.session_time_s)[0]
    assert confirmed.state == "confirmed"
    assert confirmed.confirmation_kind == "persistence"
    assert confirmed.evidence_strength == "moderate"
    assert confirmed.clearance_evidence_id is None

    stale = engine.snapshot(later.session_time_s + confirmed.persistence.stale_after_s)[0]
    assert stale.state == "stale"
    assert stale.last_supported_s == later.session_time_s
    assert stale.clearance_evidence_id is None
