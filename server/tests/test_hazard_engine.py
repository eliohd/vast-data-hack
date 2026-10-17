from dataclasses import replace

import pytest

from app.agent.hazard_engine import HazardEngine, locations_match, persistence_weight
from app.agent.hazard_types import Assertion, Evidence, HazardPrior, Location, Observation, Support

LOCATION = Location("road-east", 51.5, -0.1, 90, 5, "manual_anchor", "synthetic test anchor")


def observation(
    oid: str = "o1",
    time: float = 0,
    *,
    assertion: Assertion = "present",
    support: Support = "supported",
    observer: str = "A",
    group: str = "ride-a",
    location: Location = LOCATION,
    visible: bool = False,
) -> Observation:
    return Observation(
        oid,
        "lane_blocked",
        assertion,
        support,
        location,
        observer,
        group,
        time,
        time,
        (
            Evidence(
                f"e-{oid}",
                group,
                f"segment-{oid}",
                observer,
                0,
                2,
                time,
                time,
                "synthetic",
                visible,
            ),
        ),
    )


def test_observed_stale_explicitly_cleared() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("clear", 150, assertion="clear", visible=True))
    assert engine.snapshot(0)[0].state == "observed"
    assert engine.snapshot(120)[0].state == "stale"
    assert engine.snapshot(149)[0].clearance_evidence_id is None
    cleared = engine.snapshot(150)[0]
    assert cleared.state == "cleared"
    assert cleared.clearance_evidence_id == "e-clear"
    assert cleared.provenance == ("synthetic",)
    assert cleared.last_supported_s == 0


def test_exact_duplicate_and_renamed_cached_output_do_not_refresh_clock() -> None:
    engine = HazardEngine()
    first = observation()
    engine.ingest(first)
    engine.ingest(first)
    cached = replace(first.evidence[0], evidence_id="new-model-call", provenance="cached_recorded")
    engine.ingest(replace(first, observation_id="cached", session_time_s=119, evidence=(cached,)))
    hazard = engine.snapshot(120)[0]
    assert hazard.state == "stale"
    assert hazard.last_supported_s == 0
    assert hazard.observation_ids == ("o1",)


def test_overlapping_renamed_segment_does_not_refresh_or_confirm() -> None:
    first = observation()
    renamed = observation("rename", 1)
    engine = HazardEngine()
    engine.ingest(first)
    engine.ingest(renamed)
    assert engine.snapshot(1)[0].observation_ids == ("o1",)


def test_reused_observation_id_rejected() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    with pytest.raises(ValueError, match="reused"):
        engine.ingest(replace(observation(), session_time_s=20))


def test_adjacent_chunks_are_not_confirmation() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("adjacent", 2))
    hazard = engine.snapshot(2)[0]
    assert hazard.state == "observed"
    assert hazard.evidence_strength == "single_sighting"
    assert hazard.last_supported_s == 0


def test_later_sighting_is_continued_not_independent() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("later", 40))
    hazard = engine.snapshot(40)[0]
    assert hazard.state == "confirmed"
    assert hazard.evidence_strength == "continued_observation"


def test_same_observer_new_group_does_not_become_independent() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("later", 40, group="renamed-ride"))
    assert engine.snapshot(40)[0].evidence_strength == "continued_observation"


def test_independent_observer_with_shared_group_is_not_independent() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("other", 10, observer="B"))
    assert engine.snapshot(10)[0].state == "observed"


def test_independent_evidence_confirms_without_changing_impact() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("other", 10, observer="B", group="ride-b"))
    hazard = engine.snapshot(10)[0]
    assert hazard.state == "confirmed"
    assert hazard.evidence_strength == "independent_corroboration"
    assert hazard.impact == "serious"


@pytest.mark.parametrize("support", ["uncertain", "contradicted"])
def test_uncertain_or_rejected_evidence_cannot_create_or_clear(support: Support) -> None:
    engine = HazardEngine()
    engine.ingest(observation("unsupported", support=support))
    assert engine.snapshot(0) == ()
    engine.ingest(observation("present", 10))
    engine.ingest(observation("unknown", 100, assertion="clear", support=support, visible=True))
    assert engine.snapshot(130)[0].state == ("disputed" if support == "contradicted" else "stale")


@pytest.mark.parametrize(
    "change",
    [
        {"visible": False},
        {"location": replace(LOCATION, uncertainty_m=None)},
        {"location": replace(LOCATION, uncertainty_m=30)},
    ],
)
def test_inadequate_clearance_is_disputed_not_cleared(change: dict) -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(
        observation(
            "clear",
            150,
            assertion="clear",
            visible=True,
            **{k: v for k, v in change.items() if k != "visible"},
        )
        if "visible" not in change
        else observation("clear", 150, assertion="clear")
    )
    assert engine.snapshot(150)[0].state == "disputed"


def test_same_source_claim_cannot_clear_itself() -> None:
    engine = HazardEngine()
    first = observation()
    engine.ingest(first)
    engine.ingest(
        replace(
            first,
            observation_id="clear",
            session_time_s=40,
            assertion="clear",
            evidence=(replace(first.evidence[0], affected_area_visible=True),),
        )
    )
    assert engine.snapshot(40)[0].state == "disputed"


@pytest.mark.parametrize(
    "location",
    [
        replace(LOCATION, directed_road_id="road-west", bearing_deg=270),
        replace(LOCATION, directed_road_id="parallel-east"),
        replace(LOCATION, lat=51.51),
        replace(LOCATION, bearing_deg=270),
        replace(LOCATION, directed_road_id=None),
    ],
)
def test_unrelated_clearance_does_not_clear(location: Location) -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    engine.ingest(observation("clear", 150, assertion="clear", location=location, visible=True))
    assert engine.snapshot(150)[0].state == "stale"


def test_clearance_before_sighting_does_not_leak_forward() -> None:
    engine = HazardEngine()
    engine.ingest(observation("clear", 0, assertion="clear", visible=True))
    engine.ingest(observation("present", 10))
    assert engine.snapshot(10)[0].state == "observed"


def test_future_evidence_rejected_at_boundary() -> None:
    first = observation()
    with pytest.raises(ValueError, match="future"):
        replace(first, evidence=(replace(first.evidence[0], available_at_s=10),))


def test_reset_replay_seek_and_ingest_order_are_deterministic() -> None:
    events = [
        observation(),
        observation("other", 40),
        observation("clear", 150, assertion="clear", visible=True),
    ]
    engine = HazardEngine()
    for event in reversed(events):
        engine.ingest(event)
    expected = [engine.snapshot(t) for t in (0, 40, 120, 150)]
    assert engine.snapshot(0)[0].state == "observed"
    assert engine.snapshot(150)[0].state == "cleared"
    engine.reset()
    assert engine.snapshot(150) == ()
    for event in events:
        engine.ingest(event)
    assert [engine.snapshot(t) for t in (0, 40, 120, 150)] == expected


def test_reappearance_after_clearance_resets_corroboration() -> None:
    engine = HazardEngine()
    for event in (
        observation(),
        observation("other", 10, observer="B", group="ride-b"),
        observation("clear", 20, assertion="clear", visible=True),
        observation("again", 30),
    ):
        engine.ingest(event)
    hazard = engine.snapshot(30)[0]
    assert hazard.state == "observed"
    assert hazard.clearance_evidence_id is None
    assert hazard.evidence_strength == "single_sighting"


def test_conflicting_simultaneous_evidence_is_order_independent() -> None:
    for present_id, clear_id in (("a", "z"), ("z", "a")):
        engine = HazardEngine()
        engine.ingest(observation("initial", 0))
        engine.ingest(observation(present_id, 20))
        engine.ingest(
            observation(clear_id, 20, assertion="clear", observer="B", group="ride-b", visible=True)
        )
        assert engine.snapshot(20)[0].state == "disputed"


def test_half_life_weight_is_not_a_clearance_rule() -> None:
    engine = HazardEngine()
    engine.ingest(observation())
    hazard = engine.snapshot(180)[0]
    assert persistence_weight(hazard, 180) == 0.5
    assert persistence_weight(hazard, 180, 180) == 0.25
    assert engine.snapshot(100000)[0].state == "stale"


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf")])
def test_invalid_time_and_configuration_rejected(value: float) -> None:
    with pytest.raises(ValueError):
        HazardEngine().snapshot(value)
    with pytest.raises(ValueError):
        HazardPrior(half_life_s=value)


def test_unknown_locations_are_not_coalesced() -> None:
    assert not locations_match(Location(), Location())
    engine = HazardEngine()
    engine.ingest(observation(location=Location()))
    engine.ingest(observation("next", 10, location=Location()))
    assert len(engine.snapshot(10)) == 2


def test_missing_evidence_cannot_create_a_hazard() -> None:
    engine = HazardEngine()
    engine.ingest(replace(observation(), evidence=()))
    assert engine.snapshot(0) == ()


def test_verification_can_support_an_initially_uncertain_sighting() -> None:
    engine = HazardEngine()
    uncertain = observation(support="uncertain")
    engine.ingest(uncertain)
    engine.ingest(replace(uncertain, observation_id="verified", support="supported"))
    assert engine.snapshot(0)[0].state == "observed"
    assert engine.snapshot(0)[0].last_supported_s == 0


def test_simultaneous_first_present_and_clear_are_disputed_regardless_of_ids() -> None:
    for present_id, clear_id in (("a", "z"), ("z", "a")):
        engine = HazardEngine()
        engine.ingest(observation(present_id, 0))
        engine.ingest(
            observation(clear_id, 0, assertion="clear", observer="B", group="ride-b", visible=True)
        )
        assert engine.snapshot(0)[0].state == "disputed"


def test_old_footage_retrieved_later_cannot_clear_or_reopen() -> None:
    engine = HazardEngine()
    engine.ingest(observation("present", 40))
    old_clear = observation("old-clear", 10, assertion="clear", visible=True)
    engine.ingest(replace(old_clear, session_time_s=50))
    assert engine.snapshot(50)[0].state == "disputed"
    engine.ingest(observation("real-clear", 60, assertion="clear", visible=True))
    old_present = observation("old-present", 20)
    engine.ingest(replace(old_present, session_time_s=70))
    assert engine.snapshot(70)[0].state == "cleared"


def test_additional_type_uses_separate_configured_prior() -> None:
    engine = HazardEngine((HazardPrior(), HazardPrior(hazard_type="work_zone", stale_after_s=600)))
    engine.ingest(replace(observation(), hazard_type="work_zone"))
    assert engine.snapshot(120)[0].state == "observed"
    assert engine.snapshot(600)[0].state == "stale"


def test_delayed_old_sighting_never_moves_last_supported_clock_forward() -> None:
    engine = HazardEngine()
    engine.ingest(observation("recent", 40))
    engine.ingest(replace(observation("delayed", 10), session_time_s=150))
    hazard = engine.snapshot(160)[0]
    assert hazard.last_supported_s == 40
    assert hazard.state == "stale"


def test_sustained_observation_refreshes_at_qualifying_interval_not_each_chunk() -> None:
    engine = HazardEngine()
    for time in (0, 10, 20, 30):
        engine.ingest(observation(f"chunk-{time}", time))
    assert engine.snapshot(20)[0].last_supported_s == 0
    assert engine.snapshot(30)[0].last_supported_s == 30
    assert engine.snapshot(30)[0].evidence_strength == "continued_observation"


def test_original_recording_time_can_contradict_apparent_later_clearance() -> None:
    engine = HazardEngine()
    first = observation()
    first = replace(first, evidence=(replace(first.evidence[0], recorded_at_s=100),))
    clear = observation("clear", 150, assertion="clear", visible=True)
    clear = replace(clear, evidence=(replace(clear.evidence[0], recorded_at_s=50),))
    engine.ingest(first)
    engine.ingest(clear)
    assert engine.snapshot(150)[0].state == "disputed"


def test_later_episode_does_not_reuse_corroboration_from_before_clearance() -> None:
    engine = HazardEngine()
    for event in (
        observation(),
        observation("independent", 10, observer="B", group="ride-b"),
        observation("clear", 20, assertion="clear", visible=True),
        observation("again", 30),
        observation("adjacent-again", 35),
    ):
        engine.ingest(event)
    assert engine.snapshot(35)[0].state == "observed"
    assert engine.snapshot(35)[0].evidence_strength == "single_sighting"
