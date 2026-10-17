"""Lane A: RideAhead runtime + API on the fixture scenario (no network)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.main import create_app
from tests.test_api import make_settings


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:  # type: ignore[no-untyped-def]
    settings = make_settings(
        tmp_path,
        ors_api_key=SecretStr(""),
        rideahead_routing="fixture",
        rideahead_scenario="scenario.json",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _advance(client: TestClient, sid: str, t: float) -> dict:
    res = client.post(f"/api/rideahead/sessions/{sid}/advance", json={"to_s": t})
    assert res.status_code == 200
    return res.json()


def test_capabilities_are_honest(client: TestClient) -> None:
    caps = client.get("/api/rideahead/capabilities").json()
    states = {i["name"]: i["state"] for i in caps["integrations"]}
    assert states["routing"] == "fixture"
    assert states["vast"] == "fixture"
    assert states["weave"] == "not_configured"
    assert {t["hazard_type"] for t in caps["hazard_types"]} >= {"lane_blocked"}


def test_rides_listed(client: TestClient) -> None:
    rides = client.get("/api/rideahead/rides").json()
    assert rides[0]["ride_id"] == "ride-fixture-001"


def test_fixture_routes_story_observed_stale_cleared(client: TestClient) -> None:
    """Hand-drawn fixture routes: the detour costs more than the assumed delay → heads_up."""
    snap = client.post("/api/rideahead/sessions", json={}).json()
    sid = snap["session_id"]
    assert snap["revision"] == 1
    assert snap["observations"] == []  # nothing revealed before replay reaches it
    assert snap["decisions"][0]["action"] == "continue"

    snap = _advance(client, sid, 60)
    assert [h["state"] for h in snap["hazards"]] == ["observed"]
    assert snap["decisions"][0]["action"] == "heads_up"
    assert any(e["kind"] == "decision" for e in snap["events"])

    snap = _advance(client, sid, 70)  # adjacent chunk, same sighting: no clock reset
    hz = snap["hazards"][0]
    assert hz["state"] == "observed"
    assert hz["last_supported_s"] == 60

    snap = _advance(client, sid, 330)
    assert snap["hazards"][0]["state"] == "stale"
    assert snap["decisions"][0]["action"] == "heads_up"

    snap = _advance(client, sid, 450)
    assert snap["hazards"][0]["state"] == "cleared"
    assert snap["decisions"][0]["action"] == "continue"
    clear = next(o for o in snap["observations"] if o["assertion"] == "clear")
    assert clear["source"] == "synthetic_scenario"
    assert "Synthetic" in clear["label"]


def test_recorded_ors_story_reroutes_then_clears(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Recorded genuine ORS responses (no key, no network): cheap provider detour → reroute."""
    settings = make_settings(
        tmp_path,
        ors_api_key=SecretStr(""),
        rideahead_routing="ors",
        rideahead_scenario="scenario.json",
    )
    with TestClient(create_app(settings)) as c:
        sid = c.post("/api/rideahead/sessions", json={}).json()["session_id"]
        snap = _advance(c, sid, 200)
        assert {r["provenance"] for r in snap["routes"]} == {"cached_provider"}
        assert any(r["role"] == "detour" for r in snap["routes"])
        assert snap["decisions"][0]["action"] == "reroute"
        assert snap["riders"][1]["active_route_id"] == snap["decisions"][0]["selected_route_id"]
        assert {i["name"]: i["state"] for i in snap["integrations"]}["routing"] == "cached"

        snap = _advance(c, sid, 330)
        assert snap["hazards"][0]["state"] == "stale"
        assert snap["decisions"][0]["action"] == "heads_up"  # stale is not clear

        snap = _advance(c, sid, 450)
        assert snap["hazards"][0]["state"] == "cleared"
        assert snap["decisions"][0]["action"] == "continue"


def test_reads_do_not_advance_and_backwards_replays_deterministically(client: TestClient) -> None:
    sid = client.post("/api/rideahead/sessions", json={}).json()["session_id"]
    forward = _advance(client, sid, 250)
    again = client.get(f"/api/rideahead/sessions/{sid}").json()
    assert again["revision"] == forward["revision"]
    assert again["replay_time_s"] == 250

    _advance(client, sid, 500)
    back = _advance(client, sid, 250)
    assert back["revision"] > forward["revision"]
    for key in ("hazards", "riders", "observations"):
        assert back[key] == forward[key]
    strip = [{**d, "revision": 0} for d in back["decisions"]]
    assert strip == [{**d, "revision": 0} for d in forward["decisions"]]


def test_config_update_and_missing_session(client: TestClient) -> None:
    sid = client.post("/api/rideahead/sessions", json={}).json()["session_id"]
    res = client.patch(f"/api/rideahead/sessions/{sid}/config", json={"share_radius_m": 300})
    assert res.status_code == 200
    assert res.json()["config"]["share_radius_m"] == 300
    assert client.get("/api/rideahead/sessions/nope").status_code == 404


def test_nyc_scenario_on_recorded_ors_routes(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Default NYC scenario (6th Ave), recorded genuine ORS routes, placeholder observation."""
    settings = make_settings(tmp_path, ors_api_key=SecretStr(""), rideahead_routing="ors")
    with TestClient(create_app(settings)) as c:
        snap = c.post("/api/rideahead/sessions", json={}).json()
        sid = snap["session_id"]
        assert snap["scenario_id"] == "nyc-6th-ave-v1"
        assert any("New York" in label for label in snap["labels"])
        assert snap["riders"][0]["position"] is None  # Bike A unmapped before its first anchor

        snap = _advance(c, sid, 60)
        assert [h["state"] for h in snap["hazards"]] == ["observed"]
        assert snap["observations"][0]["label"].startswith("PLACEHOLDER")
        assert {r["provenance"] for r in snap["routes"]} == {"cached_provider"}
        assert any(r["role"] == "detour" for r in snap["routes"])
        assert snap["decisions"][0]["action"] == "heads_up"

        snap = _advance(c, sid, 200)  # brief obstruction cheaper than the +39 s detour
        assert snap["decisions"][0]["action"] == "wait"

        snap = _advance(c, sid, 330)
        assert snap["hazards"][0]["state"] == "stale"
        snap = _advance(c, sid, 450)
        assert snap["hazards"][0]["state"] == "cleared"
