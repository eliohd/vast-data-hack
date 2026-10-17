"""RideAhead canonical contract (schema_version "1"). Owned by lane A.

Frozen after bootstrap: required fields and their units do not change. Backward-compatible
optional fields with defaults may be added. Unknown data is an explicit null / "unknown" value,
never a guess.

Conventions
- Times are seconds (float). `session_time_s` is replay time in the session clock (starts at 0).
  `ride_offset_s` is seconds from the start of the recorded ride. `recorded_at` is the original
  wall-clock recording time when known. Processing time is never mixed with either.
- Distances are metres, durations seconds, bearings degrees clockwise from north [0, 360).
- GeoJSON geometry uses [longitude, latitude]. Everywhere else: named `lat` / `lon` fields.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION: Literal["1"] = "1"

HazardType = Literal["lane_blocked", "work_zone"]

# -- provenance ----------------------------------------------------------------------------

# Where a piece of footage evidence comes from.
EvidenceProvenance = Literal["recorded", "cached_recorded", "synthetic"]
# How the claim in an observation was produced.
#   live_model:          a model call made during this session
#   cached_model:        a genuine earlier model output, replayed (never presented as live)
#   synthetic_scenario:  a labelled scenario event (e.g. a synthetic clearance)
#   fixture:             development fixture, no model involved
ObservationSource = Literal["live_model", "cached_model", "synthetic_scenario", "fixture"]
LocationMethod = Literal["metadata", "manual_anchor", "interpolated", "unknown"]
RouteProvenance = Literal["live_provider", "cached_provider", "fixture"]


class LatLon(BaseModel):
    lat: float
    lon: float


class LineString(BaseModel):
    """GeoJSON LineString. coordinates are [lon, lat] pairs."""

    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]


class Polygon(BaseModel):
    """GeoJSON Polygon. coordinates are rings of [lon, lat]; first ring is the outer ring."""

    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]]


# -- evidence ------------------------------------------------------------------------------


class Evidence(BaseModel):
    evidence_id: str
    ride_id: str
    segment_id: str = Field(description="VSS source segment id (the `source` of the clip)")
    camera_id: str | None = None
    clip_start_s: float = Field(description="start within the segment clip, seconds")
    clip_end_s: float = Field(description="end within the segment clip, seconds")
    ride_offset_s: float = Field(description="seconds from the start of the recorded ride")
    recorded_at: datetime | None = Field(
        default=None, description="original recording time, if known"
    )
    media_ref: str | None = Field(
        default=None,
        description="app-controlled media path, e.g. /api/archive/media?source=… (never a JWT URL)",
    )
    provenance: EvidenceProvenance
    caption: str | None = Field(default=None, description="source caption / description excerpt")
    object_counts: dict[str, int] = Field(
        default_factory=dict, description="YOLO11 object counts for this clip, if available"
    )
    model: str | None = None
    prompt_version: str | None = None


class Verification(BaseModel):
    """Result of re-checking a clip (Cosmos Reason). Model checking is not ground truth."""

    evidence_id: str
    question: str
    verdict: Literal["supported", "contradicted", "unclear"]
    obstruction_visible: bool | None = None
    road_space_visible: bool | None = None
    rationale: str = ""
    model: str | None = None
    prompt_version: str | None = None
    source: Literal["live_model", "cached_model", "fixture"] = "fixture"
    latency_ms: int | None = None


# -- location ------------------------------------------------------------------------------


class LocationEstimate(BaseModel):
    lat: float | None = None
    lon: float | None = None
    road_segment_id: str | None = Field(
        default=None,
        description="directed road segment, e.g. 'southwark-st:eb' (direction-specific)",
    )
    bearing_deg: float | None = Field(
        default=None, description="travel bearing, degrees from north"
    )
    method: LocationMethod = "unknown"
    uncertainty_m: float | None = None
    notes: str = ""


# -- observation ---------------------------------------------------------------------------


class Observation(BaseModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    observation_id: str
    hazard_type: HazardType
    assertion: Literal["present", "clear", "unclear"]
    evidence: list[Evidence]
    location: LocationEstimate
    observer_id: str = Field(description="who saw it, e.g. 'bike_a'")
    source_group_id: str = Field(
        description="one sighting: adjacent chunks / repeated frames share this id, so they are "
        "never counted as independent observers"
    )
    description: str = Field(description="short factual description")
    support: Literal["supported", "uncertain", "contradicted"]
    verification: Verification | None = None
    model_confidence: float | None = Field(
        default=None, ge=0, le=1, description="model self-reported, UNCALIBRATED"
    )
    ride_offset_s: float
    session_time_s: float = Field(description="replay time at which this becomes available")
    source: ObservationSource
    label: str | None = Field(
        default=None, description="event-level label, e.g. 'Synthetic clearance (scenario event)'"
    )


# -- hazard --------------------------------------------------------------------------------

HazardState = Literal["observed", "confirmed", "stale", "disputed", "cleared"]


class PersistencePrior(BaseModel):
    """Type-based persistence assumption. A heuristic, not a validated probability."""

    half_life_s: float
    stale_after_s: float
    version: str = "demo-1"
    label: str = "demonstration assumption"


class Hazard(BaseModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    hazard_id: str
    hazard_type: HazardType
    location: LocationEstimate
    state: HazardState
    confirmation_kind: Literal["persistence", "independent"] | None = None
    observation_ids: list[str]
    first_seen_s: float = Field(description="session time")
    last_supported_s: float = Field(description="session time")
    persistence: PersistencePrior
    persistence_weight: float | None = Field(
        default=None, description="2 ** (-age_s / half_life_s) at snapshot time; heuristic weight"
    )
    evidence_strength: Literal["weak", "moderate", "strong", "unknown"] = "unknown"
    impact: Literal["low", "medium", "high", "unknown"] = "unknown"
    clearance_observation_id: str | None = None
    clearance_evidence_id: str | None = None
    summary: str = ""


# -- riders, routes, decisions -------------------------------------------------------------


class Rider(BaseModel):
    rider_id: str
    label: str
    simulated: bool
    position: LatLon | None = None
    bearing_deg: float | None = None
    progress_m: float = Field(default=0, description="distance travelled along active_route_id")
    speed_mps: float = 5.0
    origin: LatLon | None = None
    destination: LatLon | None = None
    active_route_id: str | None = None
    candidate_route_ids: list[str] = Field(default_factory=list)
    status: Literal["waiting", "riding", "arrived", "recorded"] = "waiting"
    # Set by the runtime for simulated riders on their active route (null when unknown).
    # Remaining duration scales the provider's route duration by remaining distance.
    distance_remaining_m: float | None = None
    duration_remaining_s: float | None = None
    next_step_index: int | None = Field(
        default=None, description="index into the active route's steps of the next maneuver"
    )
    distance_to_next_step_m: float | None = None


Maneuver = Literal[
    "depart",
    "arrive",
    "straight",
    "left",
    "right",
    "slight_left",
    "slight_right",
    "sharp_left",
    "sharp_right",
    "keep_left",
    "keep_right",
    "u_turn",
    "roundabout_enter",
    "roundabout_exit",
    "unknown",
]


class RouteStep(BaseModel):
    """One provider turn instruction. Indices point into `RouteCandidate.geometry.coordinates`."""

    instruction: str
    street_name: str | None = None
    maneuver_type: Maneuver = "unknown"
    distance_m: float
    duration_s: float
    start_index: int
    end_index: int


class RouteCandidate(BaseModel):
    route_id: str
    role: Literal["primary", "alternative", "detour"] = "primary"
    geometry: LineString
    duration_s: float
    distance_m: float
    provider: str = Field(description="'openrouteservice' or 'fixture'")
    profile: str = Field(description="e.g. 'cycling-regular'")
    provenance: RouteProvenance
    avoids_hazard_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    label: str = "bicycle route from provider, subject to map restrictions"
    steps: list[RouteStep] = Field(
        default_factory=list, description="provider turn-by-turn steps; empty for fixtures"
    )


class RouteExclusion(BaseModel):
    """Area a route should avoid (sent to the provider as an avoid polygon)."""

    hazard_id: str
    center: LatLon
    radius_m: float = 25.0
    polygon: Polygon | None = Field(
        default=None, description="explicit area; else a circle around center"
    )


Action = Literal["continue", "heads_up", "slow", "wait", "reroute", "unavailable"]


class Decision(BaseModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    decision_id: str
    rider_id: str
    hazard_ids: list[str] = Field(default_factory=list)
    action: Action
    selected_route_id: str | None = None
    estimated_delay_s: float | None = None
    detour_cost_s: float | None = None
    arrival_in_s: float | None = Field(
        default=None, description="estimated seconds until the hazard"
    )
    reason: str = Field(description="short deterministic reason")
    evidence_ids: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    changed: bool = Field(default=False, description="set by the runtime vs the previous decision")
    session_time_s: float = 0
    revision: int = Field(default=0, description="set by the runtime")
    explanation: str | None = Field(default=None, description="optional LLM wording of the facts")


# -- configuration -------------------------------------------------------------------------


class HazardTypeConfig(BaseModel):
    hazard_type: HazardType
    display_name: str
    persistence: PersistencePrior
    default_impact: Literal["low", "medium", "high"] = "medium"
    expected_delay_s: float = Field(
        default=60, description="assumed delay if the rider meets it (demonstration assumption)"
    )
    match_radius_m: float = 40.0


DEFAULT_HAZARD_TYPES: dict[str, HazardTypeConfig] = {
    "lane_blocked": HazardTypeConfig(
        hazard_type="lane_blocked",
        display_name="Blocked cycle lane",
        persistence=PersistencePrior(half_life_s=600, stale_after_s=900),
        default_impact="medium",
        expected_delay_s=45,
    ),
    "work_zone": HazardTypeConfig(
        hazard_type="work_zone",
        display_name="Work zone",
        persistence=PersistencePrior(half_life_s=6 * 3600, stale_after_s=24 * 3600),
        default_impact="high",
        expected_delay_s=120,
    ),
}


class SessionConfig(BaseModel):
    config_version: str = "1"
    share_radius_m: float = Field(
        default=200, ge=10, le=5000, description="short-radius alert setting"
    )
    planning_radius_m: float = Field(
        default=2000, ge=100, le=20000, description="planning-area setting"
    )
    hazard_types: dict[str, HazardTypeConfig] = Field(
        default_factory=lambda: {
            k: v.model_copy(deep=True) for k, v in DEFAULT_HAZARD_TYPES.items()
        }
    )
    explain_with_llm: bool = False


class SessionConfigUpdate(BaseModel):
    """PATCH body: every field optional."""

    share_radius_m: float | None = Field(default=None, ge=10, le=5000)
    planning_radius_m: float | None = Field(default=None, ge=100, le=20000)
    explain_with_llm: bool | None = None


# -- rides, status, snapshot ---------------------------------------------------------------


class SegmentRef(BaseModel):
    segment_id: str
    ride_offset_s: float
    duration_s: float
    media_ref: str | None = None
    caption: str | None = None


class RideManifest(BaseModel):
    ride_id: str
    title: str
    camera_id: str | None = None
    duration_s: float
    segments: list[SegmentRef] = Field(default_factory=list)
    has_gps: bool = False
    location_label: str = Field(
        default="", description="e.g. 'manually reconstructed route, Southwark (London)'"
    )
    provenance: EvidenceProvenance = "recorded"


IntegrationName = Literal["vast", "cosmos", "yolo", "wandb_inference", "weave", "routing"]
IntegrationState = Literal[
    "connected", "configured", "cached", "fixture", "unavailable", "not_configured"
]


class IntegrationStatus(BaseModel):
    name: IntegrationName
    state: IntegrationState
    detail: str = ""


class Capabilities(BaseModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    perception_provider: str
    routing_provider: str
    hazard_engine: str
    integrations: list[IntegrationStatus]
    hazard_types: list[HazardTypeConfig]
    default_config: SessionConfig


class SessionEvent(BaseModel):
    """Local activity log line. NOT a Weave trace."""

    session_time_s: float
    kind: Literal["observation", "hazard", "decision", "route", "system"]
    message: str
    ref_ids: list[str] = Field(default_factory=list)


class SessionSnapshot(BaseModel):
    schema_version: Literal["1"] = SCHEMA_VERSION
    session_id: str
    revision: int = Field(description="monotonic; increases on every state change")
    scenario_id: str
    ride_id: str
    replay_time_s: float
    duration_s: float
    riders: list[Rider]
    observations: list[Observation] = Field(description="only those revealed by replay_time_s")
    hazards: list[Hazard]
    routes: list[RouteCandidate]
    decisions: list[Decision] = Field(description="current decision per simulated rider")
    decision_history: list[Decision] = Field(default_factory=list)
    events: list[SessionEvent] = Field(default_factory=list)
    config: SessionConfig
    integrations: list[IntegrationStatus]
    labels: list[str] = Field(
        default_factory=list, description="simulation / provenance labels to always show"
    )


class CreateSessionRequest(BaseModel):
    scenario_id: str | None = None
    ride_id: str | None = None


class AdvanceRequest(BaseModel):
    to_s: float = Field(ge=0, description="target replay time; earlier than now resets + replays")
