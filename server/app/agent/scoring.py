"""Lane D adapter: canonical provider geometry -> deterministic route policy.

The bootstrap contract has no provider road-edge IDs or segment durations.
Geometry/direction and a constant-speed approximation are explicitly labelled
proxies. No street graph is created, and no geometry is returned as real routing.
"""

from __future__ import annotations

from dataclasses import replace
from math import isfinite

from app.agent import hazard_types as internal
from app.agent.geo import angle_diff_deg, line_length_m, project
from app.agent.hazard_adapter import to_internal_hazard
from app.agent.models import (
    Decision,
    Hazard,
    LatLon,
    Observation,
    Rider,
    RouteCandidate,
    SessionConfig,
)
from app.agent.route_scoring import score_routes as pure_score_routes


def _valid_route(route: RouteCandidate) -> bool:
    coords = route.geometry.coordinates
    return (
        isfinite(route.duration_s)
        and route.duration_s > 0
        and isfinite(route.distance_m)
        and route.distance_m > 0
        and len(coords) >= 2
        and all(
            len(p) == 2
            and all(isfinite(v) for v in p)
            and -180 <= p[0] <= 180
            and -90 <= p[1] <= 90
            for p in coords
        )
        and line_length_m(coords) > 0
        and route.profile.startswith("cycling-")
    )


def hazard_on_route(
    h: Hazard,
    route: RouteCandidate,
    config: SessionConfig,
    from_m: float = 0.0,
) -> float | None:
    """Geometric relevance proxy; never use proximity to merge hazard identities."""
    location = h.location
    if (
        not _valid_route(route)
        or location.lat is None
        or location.lon is None
        or location.bearing_deg is None
        or not location.road_segment_id
        or location.uncertainty_m is None
        or h.hazard_type not in config.hazard_types
    ):
        return None
    projection = project(LatLon(lat=location.lat, lon=location.lon), route.geometry.coordinates)
    radius = config.hazard_types[h.hazard_type].match_radius_m
    if (
        projection.offset_m + location.uncertainty_m > radius
        or projection.along_m < from_m
        or angle_diff_deg(location.bearing_deg, projection.bearing_deg) > 60
    ):
        return None
    return projection.along_m


def score_routes(
    routes: list[RouteCandidate],
    rider: Rider,
    hazards: list[Hazard],
    config: SessionConfig,
    now_s: float,
) -> Decision:
    return score_with_evidence(routes, rider, hazards, config, now_s, {})


def score_with_evidence(
    routes: list[RouteCandidate],
    rider: Rider,
    hazards: list[Hazard],
    config: SessionConfig,
    now_s: float,
    observations: dict[str, Observation],
) -> Decision:
    internal.nonnegative(now_s, "now_s")
    candidates = sorted((r for r in routes if _valid_route(r)), key=lambda r: r.route_id)
    active_id = rider.active_route_id
    if active_id is None:
        primary = next((r for r in candidates if r.role == "primary"), None)
        active_id = primary.route_id if primary else (candidates[0].route_id if candidates else "")
    if any(h.first_seen_s > now_s or h.last_supported_s > now_s for h in hazards):
        return Decision(
            decision_id=f"dec-{rider.rider_id}-{now_s:g}",
            rider_id=rider.rider_id,
            action="unavailable",
            reason="Route advice unavailable. Check again shortly.",
            assumptions=["Hazard snapshot contains future support."],
        )
    normalized_hazards = []
    for hazard in hazards:
        if hazard.hazard_type not in config.hazard_types:
            raise ValueError("hazard type missing from configuration")
        normalized = to_internal_hazard(
            hazard, config.hazard_types[hazard.hazard_type], now_s, observations
        )
        if (
            hazard.location.bearing_deg is None
            or hazard.location.lat is None
            or hazard.location.lon is None
        ):
            normalized = replace(
                normalized, location=replace(normalized.location, uncertainty_m=None)
            )
        normalized_hazards.append(normalized)
    normalized_routes = []
    arrival_by_route: dict[str, list[float]] = {}
    for route in candidates:
        length = line_length_m(route.geometry.coordinates)
        if route.route_id == active_id:
            progress = rider.progress_m
        elif rider.position is not None:
            join = project(rider.position, route.geometry.coordinates)
            # Never teleport from the current route to a disconnected alternative.
            if join.offset_m > 5:
                continue
            progress = join.along_m
        elif rider.progress_m == 0:
            progress = 0
        else:
            continue
        if not isfinite(progress) or not 0 <= progress <= length:
            continue
        elapsed = route.duration_s * progress / length
        passages = []
        arrivals = []
        for hazard in hazards:
            if hazard.state == "cleared":
                continue
            along = hazard_on_route(hazard, route, config, progress)
            if along is None or along - progress > config.planning_radius_m:
                continue
            arrival = route.duration_s * (along - progress) / length
            arrivals.append(arrival)
            passages.append(
                internal.RoutePassage(
                    directed_road_id=hazard.location.road_segment_id or "",
                    progress_m=along - progress,
                    arrival_s=arrival,
                    bearing_deg=hazard.location.bearing_deg,
                )
            )
        normalized_routes.append(
            internal.Route(
                route_id=route.route_id,
                duration_s=route.duration_s - elapsed,
                distance_m=length - progress,
                passages=tuple(sorted(passages, key=lambda p: (p.progress_m, p.arrival_s))),
                provider=route.provider,
                bicycle_profile=route.profile,
                provenance="recorded_provider"
                if route.provenance == "cached_provider"
                else route.provenance,
                warnings=tuple(route.warnings),
            )
        )
        arrival_by_route[route.route_id] = arrivals
    decision = pure_score_routes(
        tuple(normalized_routes),
        internal.Rider(rider.rider_id, active_id or ""),
        tuple(normalized_hazards),
        internal.DecisionConfig(
            short_radius_m=min(config.share_radius_m, config.planning_radius_m),
            planning_area_m=config.planning_radius_m,
            max_location_uncertainty_m=max(
                (c.match_radius_m for c in config.hazard_types.values()), default=0
            ),
        ),
        now_s,
    )
    assumptions = [
        *decision.assumptions,
        "Road relevance uses geometry, bearing and anchor uncertainty; provider edge IDs "
        "are absent from the bootstrap contract, so parallel roads can remain ambiguous.",
        "Arrival uses uniform speed along the provider geometry; segment durations "
        "are unavailable. Alternatives must join within 5 m of the current position.",
    ]
    if not observations and decision.hazard_ids:
        assumptions.append(
            "Detached hazards contain observation IDs only; evidence IDs unavailable."
        )
    action = decision.action
    reason = decision.reason
    hazard_ids = list(decision.hazard_ids)
    evidence_ids = list(decision.evidence_ids)
    # Preserve context while a rider is already on a supplied alternative.
    current = next((r for r in candidates if r.route_id == active_id), None)
    primary = next((r for r in candidates if r.role == "primary"), None)
    if (
        action == "continue"
        and current is not None
        and current.role != "primary"
        and primary is not None
    ):
        unresolved = [
            h
            for h in hazards
            if h.state != "cleared" and hazard_on_route(h, primary, config) is not None
        ]
        if unresolved:
            action = "heads_up"
            reason = "Stay on this route. A blockage is still reported on the original route."
            assumptions.append("Keeping the alternative; original-route reports remain unresolved.")
            hazard_ids = sorted(h.hazard_id for h in unresolved)
            evidence_ids = sorted(
                {
                    e.evidence_id
                    for h in unresolved
                    for oid in h.observation_ids
                    if oid in observations
                    for e in observations[oid].evidence
                }
            )
    arrivals = arrival_by_route.get(active_id or "", [])
    return Decision(
        decision_id=f"dec-{rider.rider_id}-{now_s:g}",
        rider_id=rider.rider_id,
        hazard_ids=hazard_ids,
        action=action,
        selected_route_id=decision.selected_route_id,
        estimated_delay_s=decision.estimated_delay_s,
        detour_cost_s=decision.detour_cost_s,
        arrival_in_s=min(arrivals) if arrivals else None,
        reason=reason,
        evidence_ids=evidence_ids,
        assumptions=assumptions,
    )
