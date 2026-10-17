"""Lane A: geometry helpers and the routing adapters (no network)."""

import json

import httpx
import pytest

from app.agent.geo import (
    angle_diff_deg,
    bearing_deg,
    circle_polygon,
    haversine_m,
    point_along,
    project,
)
from app.agent.interfaces import RoutingUnavailable
from app.agent.models import LatLon, RouteExclusion
from app.agent.routing import CachedRouting, OpenRouteServiceProvider

LINE = [[-0.1050, 51.5058], [-0.0975, 51.5055], [-0.0880, 51.5050]]


def test_haversine_and_bearing() -> None:
    a, b = LatLon(lat=51.5, lon=-0.1), LatLon(lat=51.5, lon=-0.09)
    assert 690 < haversine_m(a, b) < 700
    assert 89 < bearing_deg(a, b) < 91
    assert angle_diff_deg(350, 10) == 20


def test_project_and_point_along() -> None:
    p = project(LatLon(lat=51.5056, lon=-0.0975), LINE)
    assert p.offset_m < 15
    assert 500 < p.along_m < 540
    pt, brg = point_along(LINE, p.along_m)
    assert haversine_m(pt, LatLon(lat=51.5055, lon=-0.0975)) < 5
    assert 80 < brg < 100


def test_circle_polygon_closed() -> None:
    ring = circle_polygon(LatLon(lat=51.5, lon=-0.1), 30).coordinates[0]
    assert ring[0] == ring[-1]


ORS_SAMPLE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": LINE},
            "properties": {"summary": {"distance": 1190.0, "duration": 265.0}},
        }
    ],
}


def _provider(handler) -> OpenRouteServiceProvider:  # type: ignore[no-untyped-def]
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return OpenRouteServiceProvider(http, "test-key")


async def test_ors_normalises_and_sends_avoid_polygons() -> None:
    seen: list[dict] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        assert req.url.path == "/v2/directions/cycling-regular/geojson"
        return httpx.Response(200, json=ORS_SAMPLE)

    ors = _provider(handler)
    routes = await ors.candidate_routes(
        LatLon(lat=51.5058, lon=-0.105), LatLon(lat=51.505, lon=-0.088), []
    )
    assert routes[0].role == "primary" and routes[0].provenance == "live_provider"
    assert routes[0].duration_s == 265.0
    assert "alternative_routes" in seen[0]

    ex = RouteExclusion(hazard_id="hz1", center=LatLon(lat=51.5055, lon=-0.0975))
    detour = await ors.candidate_routes(
        LatLon(lat=51.5058, lon=-0.105), LatLon(lat=51.505, lon=-0.088), [ex]
    )
    assert seen[1]["options"]["avoid_polygons"]["type"] == "MultiPolygon"
    assert detour[0].role == "detour"
    assert detour[0].avoids_hazard_ids == []  # this sample still passes through the hazard


async def test_ors_failure_is_unavailable_and_cached() -> None:
    calls = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, text="down")

    cached = CachedRouting(_provider(handler))
    o, d = LatLon(lat=51.5, lon=-0.1), LatLon(lat=51.5, lon=-0.09)
    for _ in range(3):
        with pytest.raises(RoutingUnavailable):
            await cached.candidate_routes(o, d, [])
    assert calls == 1
    assert cached.last_error


async def test_ors_without_key_is_unavailable() -> None:
    ors = OpenRouteServiceProvider(httpx.AsyncClient(), "")
    with pytest.raises(RoutingUnavailable):
        await ors.candidate_routes(LatLon(lat=0, lon=0), LatLon(lat=0, lon=0.01), [])


async def test_store_replays_recorded_response_labelled_cached(tmp_path) -> None:  # type: ignore[no-untyped-def]
    up = True

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=ORS_SAMPLE) if up else httpx.Response(503, text="down")

    store = tmp_path / "ors.json"
    o, d = LatLon(lat=51.5058, lon=-0.105), LatLon(lat=51.505, lon=-0.088)
    first = await CachedRouting(_provider(handler), store_path=store).candidate_routes(o, d, [])
    assert first[0].provenance == "live_provider"

    up = False
    later = CachedRouting(_provider(handler), store_path=store)  # fresh process, provider down
    routes = await later.candidate_routes(o, d, [])
    assert routes[0].provenance == "cached_provider"
    assert later.serving_cached and later.last_error
    assert any("replayed" in w for w in routes[0].warnings)
