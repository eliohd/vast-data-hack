"""D-owned integration tests against A's committed canonical models/fixtures."""

import json
from pathlib import Path

import pytest

from app.agent.hazards import build_engine
from app.agent.interfaces import HazardEngine
from app.agent.models import (
    Observation,
    Rider,
    RouteCandidate,
    SessionConfig,
    Verification,
)
from app.agent.scoring import score_routes

FIXTURES = Path(__file__).parents[1] / "fixtures" / "rideahead"


def shared_observations() -> list[Observation]:
    raw = json.loads((FIXTURES / "observations.json").read_text(encoding="utf-8"))
    scenario = json.loads((FIXTURES / "scenario.json").read_text(encoding="utf-8"))
    return [
        Observation.model_validate(row)
        for row in (*raw["observations"], *scenario["synthetic_observations"])
    ]


def shared_routes() -> list[RouteCandidate]:
    raw = json.loads((FIXTURES / "routes.json").read_text(encoding="utf-8"))
    return [RouteCandidate.model_validate(row) for row in raw["routes"]]


def test_frozen_protocol_and_shared_fixture_lifecycle() -> None:
    config = SessionConfig()
    config.hazard_types["lane_blocked"].persistence.stale_after_s = 240
    engine = build_engine(config)
    assert isinstance(engine, HazardEngine)
    for observation in shared_observations():
        engine.ingest(observation)
    assert engine.snapshot(59) == []
    assert engine.snapshot(60)[0].state == "observed"
    assert engine.snapshot(70)[0].last_supported_s == 60
    assert engine.snapshot(330)[0].state == "stale"
    assert engine.snapshot(450)[0].state == "cleared"
    assert engine.snapshot(450)[0].clearance_evidence_id == "ev-syn-clear-001"
    assert engine.snapshot(60)[0].clearance_evidence_id is None


def test_canonical_inputs_and_outputs_cannot_mutate_history() -> None:
    observation = shared_observations()[0]
    engine = build_engine(SessionConfig())
    engine.ingest(observation)
    observation.location.road_segment_id = "mutated"
    first = engine.snapshot(60)[0]
    first.observation_ids.clear()
    first.location.road_segment_id = "also-mutated"
    assert engine.snapshot(60)[0].observation_ids == ["obs-fx-001"]
    assert engine.snapshot(60)[0].location.road_segment_id == "southwark-st:eb"


def test_canonical_scoring_uses_costs_and_real_evidence_identifiers() -> None:
    config = SessionConfig()
    config.hazard_types["lane_blocked"].expected_delay_s = 180
    engine = build_engine(config)
    engine.ingest(shared_observations()[0])
    rider = Rider(rider_id="bike_b", label="B", simulated=True, active_route_id="fx-primary")
    decision = engine.score_routes(shared_routes(), rider, engine.snapshot(60), config, 60)
    assert decision.action == "reroute"
    assert decision.selected_route_id == "fx-alt-union-st"
    assert decision.evidence_ids == ["ev-fx-001"]
    assert "obs-fx-001" not in decision.evidence_ids
    assert decision.revision == 0 and not decision.changed


def test_default_fixture_delay_does_not_justify_more_expensive_detour() -> None:
    config = SessionConfig()
    engine = build_engine(config)
    engine.ingest(shared_observations()[0])
    rider = Rider(rider_id="B", label="B", simulated=True, active_route_id="fx-primary")
    decision = engine.score_routes(shared_routes(), rider, engine.snapshot(60), config, 60)
    assert decision.action == "heads_up"  # report 520 m away; short radius is 200 m
    assert decision.selected_route_id == "fx-primary"


def test_detached_canonical_hazards_never_mislabel_observation_ids_as_evidence() -> None:
    config = SessionConfig()
    engine = build_engine(config)
    engine.ingest(shared_observations()[0])
    rider = Rider(rider_id="B", label="B", simulated=True, active_route_id="fx-primary")
    decision = score_routes(shared_routes(), rider, engine.snapshot(60), config, 60)
    assert decision.evidence_ids == []
    assert any("evidence IDs unavailable" in item for item in decision.assumptions)


def test_recorded_clearance_requires_visible_clear_road_space() -> None:
    present, _, clearance = shared_observations()
    clearance.source = "live_model"
    for evidence in clearance.evidence:
        evidence.provenance = "recorded"
    engine = build_engine(SessionConfig())
    engine.ingest(present)
    engine.ingest(clearance)
    assert engine.snapshot(450)[0].state == "disputed"
    engine.reset()
    clearance.verification = Verification(
        evidence_id=clearance.evidence[0].evidence_id,
        question="Affected area clear?",
        verdict="supported",
        road_space_visible=True,
        obstruction_visible=False,
        source="live_model",
    )
    engine.ingest(present)
    engine.ingest(clearance)
    assert engine.snapshot(450)[0].state == "cleared"


def test_canonical_opposite_direction_clearance_does_not_clear() -> None:
    first, _, clear = shared_observations()
    clear.location.road_segment_id = "southwark-st:wb"
    clear.location.bearing_deg = 272
    engine = build_engine(SessionConfig())
    engine.ingest(first)
    engine.ingest(clear)
    assert engine.snapshot(450)[0].state != "cleared"


def test_disconnected_alternative_is_not_a_teleport() -> None:
    config = SessionConfig()
    config.hazard_types["lane_blocked"].expected_delay_s = 300
    engine = build_engine(config)
    engine.ingest(shared_observations()[0])
    routes = shared_routes()
    routes[1].geometry.coordinates = [[-0.11, 51.51], [-0.088, 51.505]]
    from app.agent.models import LatLon

    rider = Rider(
        rider_id="B",
        label="B",
        simulated=True,
        active_route_id="fx-primary",
        position=LatLon(lat=51.5058, lon=-0.105),
    )
    assert engine.score_routes(routes, rider, engine.snapshot(60), config, 60).action != "reroute"


def test_reused_canonical_id_with_changed_payload_rejected() -> None:
    engine = build_engine(SessionConfig())
    first = shared_observations()[0]
    engine.ingest(first)
    first.description = "changed after original event"
    with pytest.raises(ValueError, match="reused"):
        engine.ingest(first)


def test_canonical_unmapped_location_is_uncertain_instead_of_safe() -> None:
    first = shared_observations()[0]
    first.location.lat = first.location.lon = None
    config = SessionConfig()
    engine = build_engine(config)
    engine.ingest(first)
    rider = Rider(rider_id="B", label="B", simulated=True, active_route_id="fx-primary")
    assert (
        engine.score_routes(shared_routes(), rider, engine.snapshot(60), config, 60).action
        == "heads_up"
    )
