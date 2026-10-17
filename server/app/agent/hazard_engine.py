"""Deterministic, replayable hazard lifecycle. No I/O or wall-clock access."""

from __future__ import annotations

from dataclasses import replace
from hashlib import sha256
from math import asin, cos, radians, sin, sqrt

from app.agent.hazard_types import Evidence, Hazard, HazardPrior, Location, Observation, nonnegative


def bearing_difference(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def distance_m(a: Location, b: Location) -> float | None:
    if a.lat is None or a.lon is None or b.lat is None or b.lon is None:
        return None
    dlat, dlon = radians(b.lat - a.lat), radians(b.lon - a.lon)
    value = sin(dlat / 2) ** 2 + cos(radians(a.lat)) * cos(radians(b.lat)) * sin(dlon / 2) ** 2
    return 6371000 * 2 * asin(min(1, sqrt(value)))


def locations_match(a: Location, b: Location, radius_m: float = 50) -> bool:
    """A directed segment is mandatory. Geography never bridges parallel roads.

    Unknown direction/location stays unmerged. When coordinates are supplied,
    reject distant reports even on a long segment. Uncertainty cannot enlarge
    the match radius and turn a vague report into precise clearance evidence.
    """
    if not a.directed_road_id or a.directed_road_id != b.directed_road_id:
        return False
    if (
        a.bearing_deg is not None
        and b.bearing_deg is not None
        and bearing_difference(a.bearing_deg, b.bearing_deg) > 60
    ):
        return False
    separation = distance_m(a, b)
    return (
        separation is None
        or separation + max(a.uncertainty_m or 0, b.uncertainty_m or 0) <= radius_m
    )


def same_source(a: Evidence, b: Evidence) -> bool:
    """Source IDs and overlapping ride-time intervals defeat renamed cache rows."""
    if a.evidence_id == b.evidence_id or a.source_key == b.source_key:
        return True
    if a.ride_id != b.ride_id or a.camera_id != b.camera_id:
        return False
    a_end = a.ride_offset_s + a.clip_end_s - a.clip_start_s
    b_end = b.ride_offset_s + b.clip_end_s - b.clip_start_s
    return max(a.ride_offset_s, b.ride_offset_s) < min(a_end, b_end)


def overlaps(a: Observation, b: Observation) -> bool:
    return any(same_source(x, y) for x in a.evidence for y in b.evidence)


def evidence_later(new: Evidence, old: Evidence) -> bool:
    if new.available_at_s <= old.available_at_s:
        return False
    if (
        new.recorded_at_s is not None
        and old.recorded_at_s is not None
        and new.recorded_at_s <= old.recorded_at_s
    ):
        return False
    return (
        new.ride_id != old.ride_id
        or new.ride_offset_s >= old.ride_offset_s + old.clip_end_s - old.clip_start_s
    )


class HazardEngine:
    """Frozen entry points: ingest(observation), snapshot(as_of_s), reset().

    Ingest stores immutable events. Snapshot rebuilds only the visible prefix,
    so seeking backwards and repeated reads cannot leak future observations or
    mutate freshness. The runtime remains the owner of the replay clock.
    """

    def __init__(self, priors: tuple[HazardPrior, ...] = (HazardPrior(),)) -> None:
        self._priors = {prior.hazard_type: prior for prior in priors}
        if len(self._priors) != len(priors):
            raise ValueError("duplicate hazard-type prior")
        self._events: dict[str, Observation] = {}

    def ingest(self, observation: Observation) -> None:
        if observation.hazard_type not in self._priors:
            raise ValueError(f"unconfigured hazard type: {observation.hazard_type}")
        previous = self._events.get(observation.observation_id)
        if previous is not None and previous != observation:
            raise ValueError("observation ID reused with different contents")
        self._events[observation.observation_id] = observation

    def reset(self) -> None:
        self._events.clear()

    def snapshot(self, as_of_s: float) -> tuple[Hazard, ...]:
        nonnegative(as_of_s, "as_of_s")
        events = sorted(
            (event for event in self._events.values() if event.session_time_s <= as_of_s),
            key=lambda event: (
                event.session_time_s,
                event.assertion != "present",
                event.observation_id,
            ),
        )
        hazards: list[Hazard] = []
        latest_clearance: dict[str, Evidence] = {}
        accepted: list[Observation] = []
        for event in events:
            # A repeated model call cannot refresh a clock, even under a new ID.
            if any(
                event.hazard_type == old.hazard_type
                and event.assertion == old.assertion
                and event.support == old.support
                and overlaps(event, old)
                for old in accepted
            ):
                continue
            accepted.append(event)
            matches = [
                i
                for i, h in enumerate(hazards)
                if h.hazard_type == event.hazard_type
                and locations_match(h.location, event.location, h.prior.match_radius_m)
            ]
            if len(matches) > 1:
                # Ambiguous evidence must never clear/merge multiple obstacles.
                continue
            index = matches[0] if matches else None
            supported = event.support == "supported" and bool(event.evidence)
            source_time_s = max((e.available_at_s for e in event.evidence), default=0)
            if index is None:
                if event.assertion != "present" or not supported:
                    continue
                prior = self._priors[event.hazard_type]
                identity = sha256(event.observation_id.encode()).hexdigest()[:16]
                hazards.append(
                    Hazard(
                        hazard_id=f"hazard-{identity}",
                        hazard_type=event.hazard_type,
                        location=event.location,
                        state="observed",
                        observation_ids=(event.observation_id,),
                        evidence_ids=tuple(e.evidence_id for e in event.evidence),
                        first_seen_s=source_time_s,
                        last_supported_s=source_time_s,
                        evidence_strength="single_sighting",
                        impact=prior.impact,
                        prior=prior,
                        as_of_s=as_of_s,
                        provenance=tuple(sorted({e.provenance for e in event.evidence})),
                    )
                )
                continue
            hazard = hazards[index]
            members = [self._events[oid] for oid in hazard.observation_ids]
            shared = dict(
                observation_ids=(*hazard.observation_ids, event.observation_id),
                evidence_ids=tuple(
                    sorted(set(hazard.evidence_ids) | {e.evidence_id for e in event.evidence})
                ),
                provenance=tuple(
                    sorted(set(hazard.provenance) | {e.provenance for e in event.evidence})
                ),
            )
            if event.assertion == "present" and supported:
                last_clearance = latest_clearance.get(hazard.hazard_id)
                if last_clearance is not None and not any(
                    evidence_later(e, last_clearance) for e in event.evidence
                ):
                    # Retrieving older footage later cannot resurrect a cleared report.
                    continue
                last_clear_s = last_clearance.available_at_s if last_clearance is not None else -1
                sightings = [
                    m
                    for m in members
                    if m.assertion == "present"
                    and m.support == "supported"
                    and any(e.available_at_s > last_clear_s for e in m.evidence)
                ]
                same_sighting = (
                    any(
                        m.observer_id == event.observer_id
                        and m.source_group_id == event.source_group_id
                        for m in sightings
                    )
                    and source_time_s - hazard.last_supported_s < hazard.prior.continuation_gap_s
                )
                # Independent requires both a new observer and a new source group.
                # A renamed group from the same rider is continued observation.
                independent = any(
                    m.observer_id != event.observer_id
                    and m.source_group_id != event.source_group_id
                    and not overlaps(event, m)
                    for m in sightings
                )
                continued = any(
                    event.session_time_s - m.session_time_s >= hazard.prior.continuation_gap_s
                    and event.ride_offset_s - m.ride_offset_s >= hazard.prior.continuation_gap_s
                    and not overlaps(event, m)
                    for m in sightings
                )
                strength = hazard.evidence_strength if sightings else "single_sighting"
                if independent:
                    strength = "independent_corroboration"
                elif continued and strength != "independent_corroboration":
                    strength = "continued_observation"
                state = "confirmed" if strength != "single_sighting" else "observed"
                # A simultaneous contradictory claim is disputed regardless of ID order.
                conflict = any(
                    m.session_time_s == event.session_time_s
                    and m.assertion == "clear"
                    and m.support == "supported"
                    for m in members
                )
                hazards[index] = replace(
                    hazard,
                    **shared,
                    state="disputed" if conflict else state,
                    evidence_strength=strength,
                    last_supported_s=(
                        hazard.last_supported_s
                        if same_sighting
                        else max(hazard.last_supported_s, source_time_s)
                    ),
                    clearance_evidence_id=None,
                )
            elif event.assertion == "clear" and supported:
                clearance = next((e for e in event.evidence if e.affected_area_visible), None)
                prior_evidence = [e for m in members for e in m.evidence]
                is_new = clearance is not None and all(
                    not same_source(clearance, old) for old in prior_evidence
                )
                # Broad/unknown location estimates cannot assert precise clearance.
                located = (
                    event.location.uncertainty_m is not None
                    and (event.location.uncertainty_m <= hazard.prior.clearance_uncertainty_m)
                    and hazard.location.uncertainty_m is not None
                    and (hazard.location.uncertainty_m <= hazard.prior.clearance_uncertainty_m)
                )
                later_source = clearance is not None and all(
                    evidence_later(clearance, old)
                    for m in members
                    if m.assertion == "present" and m.support == "supported"
                    for old in m.evidence
                )
                if (
                    is_new
                    and located
                    and later_source
                    and event.session_time_s > hazard.last_supported_s
                    and clearance is not None
                ):
                    hazards[index] = replace(
                        hazard,
                        **shared,
                        state="cleared",
                        clearance_evidence_id=clearance.evidence_id,
                    )
                    latest_clearance[hazard.hazard_id] = clearance
                else:
                    hazards[index] = replace(hazard, **shared, state="disputed")
            elif event.support == "contradicted" and event.evidence:
                hazards[index] = replace(hazard, **shared, state="disputed")
            else:
                # Unknown/failed/occluded evidence is retained without clearing or refreshing.
                hazards[index] = replace(hazard, **shared)

        return tuple(
            replace(h, state="stale")
            if h.state in ("observed", "confirmed")
            and as_of_s - h.last_supported_s >= h.prior.stale_after_s
            else h
            for h in sorted(hazards, key=lambda item: item.hazard_id)
        )


def persistence_weight(hazard: Hazard, now_s: float, arrival_in_s: float = 0) -> float:
    """Demo heuristic weight; never a measured probability or clearance signal."""
    nonnegative(now_s, "now_s")
    nonnegative(arrival_in_s, "arrival_in_s")
    if now_s < hazard.last_supported_s:
        raise ValueError("cannot score future hazard support")
    age_s = now_s - hazard.last_supported_s
    return 2 ** (-(age_s + arrival_in_s) / hazard.prior.half_life_s)
