import json
from pathlib import Path

import pytest

from app.perception.assertions import caption_assertion, classify_clause, split_clauses

# The five trust cases required by master-prompt.md section 9.
REQUIRED = [
    ("No vehicles block the bike lane.", "denied", "bike_lane"),
    ("No cars are moving because a truck blocks the lane.", "present", "lane"),
    ("A truck is parked beside the bike lane.", "adjacent", "bike_lane"),
    ("A truck may be blocking the lane.", "hedged", "lane"),
    (
        "The bike lane is obscured by glare, so blockage cannot be determined.",
        "unclear",
        "bike_lane",
    ),
]


@pytest.mark.parametrize(("caption", "assertion", "lane"), REQUIRED)
def test_required_trust_cases(caption: str, assertion: str, lane: str) -> None:
    finding = caption_assertion(caption)
    assert finding.assertion == assertion
    assert finding.lane_ref == lane


def test_causal_clause_is_split_from_its_negation() -> None:
    assert split_clauses("No cars are moving because a truck blocks the lane.") == [
        "No cars are moving",
        "a truck blocks the lane",
    ]


# Real captions from ride GX010001 (nyc_bike_gopro-1), see manifests/ride_gx010001.json.
def test_real_positive_bike_lane_obstruction() -> None:
    caption = (
        "A yellow taxi is visible further ahead. A large black delivery truck is in the left "
        "lane, partially blocking the bike lane. The vehicle continues forward."
    )
    finding = caption_assertion(caption)
    assert (finding.assertion, finding.lane_ref) == ("present", "bike_lane")


def test_real_boilerplate_denial_does_not_hide_a_claim() -> None:
    caption = (
        "A black sedan is positioned near the intersection, partially blocking the lane. "
        "No clear violations are evident, but the stopped bus and partially blocking black "
        "sedan create potential congestion."
    )
    assert caption_assertion(caption).assertion == "present"


def test_real_pure_denial_is_not_a_clearance() -> None:
    caption = "No vehicles are blocking the lanes, and there are no apparent violations or hazards."
    finding = caption_assertion(caption)
    assert finding.assertion == "denied"


def test_clear_bike_lane_description_makes_no_claim() -> None:
    caption = (
        "The bike lane is marked with green pavement and a yellow center line. A cyclist rides "
        "ahead in the bike lane."
    )
    assert caption_assertion(caption).assertion == "none"


def test_traffic_light_negation_is_ignored() -> None:
    clause = "No traffic lights or stop signs are clearly visible"
    assert classify_clause(clause).assertion == "none"


# Expected reading of every shortlisted real caption (labels set by reading each caption).
SHORTLIST_EXPECTED = {
    "gx010001-c03-s1": "denied",
    "gx010001-c12-s5": "none",
    "gx010001-c13-s2": "none",
    "gx010001-c14-s2": "present",
    "gx010001-c14-s3": "none",
    "gx010001-c15-s1": "present",
    "gx010001-c15-s3": "none",
    "gx010001-c15-s5": "present",
    "gx010001-c15-s6": "present",
    "gx010001-c16-s2": "none",
}


def test_shortlist_captions_match_manual_reading() -> None:
    fixture = Path(__file__).parent / "fixtures" / "gx010001_shortlist.json"
    segments = json.loads(fixture.read_text())["segments"]
    got = {s["id"]: caption_assertion(s["caption"]).assertion for s in segments}
    assert got == SHORTLIST_EXPECTED
