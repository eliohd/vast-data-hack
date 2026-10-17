"""Score supplied bicycle routes. No provider calls, inferred graph or model calls."""

from __future__ import annotations

from dataclasses import dataclass

from app.agent.hazard_engine import bearing_difference, persistence_weight
from app.agent.hazard_types import (
    Decision,
    DecisionConfig,
    Hazard,
    Rider,
    Route,
    RoutePassage,
    RouteScore,
    nonnegative,
)


@dataclass(frozen=True)
class _Relevant:
    hazard: Hazard
    ahead_m: float
    arrival_in_s: float


def _match(
    route: Route,
    rider: Rider,
    hazard: Hazard,
    config: DecisionConfig,
) -> _Relevant | None:
    progress = rider.progress_m if route.route_id == rider.current_route_id else 0
    elapsed = rider.elapsed_route_s if route.route_id == rider.current_route_id else 0
    candidates: list[RoutePassage] = []
    for passage in route.passages:
        if passage.directed_road_id != hazard.location.directed_road_id:
            continue
        if not 0 <= passage.progress_m - progress <= config.planning_area_m:
            continue
        if (
            passage.bearing_deg is not None
            and hazard.location.bearing_deg is not None
            and bearing_difference(passage.bearing_deg, hazard.location.bearing_deg)
            > config.max_bearing_difference_deg
        ):
            continue
        if passage.arrival_s < elapsed:
            continue
        candidates.append(passage)
    if not candidates:
        return None
    passage = min(candidates, key=lambda p: (p.progress_m, p.arrival_s))
    return _Relevant(hazard, passage.progress_m - progress, passage.arrival_s - elapsed)


def score_routes(
    routes: tuple[Route, ...],
    rider: Rider,
    hazards: tuple[Hazard, ...],
    config: DecisionConfig,
    now_s: float,
) -> Decision:
    """Frozen scoring boundary; alternatives must start at the rider's position.

    Current route uses absolute progress and provider duration from its origin;
    alternatives use progress/time zero from the rider's current position. A's
    provider adapter supplies explicit directed-road passages and coverage status.
    A's runtime supplies snapshot(now_s) and owns revision/change detection.
    """
    nonnegative(now_s, "now_s")
    if len({r.route_id for r in routes}) != len(routes):
        raise ValueError("duplicate route IDs")
    if any(h.as_of_s != now_s for h in hazards):
        raise ValueError("hazards must come from snapshot(now_s)")
    assumptions = (
        "Provider bicycle durations approximate arrival; traffic and map restrictions may differ.",
        "Persistence and delay are versioned demonstration assumptions, not probabilities.",
        "Alternatives start at the rider's current position; directed-road coverage is supplied.",
        f"Planning area {config.planning_area_m:g} m; nearby radius {config.short_radius_m:g} m.",
    )
    if len({h.hazard_id for h in hazards}) != len(hazards):
        raise ValueError("duplicate hazard IDs")
    active = tuple(sorted((h for h in hazards if h.state != "cleared"), key=lambda h: h.hazard_id))
    unknown = any(
        not h.location.directed_road_id
        or h.location.uncertainty_m is None
        or h.location.uncertainty_m > config.max_location_uncertainty_m
        for h in active
    )
    valid = tuple(r for r in routes if r.available and r.bicycle_profile.startswith("cycling-"))
    current = next((r for r in valid if r.route_id == rider.current_route_id), None)
    if (
        current is None
        or rider.progress_m > current.distance_m
        or (rider.elapsed_route_s > current.duration_s)
    ):
        return Decision(
            rider.rider_id,
            "unavailable",
            None,
            tuple(h.hazard_id for h in active),
            tuple(sorted({eid for h in active for eid in h.evidence_ids})),
            None,
            None,
            "Current bicycle route or rider progress unavailable; route comparison unavailable.",
            now_s,
            assumptions,
        )
    scores: list[RouteScore] = []
    relevance: dict[str, tuple[_Relevant, ...]] = {}
    for route in sorted(valid, key=lambda r: r.route_id):
        relevant = tuple(
            match
            for hazard in active
            if (match := _match(route, rider, hazard, config)) is not None
        )
        relevance[route.route_id] = relevant
        elapsed = rider.elapsed_route_s if route.route_id == rider.current_route_id else 0
        remaining = route.duration_s - elapsed
        delay = sum(
            match.hazard.prior.obstruction_delay_s
            * persistence_weight(match.hazard, now_s, match.arrival_in_s)
            for match in relevant
        )
        uncertain = (
            unknown
            or not route.coverage_complete
            or any(
                m.hazard.state in ("stale", "disputed")
                or now_s + m.arrival_in_s - m.hazard.last_supported_s
                >= m.hazard.prior.stale_after_s
                for m in relevant
            )
        )
        scores.append(
            RouteScore(
                route.route_id,
                remaining,
                delay,
                remaining + delay,
                tuple(sorted(m.hazard.hazard_id for m in relevant)),
                uncertain,
            )
        )
    current_score = next(s for s in scores if s.route_id == current.route_id)
    selected = current_score
    current_relevance = relevance[current.route_id]
    alternatives = [
        s
        for s in scores
        if s.route_id != current.route_id
        and not s.uncertain
        and set(current_score.hazard_ids) - set(s.hazard_ids)
    ]
    best = min(alternatives, key=lambda s: (s.total_cost_s, s.route_id), default=None)
    detour_cost: float | None = None
    if best is not None and best.total_cost_s < current_score.total_cost_s:
        selected = best
        detour_cost = best.remaining_duration_s - current_score.remaining_duration_s
        action = "reroute"
        reason = (
            "Supplied bicycle alternative avoids relevant reports at lower estimated total cost."
        )
        if current_score.uncertain:
            reason += " Current-route evidence is uncertain by estimated arrival."
    elif current_relevance:
        nearby = [m for m in current_relevance if m.ahead_m <= config.short_radius_m]
        if current_score.uncertain:
            action = "slow" if nearby else "heads_up"
            reason = "Uncertain report ahead by estimated arrival; it is not cleared."
        elif not nearby:
            action = "heads_up"
            reason = "Relevant report is ahead within the planning area, outside the nearby radius."
        elif 0 < current_score.estimated_delay_s <= config.wait_limit_s:
            action = "wait"
            reason = "Brief estimated obstruction delay costs less than the supplied alternatives."
        else:
            action = "slow"
            reason = (
                "Relevant obstruction ahead; no supplied alternative improves estimated total cost."
            )
    elif unknown or not current.coverage_complete:
        action = "heads_up"
        reason = (
            "Report location or route coverage is uncertain; route relevance cannot be established."
        )
    else:
        action = "continue"
        reason = "No active report matches the directed route ahead within the planning area."
    selected_route = next(r for r in valid if r.route_id == selected.route_id)
    labels = (
        f"Route provenance: {selected_route.provenance}; provider: {selected_route.provider}.",
        *(
            f"Route {r.route_id}: {r.provenance}, {r.provider}, {r.bicycle_profile}."
            for r in sorted(valid, key=lambda r: r.route_id)
        ),
        *(warning for r in sorted(valid, key=lambda r: r.route_id) for warning in r.warnings),
        *(
            f"Prior {h.hazard_type}:{h.prior.version}; impact {h.impact}; "
            f"evidence {','.join(h.provenance)}."
            for h in sorted(active, key=lambda h: h.hazard_id)
        ),
    )
    affected = {
        m.hazard.hazard_id: m.hazard for m in (*current_relevance, *relevance[selected.route_id])
    }
    if unknown:
        affected.update(
            {
                h.hazard_id: h
                for h in active
                if not h.location.directed_road_id
                or h.location.uncertainty_m is None
                or h.location.uncertainty_m > config.max_location_uncertainty_m
            }
        )
    return Decision(
        rider.rider_id,
        action,
        selected.route_id,
        tuple(sorted(affected)),
        tuple(sorted({eid for h in affected.values() for eid in h.evidence_ids})),
        selected.estimated_delay_s,
        detour_cost,
        reason,
        now_s,
        (*assumptions, *labels),
        tuple(scores),
    )
