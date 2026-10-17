"""Lane A: mid-journey detours are requested from the rider's current position."""

from app.agent.geo import haversine_m, line_length_m
from app.agent.hazards import build_engine
from app.agent.models import (
    LatLon,
    LineString,
    LocationEstimate,
    Observation,
    RouteCandidate,
    RouteExclusion,
)
from app.agent.routing import CachedRouting
from app.agent.runtime import RideAheadRuntime, Scenario, SimulatedRiderSpec

LON = -74.0
ORIGIN = LatLon(lat=40.0, lon=LON)
DEST = LatLon(lat=40.010, lon=LON)  # ~1.1 km due north
HAZARD_LAT = 40.0055  # ~611 m along
EAST = -73.9993  # parallel street ~60 m east
SPEED = 5.0


def _route(rid: str, role: str, coords: list[list[float]]) -> RouteCandidate:
    length = line_length_m(coords)
    return RouteCandidate(
        route_id=rid,
        role=role,  # type: ignore[arg-type]
        geometry=LineString(coordinates=coords),
        duration_s=length / SPEED,
        distance_m=length,
        provider="fake",
        profile="cycling-regular",
        provenance="live_provider",
    )


class FakeRouting:
    """Straight road north; detours turn east immediately at their start point."""

    name = "fake"

    def __init__(self) -> None:
        self.starts: list[LatLon] = []

    async def candidate_routes(
        self, origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]
    ) -> list[RouteCandidate]:
        self.starts.append(origin)
        s = [origin.lon, origin.lat]
        if not exclusions:
            return [_route(f"main-{origin.lat:.5f}", "primary", [s, [LON, DEST.lat]])]
        coords = [
            s,
            [EAST, origin.lat],
            [EAST, HAZARD_LAT + 0.0004],
            [LON, HAZARD_LAT + 0.0004],
            [LON, DEST.lat],
        ]
        return [_route(f"detour-{origin.lat:.5f}", "detour", coords)]


class NoPerception:
    name = "none"

    async def list_rides(self):  # type: ignore[no-untyped-def]
        return []

    async def inspect_ride(self, ride_id: str) -> list[Observation]:
        return []

    async def verify_evidence(self, evidence_id: str, question: str):  # type: ignore[no-untyped-def]
        raise NotImplementedError


def _work_zone(t: float) -> Observation:
    return Observation.model_validate(
        {
            "observation_id": "obs-late",
            "hazard_type": "work_zone",
            "assertion": "present",
            "evidence": [
                {
                    "evidence_id": "ev-late",
                    "ride_id": "r",
                    "segment_id": "seg",
                    "clip_start_s": 0,
                    "clip_end_s": 5,
                    "ride_offset_s": t,
                    "provenance": "synthetic",
                }
            ],
            "location": LocationEstimate(
                lat=HAZARD_LAT,
                lon=LON,
                road_segment_id="test-road:nb",
                bearing_deg=0.0,
                method="manual_anchor",
                uncertainty_m=10.0,
            ).model_dump(),
            "observer_id": "scenario",
            "source_group_id": "g-late",
            "description": "work zone appears after departure",
            "support": "supported",
            "ride_offset_s": t,
            "session_time_s": t,
            "source": "synthetic_scenario",
            "label": "Synthetic test event",
        }
    )


async def test_hazard_after_departure_reroutes_from_current_position() -> None:
    fake = FakeRouting()
    scenario = Scenario(
        scenario_id="midroute-test",
        title="t",
        ride_id="r",
        duration_s=200,
        origin=ORIGIN,
        destination=DEST,
        simulated_rider=SimulatedRiderSpec(depart_s=0, speed_mps=SPEED),
        synthetic_observations=[_work_zone(90)],
    )
    rt = RideAheadRuntime(
        perception=NoPerception(),  # type: ignore[arg-type]
        routing=CachedRouting(fake),
        engine_factory=build_engine,
        scenario=scenario,
        integrations=lambda: [],
    )
    snap = await rt.create_session()
    sid = snap.session_id

    before = await rt.advance(sid, 89)
    assert before.hazards == []
    assert before.decisions[0].action == "continue"
    assert all(s == ORIGIN for s in fake.starts)  # nothing requested mid-route yet

    after = await rt.advance(sid, 90)  # hazard appears ~150 m ahead of a moving rider
    bike_b = after.riders[1]
    assert [h.state for h in after.hazards] == ["observed"]
    mid_starts = [s for s in fake.starts if s != ORIGIN]
    assert mid_starts, "a detour must be requested from the rider's position"
    assert haversine_m(mid_starts[0], bike_b.position) < 35  # type: ignore[arg-type]
    decision = after.decisions[0]
    assert decision.action == "reroute"
    assert decision.selected_route_id is not None
    assert decision.selected_route_id.startswith("detour-") and decision.selected_route_id != (
        f"detour-{ORIGIN.lat:.5f}"
    )
    assert bike_b.active_route_id == decision.selected_route_id
    assert any("detour(s) from" in e.message for e in after.events)

    nxt = await rt.advance(sid, 91)  # no teleport: continuous movement on the new route
    assert haversine_m(bike_b.position, nxt.riders[1].position) < 10  # type: ignore[arg-type]

    replay = await rt.advance(sid, 90)  # rewind + deterministic replay
    assert replay.decisions[0].selected_route_id == decision.selected_route_id
