"""Small offline engine integration example; every event and route is synthetic."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.agent.hazards import build_engine
from app.agent.models import Observation, Rider, RouteCandidate, SessionConfig
from eval.extraction import save_report


def demo_snapshot() -> dict:
    shared = Path(__file__).parents[1] / "fixtures" / "rideahead"
    source = json.loads((shared / "observations.json").read_text(encoding="utf-8"))
    scenario = json.loads((shared / "scenario.json").read_text(encoding="utf-8"))
    config = SessionConfig()
    config.hazard_types["lane_blocked"].persistence.stale_after_s = 240
    config.hazard_types["lane_blocked"].persistence.half_life_s = 240
    config.hazard_types["lane_blocked"].persistence.version = "D-synthetic-cost-demo-v1"
    config.hazard_types["lane_blocked"].expected_delay_s = 180
    engine = build_engine(config)
    for row in (*source["observations"], *scenario["synthetic_observations"]):
        engine.ingest(Observation.model_validate(row))
    routes = [
        RouteCandidate.model_validate(row)
        for row in json.loads((shared / "routes.json").read_text(encoding="utf-8"))["routes"]
    ]
    rider = Rider(
        rider_id="bike_b",
        label="Stationary simulated Bike B",
        simulated=True,
        active_route_id="fx-primary",
    )
    snapshots = []
    for when in (60, 330, 450):
        hazards = engine.snapshot(when)
        decision = engine.score_routes(routes, rider, hazards, config, when)
        decision.session_time_s = when  # the demo harness acts as the replay-clock owner
        snapshots.append(
            {
                "now_s": when,
                "hazards": [h.model_dump(mode="json") for h in hazards],
                "decision": decision.model_dump(mode="json"),
            }
        )
    return {
        "schema_version": "1",
        "contract_status": "Integrated with A canonical bootstrap 5b43e3f",
        "provenance": "synthetic",
        "recorded_footage": False,
        "assumptions": [
            "Stationary simulated rider; synthetic clearance; fixture routes.",
            "180 s obstruction delay and compressed freshness are demo assumptions.",
        ],
        "snapshots": snapshots,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = demo_snapshot()
    if args.output:
        save_report(args.output, report)
        print(f"Synthetic engine demo: {args.output}")
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
