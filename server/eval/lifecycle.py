"""Explicit simulated scenario truth, separate from persistence assumptions."""

from __future__ import annotations

import json
from pathlib import Path

from app.agent.hazard_engine import HazardEngine
from app.agent.hazard_types import (
    DecisionConfig,
    Evidence,
    Location,
    Observation,
    Rider,
    Route,
    RoutePassage,
)
from app.agent.route_scoring import score_routes


def scenario_observation(row: dict) -> Observation:
    """Construct only explicitly synthetic development fixtures."""
    when = row["time_s"]
    source_when = row.get("source_time_s", when)
    oid = row["id"]
    observer = row.get("observer", "A")
    group = row.get("source_group", "synthetic-ride-a")
    evidence = Evidence(
        evidence_id=row.get("evidence_id", f"e-{oid}"),
        ride_id=group,
        segment_id=row.get("segment_id", f"synthetic-segment-{oid}"),
        camera_id=observer,
        clip_start_s=0,
        clip_end_s=2,
        ride_offset_s=source_when,
        available_at_s=source_when,
        provenance="synthetic",
        affected_area_visible=row.get("affected_area_visible", False),
    )
    return Observation(
        observation_id=oid,
        hazard_type="lane_blocked",
        assertion=row.get("assertion", "present"),
        support=row.get("support", "supported"),
        location=Location(
            directed_road_id=row.get("road", "synthetic-road-east"),
            lat=row.get("lat"),
            lon=row.get("lon"),
            bearing_deg=row.get("bearing", 90),
            uncertainty_m=5,
            method="manual_anchor",
            notes="Synthetic scenario, no recorded geography",
        ),
        observer_id=observer,
        source_group_id=group,
        session_time_s=when,
        ride_offset_s=source_when,
        evidence=(evidence,),
    )


def evaluate_lifecycle(path: Path) -> dict:
    scenarios = json.loads(path.read_text(encoding="utf-8"))
    results: list[dict] = []
    for scenario in scenarios:
        engine = HazardEngine()
        for event in scenario["observations"]:
            engine.ingest(scenario_observation(event))
        now_s = scenario["as_of_s"]
        hazards = engine.snapshot(now_s)
        states = sorted(h.state for h in hazards)
        direct = Route("direct", 300, 1000, (RoutePassage("synthetic-road-east", 100, 30, 90),))
        detour = Route("detour", 330, 1100, (RoutePassage("synthetic-parallel-east", 100, 30, 90),))
        routes = (direct, detour) if scenario.get("detour", True) else (direct,)
        if scenario.get("provider_unavailable", False):
            routes = ()
        rider = Rider(
            "B",
            "direct",
            progress_m=scenario.get("rider_progress_m", 0),
            elapsed_route_s=scenario.get("rider_elapsed_s", 0),
        )
        decision = score_routes(routes, rider, hazards, DecisionConfig(), now_s)
        expected_states = sorted(scenario["expected_states"])
        passed = states == expected_states and decision.action == scenario["expected_action"]
        strengths = sorted(h.evidence_strength for h in hazards)
        expected_strengths = scenario.get("expected_strengths")
        if expected_strengths is not None:
            passed = passed and strengths == sorted(expected_strengths)
        # Exercise reset/replay without deriving labels from the implementation.
        original = hazards
        engine.reset()
        for event in reversed(scenario["observations"]):
            engine.ingest(scenario_observation(event))
        replay_equal = engine.snapshot(now_s) == original
        results.append(
            {
                "scenario_id": scenario["id"],
                "passed": passed and replay_equal,
                "expected_states": expected_states,
                "actual_states": states,
                "expected_action": scenario["expected_action"],
                "actual_action": decision.action,
                "expected_strengths": expected_strengths,
                "actual_strengths": strengths,
                "reset_replay_equal": replay_equal,
                "provenance": "synthetic",
            }
        )
    return {
        "sample_size": len(results),
        "passed": sum(r["passed"] for r in results),
        "ground_truth": "explicit synthetic scenario labels; not persistence-model output",
        "results": results,
    }
