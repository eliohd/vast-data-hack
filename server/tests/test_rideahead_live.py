"""Lane A: opt-in live openrouteservice check. Run: RIDEAHEAD_LIVE_ORS=1 uv run pytest -q -k live"""

import os

import httpx
import pytest

from app.agent.geo import project
from app.agent.models import LatLon, RouteExclusion
from app.agent.routing import OpenRouteServiceProvider
from app.config import Settings

pytestmark = pytest.mark.skipif(
    os.environ.get("RIDEAHEAD_LIVE_ORS") != "1", reason="live ORS test is opt-in"
)

ORIGIN = LatLon(lat=51.5058, lon=-0.1050)
DESTINATION = LatLon(lat=51.5050, lon=-0.0880)
HAZARD = LatLon(lat=51.504695, lon=-0.091513)  # fixture anchor on Southwark Street (eb)


async def test_live_ors_route_and_detour() -> None:
    s = Settings(tracing=False)
    async with httpx.AsyncClient() as http:
        ors = OpenRouteServiceProvider(http, s.ors_api_key.get_secret_value(), s.ors_base_url)
        base = await ors.candidate_routes(ORIGIN, DESTINATION, [])
        assert base and base[0].role == "primary"
        assert project(HAZARD, base[0].geometry.coordinates).offset_m < 20
        ex = RouteExclusion(hazard_id="hz", center=HAZARD, radius_m=30)
        detour = await ors.candidate_routes(ORIGIN, DESTINATION, [ex])
        assert detour and detour[0].avoids_hazard_ids == ["hz"]
        assert detour[0].route_id != base[0].route_id
