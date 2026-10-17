"""Cyclist-facing copy checks; policy/action assertions remain in scoring tests."""

import pytest

from app.agent.decision_text import distance_ahead, duration_text, rider_reason


@pytest.mark.parametrize(
    "distance,expected",
    [(0, "just ahead"), (7, "just ahead"), (100, "100 m ahead"), (1320, "1.3 km ahead")],
)
def test_distance_is_readable_at_bike_scale(distance: float, expected: str) -> None:
    assert distance_ahead(distance) == expected


@pytest.mark.parametrize(
    "seconds,expected", [(0.2, "under 1 sec"), (8, "8 sec"), (86.5, "1 min 30 sec"), (120, "2 min")]
)
def test_estimated_time_uses_short_units(seconds: float, expected: str) -> None:
    assert duration_text(seconds) == expected


def test_detour_reason_gives_distance_action_and_cost() -> None:
    reason = rider_reason("reroute", 1300, 45, 8, False)
    assert reason == "Blockage 1.3 km ahead. Take the detour; about 8 sec extra."
    assert "provider" not in reason and "persistence" not in reason


def test_faster_and_equal_time_alternatives_do_not_claim_added_time() -> None:
    assert "faster" in rider_reason("reroute", 100, 45, -8, False)
    assert "no extra time" in rider_reason("reroute", 100, 45, 0, False)


def test_uncertain_warning_does_not_present_heuristic_as_a_known_delay() -> None:
    reason = rider_reason("slow", 100, 0.0001, None, True)
    assert reason == "Possible blockage 100 m ahead. Slow down; delay uncertain."


def test_unknown_location_does_not_invent_a_distance() -> None:
    assert rider_reason("heads_up", None, 45, None, True) == (
        "Route information is incomplete. Stay alert; delay unknown."
    )
