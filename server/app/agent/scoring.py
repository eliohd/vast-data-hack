"""Route relevance + deterministic action selection. OWNED BY LANE D after bootstrap.

Bootstrap version: simple, deterministic rules so the runtime has a real decision to show.
Keep the `score_routes(routes, rider, hazards, config, now_s) -> Decision` signature.
"""

from __future__ import annotations

from app.agent.geo import angle_diff_deg, line_length_m, project
from app.agent.models import (
    Decision,
    Hazard,
    LatLon,
    Rider,
    RouteCandidate,
    SessionConfig,
)

ACTIVE_STATES = ("observed", "confirmed", "stale", "disputed")


def _hazard_point(h: Hazard) -> LatLon | None:
    if h.location.lat is None or h.location.lon is None:
        return None
    return LatLon(lat=h.location.lat, lon=h.location.lon)


def hazard_on_route(
    h: Hazard, route: RouteCandidate, config: SessionConfig, from_m: float = 0.0
) -> float | None:
    """Distance along `route` to `h` if it lies on the route, ahead of `from_m`, in the same
    travel direction. None otherwise (unlocated hazards are never matched to a route)."""
    p = _hazard_point(h)
    if p is None:
        return None
    proj = project(p, route.geometry.coordinates)
    radius = config.hazard_types[h.hazard_type].match_radius_m
    if proj.offset_m > radius or proj.along_m < from_m:
        return None
    if (
        h.location.bearing_deg is not None
        and angle_diff_deg(h.location.bearing_deg, proj.bearing_deg) > 60
    ):
        return None  # opposite direction
    return proj.along_m


def score_routes(
    routes: list[RouteCandidate],
    rider: Rider,
    hazards: list[Hazard],
    config: SessionConfig,
    now_s: float,
) -> Decision:
    base = Decision(
        decision_id=f"dec-{rider.rider_id}-{now_s:.0f}",
        rider_id=rider.rider_id,
        action="continue",
        reason="",
        session_time_s=now_s,
        assumptions=[
            f"rider speed {rider.speed_mps:.1f} m/s (simulated)",
            "provider duration estimates used for arrival",
        ],
    )
    if not routes:
        base.action = "unavailable"
        base.reason = "No cycling route available from the routing provider."
        return base

    by_id = {r.route_id: r for r in routes}
    current = by_id.get(rider.active_route_id or "") or routes[0]
    progress = rider.progress_m if current.route_id == rider.active_route_id else 0.0
    ahead: list[tuple[float, Hazard]] = []
    for h in hazards:
        if h.state not in ACTIVE_STATES:
            continue
        along = hazard_on_route(h, current, config, progress)
        if along is not None and along - progress <= config.planning_radius_m:
            ahead.append((along, h))
    if not ahead:
        base.selected_route_id = current.route_id
        base.reason = "No active hazard reported ahead on your route."
        primary = next((r for r in routes if r.role == "primary"), routes[0])
        if current.route_id != primary.route_id:
            # already on an alternative: say why we keep it while the report is live
            on_primary = [
                h
                for h in hazards
                if h.state in ACTIVE_STATES and hazard_on_route(h, primary, config) is not None
            ]
            if on_primary:
                h = on_primary[0]
                name = config.hazard_types[h.hazard_type].display_name
                base.hazard_ids = [h.hazard_id]
                base.evidence_ids = list(h.observation_ids)
                if h.state in ("observed", "confirmed"):
                    base.action = "reroute"
                    base.reason = (
                        f"Keeping the alternative: {name.lower()} still reported on the main route."
                    )
                else:
                    base.action = "heads_up"
                    base.reason = (
                        f"Report on the main route is {h.state} (not confirmed clear); "
                        "staying on the alternative."
                    )
        return base

    along, h = min(ahead, key=lambda x: x[0])
    speed = max(0.5, current.distance_m / max(1.0, current.duration_s))
    base.hazard_ids = [h.hazard_id]
    base.evidence_ids = list(h.observation_ids)
    base.arrival_in_s = round((along - progress) / speed, 1)
    tcfg = config.hazard_types[h.hazard_type]
    base.estimated_delay_s = tcfg.expected_delay_s
    base.assumptions.append(f"expected delay if met: {tcfg.expected_delay_s:.0f}s (assumption)")

    if h.state in ("stale", "disputed"):
        base.action = "heads_up"
        base.selected_route_id = current.route_id
        base.reason = (
            f"{tcfg.display_name} reported ahead but the report is {h.state}; "
            "it may or may not still be there."
        )
        return base

    remaining_current = current.duration_s * (
        1 - progress / max(1.0, line_length_m(current.geometry.coordinates))
    )
    alternatives = [
        r
        for r in routes
        if r.route_id != current.route_id and hazard_on_route(h, r, config) is None
    ]
    if alternatives:
        alt = min(alternatives, key=lambda r: r.duration_s)
        base.detour_cost_s = round(alt.duration_s - remaining_current, 1)
        base.action = "reroute"
        base.selected_route_id = alt.route_id
        base.reason = (
            f"{tcfg.display_name} reported {along - progress:.0f} m ahead; "
            f"alternative adds about {max(0.0, base.detour_cost_s):.0f}s."
        )
        return base
    base.action = "slow" if (base.arrival_in_s or 0) < 60 else "heads_up"
    base.selected_route_id = current.route_id
    base.reason = (
        f"{tcfg.display_name} reported {along - progress:.0f} m ahead; no alternative found."
    )
    return base
