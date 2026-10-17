"""RideAhead session runtime (lane A): the only authoritative owner of session state.

Replay is simulated in 1 s ticks so any sequence of advance calls reaching time T gives the same
state (going backwards resets the engine and replays from 0). At each tick:

    reveal observations with session_time_s <= tick → engine.ingest
    hazards = engine.snapshot(tick)
    move Bike A along its recorded/anchored track, Bike B (simulated) along its active route
    routes  = base candidates + provider detours avoiding active hazards (cached)
    decision = engine.score_routes(...) for Bike B; a reroute switches B's active route

Session reads never advance time or call models. Mutations hold a per-session lock and bump
the monotonic revision.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import math
import uuid
from collections.abc import Callable
from pathlib import Path

import weave
from pydantic import BaseModel, Field

from app.agent.geo import cumulative_m, line_length_m, point_along, project
from app.agent.interfaces import HazardEngine, PerceptionProvider, RoutingUnavailable
from app.agent.models import (
    Decision,
    Hazard,
    IntegrationStatus,
    LatLon,
    Observation,
    PersistencePrior,
    Rider,
    RouteCandidate,
    RouteExclusion,
    SessionConfig,
    SessionConfigUpdate,
    SessionEvent,
    SessionSnapshot,
)
from app.agent.routing import CachedRouting

log = logging.getLogger(__name__)

MAX_SESSIONS = 32
MAX_EVENTS = 200
EXCLUSION_RADIUS_M = 30.0


# -- scenario ------------------------------------------------------------------------------


class TrackPoint(BaseModel):
    session_time_s: float
    lat: float
    lon: float


class SimulatedRiderSpec(BaseModel):
    rider_id: str = "bike_b"
    label: str = "Bike B (simulated)"
    depart_s: float = 0
    speed_mps: float = 5.0


class Scenario(BaseModel):
    """A replayable demo story. Files live in server/fixtures/rideahead/."""

    scenario_id: str
    title: str
    ride_id: str
    duration_s: float
    origin: LatLon
    destination: LatLon
    observer_label: str = "Bike A (recorded)"
    observer_track: list[TrackPoint] = Field(
        default_factory=list, description="Bike A positions; manually reconstructed if no GPS"
    )
    simulated_rider: SimulatedRiderSpec = Field(default_factory=SimulatedRiderSpec)
    fixture_observations: list[Observation] = Field(
        default_factory=list,
        description="placeholder observations used ONLY with the fixture perception provider",
    )
    synthetic_observations: list[Observation] = Field(
        default_factory=list, description="labelled scenario events (e.g. synthetic clearance)"
    )
    persistence_overrides: dict[str, PersistencePrior] = Field(default_factory=dict)
    labels: list[str] = Field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> Scenario:
        return cls.model_validate_json(path.read_text())


def track_position(track: list[TrackPoint], t: float) -> LatLon | None:
    if not track or t < track[0].session_time_s:
        return None
    for a, b in itertools.pairwise(track):
        if a.session_time_s <= t <= b.session_time_s:
            span = b.session_time_s - a.session_time_s
            f = 0.0 if span == 0 else (t - a.session_time_s) / span
            return LatLon(lat=a.lat + (b.lat - a.lat) * f, lon=a.lon + (b.lon - a.lon) * f)
    last = track[-1]
    return LatLon(lat=last.lat, lon=last.lon)


# -- session -------------------------------------------------------------------------------


class Session:
    def __init__(
        self,
        session_id: str,
        scenario: Scenario,
        observations: list[Observation],
        engine_factory: Callable[[SessionConfig], HazardEngine],
        routing: CachedRouting,
        config: SessionConfig,
    ) -> None:
        self.session_id = session_id
        self.scenario = scenario
        self.all_observations = sorted(
            observations, key=lambda o: (o.session_time_s, o.observation_id)
        )
        self.engine_factory = engine_factory
        self.routing = routing
        self.config = config
        self.lock = asyncio.Lock()
        self.revision = 0
        self.routing_error: str | None = None
        self._init_state()

    # state that replay rebuilds from scratch
    def _init_state(self) -> None:
        self.engine = self.engine_factory(self.config)
        self.t = 0.0
        self.revealed = 0
        self.hazards: list[Hazard] = []
        self.routes: list[RouteCandidate] = []
        self.base_routes: list[RouteCandidate] | None = None
        self.decision: Decision | None = None
        self.history: list[Decision] = []
        self._cumulative: dict[str, list[float]] = {}
        self.events: list[SessionEvent] = []
        spec = self.scenario.simulated_rider
        self.rider_b = Rider(
            rider_id=spec.rider_id,
            label=spec.label,
            simulated=True,
            position=self.scenario.origin,
            speed_mps=spec.speed_mps,
            origin=self.scenario.origin,
            destination=self.scenario.destination,
            status="waiting",
        )
        self.rider_a = Rider(
            rider_id="bike_a",
            label=self.scenario.observer_label,
            simulated=False,
            position=track_position(self.scenario.observer_track, 0.0),
            status="recorded",
        )

    def _event(self, kind: str, message: str, ref_ids: list[str] | None = None) -> None:
        self.events.append(
            SessionEvent(session_time_s=self.t, kind=kind, message=message, ref_ids=ref_ids or [])  # type: ignore[arg-type]
        )
        del self.events[:-MAX_EVENTS]

    # -- routes ----------------------------------------------------------------------------

    async def _routes_for(self, hazards: list[Hazard]) -> list[RouteCandidate]:
        sc = self.scenario
        try:
            if self.base_routes is None:
                self.base_routes = await self.routing.candidate_routes(
                    sc.origin, sc.destination, []
                )
                self._event(
                    "route", f"{len(self.base_routes)} base route(s) from {self.routing.name}"
                )
            routes = list(self.base_routes)
            exclusions = [
                RouteExclusion(
                    hazard_id=h.hazard_id,
                    center=LatLon(lat=h.location.lat, lon=h.location.lon),
                    radius_m=EXCLUSION_RADIUS_M,
                )
                for h in hazards
                if h.state != "cleared"
                and h.location.lat is not None
                and h.location.lon is not None
            ]
            if exclusions:
                seen = {r.route_id for r in routes}
                detours = await self.routing.candidate_routes(sc.origin, sc.destination, exclusions)
                routes += [d for d in detours if d.route_id not in seen]
            self.routing_error = None
            return routes
        except RoutingUnavailable as exc:
            if self.routing_error != str(exc):
                self._event("route", f"routing unavailable: {exc}")
            self.routing_error = str(exc)
            return list(self.base_routes or [])

    # -- simulation ------------------------------------------------------------------------

    def _move_rider_b(self, t: float, dt: float) -> None:
        b = self.rider_b
        route = next((r for r in self.routes if r.route_id == b.active_route_id), None)
        if route is None:
            return
        if b.status == "waiting" and t >= self.scenario.simulated_rider.depart_s:
            b.status = "riding"
            self._event("system", f"{b.label} departs", [b.rider_id])
        if b.status != "riding":
            return
        length = line_length_m(route.geometry.coordinates)
        b.progress_m = min(length, b.progress_m + b.speed_mps * dt)
        b.position, b.bearing_deg = point_along(route.geometry.coordinates, b.progress_m)
        if b.progress_m >= length:
            b.status = "arrived"
            self._event("system", f"{b.label} arrived", [b.rider_id])

    def _update_navigation(self) -> None:
        """Remaining distance/time and next maneuver for Bike B on its active route."""
        b = self.rider_b
        route = next((r for r in self.routes if r.route_id == b.active_route_id), None)
        if route is None:
            b.distance_remaining_m = b.duration_remaining_s = None
            b.next_step_index = b.distance_to_next_step_m = None
            return
        cum = self._cumulative.get(route.route_id)
        if cum is None:
            cum = self._cumulative[route.route_id] = cumulative_m(route.geometry.coordinates)
        length = cum[-1] if cum else 0.0
        remaining = max(0.0, length - b.progress_m)
        b.distance_remaining_m = round(remaining, 1)
        b.duration_remaining_s = round(route.duration_s * remaining / length, 1) if length else 0.0
        b.next_step_index = b.distance_to_next_step_m = None
        for i, step in enumerate(route.steps):
            if step.maneuver_type == "depart" or not 0 <= step.start_index < len(cum):
                continue
            ahead = cum[step.start_index] - b.progress_m
            if ahead > 1.0 or (step.maneuver_type == "arrive" and b.status != "arrived"):
                b.next_step_index = i
                b.distance_to_next_step_m = round(max(0.0, ahead), 1)
                break

    def _switch_route(self, route_id: str) -> None:
        b = self.rider_b
        new = next((r for r in self.routes if r.route_id == route_id), None)
        if new is None or route_id == b.active_route_id:
            return
        if b.position is not None and b.progress_m > 0:
            b.progress_m = project(b.position, new.geometry.coordinates).along_m
        b.active_route_id = route_id

    @staticmethod
    def _same(a: Decision | None, b: Decision) -> bool:
        return a is not None and (a.action, a.selected_route_id, a.hazard_ids) == (
            b.action,
            b.selected_route_id,
            b.hazard_ids,
        )

    async def _tick(self, t: float, dt: float) -> None:
        self.t = t
        while (
            self.revealed < len(self.all_observations)
            and self.all_observations[self.revealed].session_time_s <= t
        ):
            obs = self.all_observations[self.revealed]
            self.revealed += 1
            try:
                hz = self.engine.ingest(obs)
            except ValueError as exc:  # engine rejected malformed input: log, never crash replay
                log.warning("engine rejected %s: %s", obs.observation_id, exc)
                self._event("system", f"rejected {obs.observation_id}: {exc}", [obs.observation_id])
                continue
            tag = f" [{obs.label}]" if obs.label else ""
            self._event(
                "observation",
                f"{obs.observer_id}: {obs.assertion} {obs.hazard_type} ({obs.support}){tag}",
                [obs.observation_id] + ([hz.hazard_id] if hz else []),
            )
        before = {h.hazard_id: h.state for h in self.hazards}
        self.hazards = self.engine.snapshot(t)
        for h in self.hazards:
            if before.get(h.hazard_id) != h.state:
                self._event("hazard", f"{h.hazard_id} → {h.state}", [h.hazard_id])
                record_hazard_transition(
                    self.session_id,
                    t,
                    h.hazard_id,
                    before.get(h.hazard_id),
                    h.state,
                    list(h.observation_ids),
                    h.clearance_observation_id,
                )

        self.rider_a.position = (
            track_position(self.scenario.observer_track, t) or self.rider_a.position
        )
        routes = await self._routes_for(self.hazards)
        active = next((r for r in self.routes if r.route_id == self.rider_b.active_route_id), None)
        if active is not None and all(r.route_id != active.route_id for r in routes):
            routes.append(active)  # the route the rider is on never disappears under them
        self.routes = routes
        b = self.rider_b
        b.candidate_route_ids = [r.route_id for r in self.routes]
        if b.active_route_id is None and self.routes:
            b.active_route_id = self.routes[0].route_id
        self._move_rider_b(t, dt)
        self._update_navigation()
        if b.status == "arrived":
            return
        decision = self.engine.score_routes(self.routes, b, self.hazards, self.config, t)
        decision.session_time_s = t
        decision.changed = not self._same(self.decision, decision)
        decision.revision = self.revision + 1
        if decision.changed:
            self.history.append(decision)
            self._event(
                "decision",
                f"{b.rider_id}: {decision.action} — {decision.reason}",
                [decision.decision_id],
            )
            record_decision(decision)
        if decision.action == "reroute" and decision.selected_route_id:
            self._switch_route(decision.selected_route_id)
            self._update_navigation()
        self.decision = decision

    async def _replay_from_zero(self) -> None:
        self._init_state()
        await self._tick(0.0, 0.0)

    async def advance(self, to_s: float) -> None:
        target = float(min(self.scenario.duration_s, max(0.0, round(to_s))))
        if self.revision > 0 and target == self.t:
            return
        if self.revision == 0 or target < self.t:
            await self._replay_from_zero()
        t = math.floor(self.t)
        while t < target:
            t += 1
            await self._tick(float(t), 1.0)
        self.revision += 1

    async def update_config(self, update: SessionConfigUpdate) -> None:
        patch = update.model_dump(exclude_none=True)
        if not patch:
            return
        self.config = self.config.model_copy(update=patch)
        target = self.t
        await self._replay_from_zero()  # deterministic: rebuild under the new config
        t = 0
        while t < target:
            t += 1
            await self._tick(float(t), 1.0)
        self.revision += 1

    def snapshot(self, integrations: list[IntegrationStatus]) -> SessionSnapshot:
        labels = list(self.scenario.labels)
        if self.routes and all(r.provenance == "fixture" for r in self.routes):
            labels.append("Fixture routes (hand-drawn) — not real routing")
        elif any(r.provenance == "cached_provider" for r in self.routes):
            labels.append("Routes: recorded openrouteservice responses replayed (not live)")
        if self.routing_error:
            labels.append(f"Routing unavailable: {self.routing_error}")
        return SessionSnapshot(
            session_id=self.session_id,
            revision=self.revision,
            scenario_id=self.scenario.scenario_id,
            ride_id=self.scenario.ride_id,
            replay_time_s=self.t,
            duration_s=self.scenario.duration_s,
            riders=[self.rider_a, self.rider_b],
            observations=self.all_observations[: self.revealed],
            hazards=self.hazards,
            routes=self.routes,
            decisions=[self.decision] if self.decision else [],
            decision_history=self.history,
            events=self.events,
            config=self.config,
            integrations=integrations,
            labels=labels,
        )

    def save(self, directory: Path, integrations: list[IntegrationStatus]) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{self.session_id}.json"
        path.write_text(self.snapshot(integrations).model_dump_json(indent=2))


@weave.op
def record_hazard_transition(
    session_id: str,
    session_time_s: float,
    hazard_id: str,
    from_state: str | None,
    to_state: str,
    observation_ids: list[str],
    clearance_observation_id: str | None,
) -> str:
    """Weave trace point per lifecycle change. IDs and states only: no captions, media or URLs."""
    return to_state


@weave.op
def record_decision(decision: Decision) -> Decision:
    """Weave trace point: one call per decision change, linked by decision/evidence IDs."""
    return decision


# -- runtime -------------------------------------------------------------------------------


class SessionNotFound(KeyError):
    pass


class RideAheadRuntime:
    def __init__(
        self,
        perception: PerceptionProvider,
        routing: CachedRouting,
        engine_factory: Callable[[SessionConfig], HazardEngine],
        scenario: Scenario,
        integrations: Callable[[], list[IntegrationStatus]],
        snapshot_dir: Path | None = None,
    ) -> None:
        self.perception = perception
        self.routing = routing
        self.engine_factory = engine_factory
        self.scenario = scenario
        self.integrations = integrations
        self.snapshot_dir = snapshot_dir
        self.sessions: dict[str, Session] = {}
        self._engine_name = getattr(engine_factory(SessionConfig()), "name", "unknown")

    @property
    def engine_name(self) -> str:
        return self._engine_name

    def default_config(self) -> SessionConfig:
        config = SessionConfig()
        for type_name, prior in self.scenario.persistence_overrides.items():
            if type_name in config.hazard_types:
                config.hazard_types[type_name].persistence = prior
        return config

    @weave.op
    async def create_session(self, ride_id: str | None = None) -> SessionSnapshot:
        ride = ride_id or self.scenario.ride_id
        observations = await self.perception.inspect_ride(ride)
        if self.perception.name == "fixture":
            observations += [o.model_copy(deep=True) for o in self.scenario.fixture_observations]
        observations += [o.model_copy(deep=True) for o in self.scenario.synthetic_observations]
        session = Session(
            uuid.uuid4().hex[:12],
            self.scenario.model_copy(update={"ride_id": ride}),
            observations,
            self.engine_factory,
            self.routing,
            self.default_config(),
        )
        async with session.lock:
            await session.advance(0)
        self.sessions[session.session_id] = session
        while len(self.sessions) > MAX_SESSIONS:
            self.sessions.pop(next(iter(self.sessions)))
        return self._snapshot(session)

    def get(self, session_id: str) -> Session:
        try:
            return self.sessions[session_id]
        except KeyError as exc:
            raise SessionNotFound(session_id) from exc

    def snapshot(self, session_id: str) -> SessionSnapshot:
        return self.get(session_id).snapshot(self.integrations())

    @weave.op
    async def advance(self, session_id: str, to_s: float) -> SessionSnapshot:
        session = self.get(session_id)
        async with session.lock:
            await session.advance(to_s)
            return self._snapshot(session)

    async def update_config(self, session_id: str, update: SessionConfigUpdate) -> SessionSnapshot:
        session = self.get(session_id)
        async with session.lock:
            await session.update_config(update)
            return self._snapshot(session)

    def _snapshot(self, session: Session) -> SessionSnapshot:
        integrations = self.integrations()
        if self.snapshot_dir is not None:
            try:
                session.save(self.snapshot_dir, integrations)
            except OSError as exc:
                log.warning("snapshot save failed: %s", exc)
        return session.snapshot(integrations)
