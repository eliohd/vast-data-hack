"""D-owned internal values, NOT the canonical REST contract.

hazards.py/scoring.py adapt Agent A's canonical models at the frozen boundary.
All distances are metres, times are session seconds, and bearings are degrees.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite
from typing import Literal

Assertion = Literal["present", "clear", "unclear"]
Support = Literal["supported", "uncertain", "contradicted"]
State = Literal["observed", "confirmed", "stale", "disputed", "cleared"]
Strength = Literal["single_sighting", "continued_observation", "independent_corroboration"]
Action = Literal["continue", "heads_up", "slow", "wait", "reroute", "unavailable"]
Provenance = Literal["recorded", "cached_recorded", "synthetic"]


def nonnegative(value: float, name: str) -> None:
    if not isfinite(value) or value < 0:
        raise ValueError(f"{name} must be finite and nonnegative")


@dataclass(frozen=True)
class Location:
    directed_road_id: str | None = None
    lat: float | None = None
    lon: float | None = None
    bearing_deg: float | None = None
    uncertainty_m: float | None = None
    method: Literal["metadata", "manual_anchor", "interpolated", "unknown"] = "unknown"
    notes: str = ""

    def __post_init__(self) -> None:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon must be supplied together")
        if self.lat is not None and (not isfinite(self.lat) or not -90 <= self.lat <= 90):
            raise ValueError("invalid latitude")
        if self.lon is not None and (not isfinite(self.lon) or not -180 <= self.lon <= 180):
            raise ValueError("invalid longitude")
        if self.bearing_deg is not None and (
            not isfinite(self.bearing_deg) or not 0 <= self.bearing_deg < 360
        ):
            raise ValueError("invalid bearing")
        if self.uncertainty_m is not None:
            nonnegative(self.uncertainty_m, "uncertainty_m")


@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    ride_id: str
    segment_id: str
    camera_id: str
    clip_start_s: float
    clip_end_s: float
    ride_offset_s: float
    # Source sighting mapped onto the session timeline, NOT cache retrieval time.
    # Runtime must keep the observation hidden until both this time and its
    # session_time_s have been reached.
    available_at_s: float
    provenance: Provenance
    # True only after checking that the previously affected area is visible.
    affected_area_visible: bool = False
    model_version: str | None = None
    prompt_version: str | None = None
    recorded_at_s: float | None = None

    def __post_init__(self) -> None:
        if not all((self.evidence_id, self.ride_id, self.segment_id, self.camera_id)):
            raise ValueError("evidence requires stable source identifiers")
        for name in ("clip_start_s", "clip_end_s", "ride_offset_s", "available_at_s"):
            nonnegative(getattr(self, name), name)
        if self.clip_end_s <= self.clip_start_s:
            raise ValueError("evidence clip must have positive duration")
        if self.provenance not in ("recorded", "cached_recorded", "synthetic"):
            raise ValueError("invalid evidence provenance")
        if self.recorded_at_s is not None and not isfinite(self.recorded_at_s):
            raise ValueError("recorded_at_s must be finite")

    @property
    def source_key(self) -> tuple[str, str, str, float, float, float]:
        return (
            self.ride_id,
            self.segment_id,
            self.camera_id,
            self.clip_start_s,
            self.clip_end_s,
            self.ride_offset_s,
        )


@dataclass(frozen=True)
class Observation:
    observation_id: str
    hazard_type: str
    assertion: Assertion
    support: Support
    location: Location
    observer_id: str
    source_group_id: str
    session_time_s: float
    ride_offset_s: float
    evidence: tuple[Evidence, ...]
    description: str = ""

    def __post_init__(self) -> None:
        if not all((self.observation_id, self.hazard_type, self.observer_id, self.source_group_id)):
            raise ValueError("observation requires stable identity and source group")
        if self.assertion not in ("present", "clear", "unclear"):
            raise ValueError("invalid assertion")
        if self.support not in ("supported", "uncertain", "contradicted"):
            raise ValueError("invalid support")
        nonnegative(self.session_time_s, "session_time_s")
        nonnegative(self.ride_offset_s, "ride_offset_s")
        if any(e.available_at_s > self.session_time_s for e in self.evidence):
            raise ValueError("an observation cannot contain future evidence")


@dataclass(frozen=True)
class HazardPrior:
    hazard_type: str = "lane_blocked"
    version: str = "demo-v1"
    stale_after_s: float = 120
    half_life_s: float = 180
    obstruction_delay_s: float = 90
    continuation_gap_s: float = 30
    match_radius_m: float = 50
    clearance_uncertainty_m: float = 25
    impact: Literal["minor", "serious"] = "serious"

    def __post_init__(self) -> None:
        for name in ("stale_after_s", "half_life_s", "continuation_gap_s"):
            value = getattr(self, name)
            if not isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        nonnegative(self.obstruction_delay_s, "obstruction_delay_s")
        nonnegative(self.match_radius_m, "match_radius_m")
        nonnegative(self.clearance_uncertainty_m, "clearance_uncertainty_m")
        if self.impact not in ("minor", "serious"):
            raise ValueError("invalid impact")


@dataclass(frozen=True)
class Hazard:
    hazard_id: str
    hazard_type: str
    location: Location
    state: State
    observation_ids: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    first_seen_s: float
    last_supported_s: float
    evidence_strength: Strength
    impact: Literal["minor", "serious"]
    prior: HazardPrior
    as_of_s: float
    provenance: tuple[Provenance, ...]
    clearance_evidence_id: str | None = None


@dataclass(frozen=True)
class RoutePassage:
    """Provider/anchor supplied route match; no distance-only hazard matching.

    progress_m is measured from the route origin. arrival_s is the provider's
    estimated time from that origin (NOT from the current rider position).
    """

    directed_road_id: str
    progress_m: float
    arrival_s: float
    bearing_deg: float | None = None

    def __post_init__(self) -> None:
        nonnegative(self.progress_m, "progress_m")
        nonnegative(self.arrival_s, "arrival_s")
        if not self.directed_road_id:
            raise ValueError("route passage requires a directed road")
        if self.bearing_deg is not None:
            Location(bearing_deg=self.bearing_deg)


@dataclass(frozen=True)
class Route:
    route_id: str
    duration_s: float
    distance_m: float
    passages: tuple[RoutePassage, ...]
    provider: str = "fixture"
    bicycle_profile: str = "cycling-regular"
    provenance: Literal["live_provider", "recorded_provider", "fixture"] = "fixture"
    available: bool = True
    # False when map-matching/coverage failed. An empty, checked route is distinct.
    coverage_complete: bool = True
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        nonnegative(self.duration_s, "duration_s")
        nonnegative(self.distance_m, "distance_m")
        if not self.route_id or not self.provider:
            raise ValueError("route requires identity and provider")
        if self.provenance not in ("live_provider", "recorded_provider", "fixture"):
            raise ValueError("invalid route provenance")
        previous = (-1.0, -1.0)
        for passage in self.passages:
            if (
                passage.progress_m > self.distance_m
                or passage.arrival_s > self.duration_s
                or passage.progress_m < previous[0]
                or passage.arrival_s < previous[1]
            ):
                raise ValueError("route passages must be ordered and within route bounds")
            previous = (passage.progress_m, passage.arrival_s)


@dataclass(frozen=True)
class Rider:
    rider_id: str
    current_route_id: str
    progress_m: float = 0
    elapsed_route_s: float = 0
    bearing_deg: float | None = None
    simulated: bool = True

    def __post_init__(self) -> None:
        nonnegative(self.progress_m, "progress_m")
        nonnegative(self.elapsed_route_s, "elapsed_route_s")
        if self.bearing_deg is not None:
            Location(bearing_deg=self.bearing_deg)


@dataclass(frozen=True)
class DecisionConfig:
    short_radius_m: float = 200
    planning_area_m: float = 2000
    wait_limit_s: float = 30
    max_bearing_difference_deg: float = 60
    max_location_uncertainty_m: float = 50

    def __post_init__(self) -> None:
        for name in (
            "short_radius_m",
            "planning_area_m",
            "wait_limit_s",
            "max_location_uncertainty_m",
        ):
            nonnegative(getattr(self, name), name)
        if self.short_radius_m > self.planning_area_m:
            raise ValueError("short radius cannot exceed planning area")
        if (
            not isfinite(self.max_bearing_difference_deg)
            or not 0 <= self.max_bearing_difference_deg <= 180
        ):
            raise ValueError("invalid bearing tolerance")


@dataclass(frozen=True)
class RouteScore:
    route_id: str
    remaining_duration_s: float
    estimated_delay_s: float
    total_cost_s: float
    hazard_ids: tuple[str, ...]
    uncertain: bool = False


@dataclass(frozen=True)
class Decision:
    rider_id: str
    action: Action
    selected_route_id: str | None
    hazard_ids: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    estimated_delay_s: float | None
    detour_cost_s: float | None
    reason: str
    now_s: float
    assumptions: tuple[str, ...]
    route_scores: tuple[RouteScore, ...] = field(default_factory=tuple)
