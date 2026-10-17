"""RideAhead frozen module boundaries. Owned by lane A; signatures are frozen after bootstrap.

PerceptionProvider  lane C   app/agent/perception.py  (fixture: perception_fixture.py)
HazardEngine        lane D   app/agent/hazards.py + app/agent/scoring.py
RoutingProvider     lane A   app/agent/routing.py
Runtime             lane A   app/agent/runtime.py  (the only owner of session state)
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.agent.models import (
    Decision,
    Hazard,
    LatLon,
    Observation,
    RideManifest,
    Rider,
    RouteCandidate,
    RouteExclusion,
    SessionConfig,
    Verification,
)


@runtime_checkable
class PerceptionProvider(Protocol):
    """Archive + models → normalised observations. Upstream access stays inside the provider."""

    name: str

    async def list_rides(self) -> list[RideManifest]:
        """Normalised ride manifests."""
        ...

    async def inspect_ride(self, ride_id: str) -> list[Observation]:
        """All observations for a ride with ride-relative timing and `session_time_s` set.
        May be precomputed/cached; the runtime only reveals them as replay reaches them."""
        ...

    async def verify_evidence(self, evidence_id: str, question: str) -> Verification:
        """Re-check one clip. Failures and unparseable output → verdict 'unclear'."""
        ...


@runtime_checkable
class HazardEngine(Protocol):
    """Pure, network-free lifecycle. One instance per session, built with the session config."""

    name: str

    def ingest(self, observation: Observation) -> Hazard | None:
        """Applies one observation idempotently (same observation_id twice = no-op).
        Returns the affected hazard, or None if the observation was ignored."""
        ...

    def snapshot(self, as_of_s: float) -> list[Hazard]:
        """Hazards as of session time `as_of_s` (staleness / persistence weights evaluated)."""
        ...

    def reset(self) -> None:
        """Clears all session state."""
        ...

    def score_routes(
        self,
        routes: list[RouteCandidate],
        rider: Rider,
        hazards: list[Hazard],
        config: SessionConfig,
        now_s: float,
    ) -> Decision:
        """Deterministic decision for one rider. The runtime sets `changed` and `revision`.
        No routes → action 'unavailable' with an explanation."""
        ...


@runtime_checkable
class RoutingProvider(Protocol):
    name: str

    async def candidate_routes(
        self, origin: LatLon, destination: LatLon, exclusions: list[RouteExclusion]
    ) -> list[RouteCandidate]:
        """Normalised cycling route candidates (primary first). Raises RoutingUnavailable when
        the provider cannot be reached; returns [] when no route exists."""
        ...


class RoutingUnavailable(RuntimeError):
    pass
