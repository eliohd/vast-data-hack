from pathlib import Path

import httpx

from app.agent.interfaces import PerceptionProvider
from app.agent.perception import ArchivePerceptionProvider, interpolate
from app.clients.gpu import CosmosReason, Yolo
from app.clients.llm import LLM
from app.clients.vss import VSSClient

CACHE = Path(__file__).parent.parent / "fixtures" / "rideahead" / "cache"


def provider() -> ArchivePerceptionProvider:
    http = httpx.AsyncClient()
    return ArchivePerceptionProvider(
        VSSClient(http, "", "", ""),
        CosmosReason(http, "", "", ""),
        Yolo(http, "", ""),
        LLM("http://unused", "", "", "m"),
        CACHE,
    )


def test_implements_protocol() -> None:
    assert isinstance(provider(), PerceptionProvider)


async def test_list_rides_from_manifest() -> None:
    rides = await provider().list_rides()
    assert len(rides) == 1
    ride = rides[0]
    assert ride.has_gps is False
    assert "manually reconstructed route" in ride.location_label
    assert ride.provenance == "cached_recorded"
    assert all(
        s.media_ref and s.media_ref.startswith("/api/archive/media?source=") for s in ride.segments
    )


async def test_observations_are_cached_reviewed_and_never_leak_urls() -> None:
    p = provider()
    obs = await p.inspect_ride(p.ride_id)
    assert obs, "expected reviewed claim observations"
    for o in obs:
        assert o.source == "cached_model"
        assert o.evidence[0].provenance == "cached_recorded"
        assert o.evidence[0].segment_id.startswith("s3://")
        assert "token" not in (o.evidence[0].media_ref or "")
        assert o.location.method in {"manual_anchor", "interpolated"}
        assert o.location.uncertainty_m and o.location.road_segment_id
        assert o.verification and o.verification.source == "cached_model"
        assert o.verification.model and o.verification.prompt_version
    times = [o.session_time_s for o in obs]
    assert times == sorted(times) and times[0] >= 0


async def test_rejected_caption_claims_stay_contradicted() -> None:
    p = provider()
    by_id = {o.observation_id: o for o in await p.inspect_ride(p.ride_id)}
    # the caption said "partially blocking the bike lane"; frames show the lane clear
    assert by_id["obs-gx010001-c15-s1"].support == "contradicted"
    # honest state of the corpus today: nothing reaches present + supported
    assert not [o for o in by_id.values() if o.assertion == "present" and o.support == "supported"]


async def test_unknown_ride_and_unknown_evidence() -> None:
    p = provider()
    assert await p.inspect_ride("nope") == []
    v = await p.verify_evidence("ev-missing", "q")
    assert v.verdict == "unclear"


def test_statuses_report_cached() -> None:
    states = {s.name: s.state for s in provider().statuses()}
    assert states == {
        "vast": "cached",
        "cosmos": "cached",
        "yolo": "cached",
        "wandb_inference": "cached",
    }


def test_interpolate_between_anchors() -> None:
    anchors = [
        {"ride_offset_s": 0, "lat": 0.0, "lon": 0.0, "uncertainty_m": 50},
        {"ride_offset_s": 10, "lat": 1.0, "lon": 2.0, "uncertainty_m": 100},
    ]
    lat, lon, unc, method = interpolate(anchors, 5)
    assert (lat, lon, unc, method) == (0.5, 1.0, 100, "interpolated")
    assert interpolate(anchors, 0)[3] == "manual_anchor"
