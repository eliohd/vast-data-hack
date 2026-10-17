from dataclasses import replace

import pytest

from app.agent.hazard_engine import HazardEngine
from app.agent.hazard_types import DecisionConfig, HazardPrior, Rider, Route, RoutePassage
from app.agent.route_scoring import score_routes
from tests.test_hazard_engine import LOCATION, observation

CURRENT = Route("direct", 300, 1000, (RoutePassage("road-east", 100, 30, 90),))
DETOUR = Route("detour", 330, 1100, (RoutePassage("parallel-east", 100, 30, 90),))
RIDER = Rider("B", "direct")
CONFIG = DecisionConfig()


def hazards(now: float = 0, prior: HazardPrior = HazardPrior()):
    engine = HazardEngine((prior,))
    engine.ingest(observation())
    return engine.snapshot(now)


def test_relevant_obstruction_selects_supplied_detour() -> None:
    decision = score_routes((CURRENT, DETOUR), RIDER, hazards(), CONFIG, 0)
    assert decision.action == "reroute"
    assert decision.selected_route_id == "detour"
    assert decision.detour_cost_s == 30
    assert decision.evidence_ids == ("e-o1",)
    assert any("fixture" in item for item in decision.assumptions)


def test_route_order_cannot_change_decision() -> None:
    assert score_routes((CURRENT, DETOUR), RIDER, hazards(), CONFIG, 0) == score_routes(
        (DETOUR, CURRENT),
        RIDER,
        hazards(),
        CONFIG,
        0,
    )


def test_brief_obstruction_waits_instead_of_costlier_detour() -> None:
    reports = hazards(prior=HazardPrior(obstruction_delay_s=15))
    decision = score_routes((CURRENT, DETOUR), RIDER, reports, CONFIG, 0)
    assert decision.action == "wait"
    assert decision.selected_route_id == "direct"


def test_no_route_and_provider_failure_are_unavailable() -> None:
    assert score_routes((), RIDER, hazards(), CONFIG, 0).action == "unavailable"
    failed = replace(CURRENT, available=False)
    assert score_routes((failed, DETOUR), RIDER, hazards(), CONFIG, 0).action == "unavailable"


def test_pedestrian_profile_not_used_as_bicycle_route() -> None:
    route = replace(CURRENT, bicycle_profile="foot-walking")
    assert score_routes((route,), RIDER, hazards(), CONFIG, 0).action == "unavailable"


def test_behind_parallel_and_opposite_direction_do_not_warn() -> None:
    rider = replace(RIDER, progress_m=200, elapsed_route_s=60)
    assert score_routes((CURRENT,), rider, hazards(), CONFIG, 0).action == "continue"
    assert (
        score_routes(
            (DETOUR,), replace(RIDER, current_route_id="detour"), hazards(), CONFIG, 0
        ).action
        == "continue"
    )
    west = replace(CURRENT, passages=(RoutePassage("road-east", 100, 30, 270),))
    assert score_routes((west,), RIDER, hazards(), CONFIG, 0).action == "continue"


def test_current_bearing_does_not_hide_hazard_after_a_turn() -> None:
    rider = replace(RIDER, bearing_deg=270)
    assert score_routes((CURRENT,), rider, hazards(), CONFIG, 0).action == "slow"


def test_stale_serious_report_never_becomes_safe_from_decay() -> None:
    decision = score_routes((CURRENT,), RIDER, hazards(100000), CONFIG, 100000)
    assert decision.action == "slow"
    assert "Possible blockage" in decision.reason
    assert any("not cleared" in detail for detail in decision.assumptions)


def test_cleared_hazard_has_no_active_warning() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("clear", 20, assertion="clear", visible=True))
    assert score_routes((CURRENT,), RIDER, engine.snapshot(20), CONFIG, 20).action == "continue"


def test_unknown_location_warns_but_cannot_invent_detour_relevance() -> None:
    reports = tuple(
        replace(h, location=replace(LOCATION, directed_road_id=None)) for h in hazards()
    )
    decision = score_routes((CURRENT, DETOUR), RIDER, reports, CONFIG, 0)
    assert decision.action == "heads_up"
    assert decision.selected_route_id == "direct"
    assert decision.evidence_ids == ("e-o1",)


def test_incomplete_route_coverage_not_presented_as_avoiding_hazard() -> None:
    detour = replace(DETOUR, coverage_complete=False)
    assert score_routes((CURRENT, detour), RIDER, hazards(), CONFIG, 0).action == "slow"


def test_both_radius_controls_change_relevance_and_warning() -> None:
    config = replace(CONFIG, short_radius_m=50)
    assert score_routes((CURRENT,), RIDER, hazards(), config, 0).action == "heads_up"
    config = replace(config, planning_area_m=90)
    assert score_routes((CURRENT,), RIDER, hazards(), config, 0).action == "continue"


def test_provider_eta_is_adjusted_for_elapsed_time() -> None:
    rider = replace(RIDER, progress_m=50, elapsed_route_s=15)
    decision = score_routes((CURRENT, DETOUR), rider, hazards(), CONFIG, 0)
    current_score = next(s for s in decision.route_scores if s.route_id == "direct")
    assert current_score.remaining_duration_s == 285
    assert current_score.estimated_delay_s == pytest.approx(90 * 2 ** (-15 / 180))


def test_future_or_stale_snapshot_rejected() -> None:
    with pytest.raises(ValueError, match="snapshot"):
        score_routes((CURRENT,), RIDER, hazards(10), CONFIG, 0)
    with pytest.raises(ValueError, match="snapshot"):
        score_routes((CURRENT,), RIDER, hazards(), CONFIG, 10)


def test_equal_cost_tie_keeps_current_route() -> None:
    direct = replace(CURRENT, passages=())
    detour = replace(DETOUR, duration_s=300)
    assert score_routes((direct, detour), RIDER, (), CONFIG, 0).selected_route_id == "direct"


def test_route_with_same_obstruction_is_not_escape() -> None:
    detour = replace(DETOUR, duration_s=301, passages=CURRENT.passages)
    assert score_routes((CURRENT, detour), RIDER, hazards(), CONFIG, 0).action == "slow"


def test_invalid_rider_progress_is_unavailable() -> None:
    rider = replace(RIDER, progress_m=1001)
    assert score_routes((CURRENT,), rider, hazards(), CONFIG, 0).action == "unavailable"


@pytest.mark.parametrize("duration", [-1, float("nan"), float("inf")])
def test_invalid_route_duration_rejected(duration: float) -> None:
    with pytest.raises(ValueError):
        replace(CURRENT, duration_s=duration)


def test_fresh_now_but_stale_at_arrival_keeps_uncertainty_visible() -> None:
    route = replace(CURRENT, duration_s=1000, passages=(RoutePassage("road-east", 100, 900, 90),))
    decision = score_routes((route,), RIDER, hazards(), CONFIG, 0)
    assert decision.action == "slow"
    assert "Possible blockage" in decision.reason
    assert any("not cleared" in detail for detail in decision.assumptions)


def test_stale_reroute_reason_explains_uncertainty() -> None:
    decision = score_routes((CURRENT, DETOUR), RIDER, hazards(120), CONFIG, 120)
    assert decision.action == "reroute"
    assert "Possible blockage" in decision.reason
    assert any("uncertain" in detail for detail in decision.assumptions)


def test_hazard_input_order_does_not_change_decision() -> None:
    first = hazards()[0]
    second = replace(
        first, hazard_id="second", location=replace(first.location, directed_road_id="unrelated")
    )
    assert score_routes((CURRENT,), RIDER, (first, second), CONFIG, 0) == score_routes(
        (CURRENT,),
        RIDER,
        (second, first),
        CONFIG,
        0,
    )
