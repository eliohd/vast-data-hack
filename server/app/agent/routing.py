"""Routing providers (lane A): openrouteservice (real, bicycle profile) and a labelled fixture.

Both return normalised `RouteCandidate`s. `CachedRouting` wraps either so session polling and
1 s replay ticks never recalculate the same request.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx
import weave

from app.agent.geo import circle_polygon, project
from app.agent.interfaces import RoutingProvider, RoutingUnavailable
from app.agent.models import LatLon, LineString, RouteCandidate, RouteExclusion

log = logging.getLogger(__name__)


def _route_id(prefix: str, coords: list[list[float]]) -> str:
    digest = hashlib.sha1(json.dumps(coords[:: max(1, len(coords) // 50)]).encode()).hexdigest()
    return f"{prefix}-{digest[:10]}"


def _avoids(route: RouteCandidate, exclusions: list[RouteExclusion]) -> list[str]:
    return [
        ex.hazard_id
        for ex in exclusions
        if project(ex.center, route.geometry.coordinates).offset_m > ex.radius_m
    ]


class FixtureRoutingProvider:
    """Hand-drawn routes from a fixture file. Always labelled `fixture`; not real routing."""

    name = "fixture"

    def __init__(self, path: Path) -> None:
        data = json.loads(path.read_text())
        self.routes = [RouteCandidate.model_validate(r) for r in data["routes"]]

    async def candidate_routes(
        self, origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]
    ) -> list[RouteCandidate]:
        out: list[RouteCandidate] = []
        for r in self.routes:
            avoided = _avoids(r, exclusions)
            if exclusions and len(avoided) < len(exclusions):
                continue  # passes through an excluded area
            route = r.model_copy(deep=True)
            if exclusions:
                route.role = "detour"
                route.avoids_hazard_ids = avoided
            out.append(route)
        return out


class OpenRouteServiceProvider:
    """openrouteservice directions v2, `cycling-*` profile, GeoJSON output.

    Base requests ask for provider-computed alternatives; exclusion requests send avoid
    polygons (ORS `options.avoid_polygons`). We never build our own road graph.
    """

    name = "openrouteservice"

    def __init__(
        self,
        http: httpx.AsyncClient,
        api_key: str,
        base_url: str = "https://api.openrouteservice.org",
        profile: str = "cycling-regular",
        timeout_s: float = 15.0,
    ) -> None:
        self.http = http
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.profile = profile
        self.timeout_s = timeout_s

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _body(
        self, origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "coordinates": [[origin.lon, origin.lat], [destination.lon, destination.lat]],
            "instructions": False,
            "elevation": False,
        }
        if exclusions:
            polys = [
                (ex.polygon or circle_polygon(ex.center, ex.radius_m)).coordinates
                for ex in exclusions
            ]
            body["options"] = {"avoid_polygons": {"type": "MultiPolygon", "coordinates": polys}}
        else:
            body["alternative_routes"] = {
                "target_count": 2,
                "weight_factor": 1.6,
                "share_factor": 0.6,
            }
        return body

    @weave.op
    async def candidate_routes(
        self, origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]
    ) -> list[RouteCandidate]:
        if not self.configured:
            raise RoutingUnavailable("openrouteservice API key not configured")
        url = f"{self.base_url}/v2/directions/{self.profile}/geojson"
        try:
            res = await self.http.post(
                url,
                json=self._body(origin, destination, exclusions),
                headers={"Authorization": self.api_key, "Accept": "application/geo+json"},
                timeout=self.timeout_s,
            )
        except httpx.HTTPError as exc:
            raise RoutingUnavailable(f"openrouteservice unreachable: {type(exc).__name__}") from exc
        if res.status_code == 404 or (res.status_code == 400 and "2009" in res.text):
            return []  # no route exists under these constraints
        if res.status_code >= 400:
            raise RoutingUnavailable(f"openrouteservice HTTP {res.status_code}: {res.text[:200]}")
        return self.normalise(res.json(), exclusions)

    def normalise(
        self, data: dict[str, Any], exclusions: list[RouteExclusion]
    ) -> list[RouteCandidate]:
        out: list[RouteCandidate] = []
        for i, feat in enumerate(data.get("features", [])):
            coords = feat["geometry"]["coordinates"]
            summary = feat.get("properties", {}).get("summary", {})
            warnings = [
                str(w.get("message", w)) for w in feat.get("properties", {}).get("warnings", [])
            ]
            role = "detour" if exclusions else ("primary" if i == 0 else "alternative")
            route = RouteCandidate(
                route_id=_route_id("ors", coords),
                role=role,
                geometry=LineString(coordinates=[[c[0], c[1]] for c in coords]),
                duration_s=float(summary.get("duration", 0.0)),
                distance_m=float(summary.get("distance", 0.0)),
                provider="openrouteservice",
                profile=self.profile,
                provenance="live_provider",
                warnings=warnings,
            )
            route.avoids_hazard_ids = _avoids(route, exclusions)
            out.append(route)
        return out


class CachedRouting:
    """Caches by (origin, destination, exclusions). Failures are cached briefly so a dead
    provider is not hammered by replay ticks.

    With `store_path`, genuine provider responses are also saved to disk. When the provider is
    unavailable later, a stored response is replayed with provenance `cached_provider` and a
    warning — never presented as a live call.
    """

    def __init__(
        self, inner: RoutingProvider, failure_ttl_s: float = 30.0, store_path: Path | None = None
    ) -> None:
        self.inner = inner
        self.name = inner.name
        self.failure_ttl_s = failure_ttl_s
        self.store_path = store_path
        self._ok: dict[str, list[RouteCandidate]] = {}
        self._failed: dict[str, tuple[float, str]] = {}
        self._store: dict[str, list[dict[str, Any]]] = {}
        if store_path is not None and store_path.is_file():
            try:
                self._store = json.loads(store_path.read_text()).get("responses", {})
            except (OSError, ValueError) as exc:
                log.warning("route store unreadable: %s", exc)
        self.last_error: str | None = None
        self.serving_cached = False
        self.calls = 0

    def _from_store(self, k: str) -> list[RouteCandidate] | None:
        if k not in self._store:
            return None
        routes = [RouteCandidate.model_validate(r) for r in self._store[k]]
        for r in routes:
            r.provenance = "cached_provider"
            r.warnings.append("recorded provider response replayed (provider unavailable now)")
        self.serving_cached = True
        return routes

    def _save(self, k: str, routes: list[RouteCandidate]) -> None:
        if self.store_path is None:
            return
        self._store[k] = [r.model_dump(mode="json") for r in routes]
        try:
            self.store_path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "_note": f"Genuine {self.name} responses recorded by CachedRouting. "
                "Route data © openrouteservice.org | © OpenStreetMap contributors (ODbL).",
                "responses": self._store,
            }
            self.store_path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n")
        except OSError as exc:
            log.warning("route store write failed: %s", exc)

    @staticmethod
    def key(origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]) -> str:
        ex = sorted(
            (e.hazard_id, round(e.center.lat, 5), round(e.center.lon, 5), e.radius_m)
            for e in exclusions
        )
        return json.dumps(
            [
                round(origin.lat, 5),
                round(origin.lon, 5),
                round(destination.lat, 5),
                round(destination.lon, 5),
                ex,
            ]
        )

    async def candidate_routes(
        self, origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]
    ) -> list[RouteCandidate]:
        k = self.key(origin, destination, exclusions)
        if k in self._ok:
            return [r.model_copy(deep=True) for r in self._ok[k]]
        failed = self._failed.get(k)
        if failed and time.monotonic() - failed[0] < self.failure_ttl_s:
            stored = self._from_store(k)
            if stored is not None:
                return stored
            raise RoutingUnavailable(failed[1])
        self.calls += 1
        try:
            routes = await self.inner.candidate_routes(origin, destination, exclusions)
        except RoutingUnavailable as exc:
            self._failed[k] = (time.monotonic(), str(exc))
            self.last_error = str(exc)
            stored = self._from_store(k)
            if stored is not None:
                return stored
            raise
        self.last_error = None
        self.serving_cached = False
        self._ok[k] = routes
        self._save(k, routes)
        return [r.model_copy(deep=True) for r in routes]
