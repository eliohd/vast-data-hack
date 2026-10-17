"""Explicit adapter for Agent A's frozen bootstrap contract (5b43e3f)."""

from __future__ import annotations

from dataclasses import replace

from app.agent import hazard_types as internal
from app.agent.models import Hazard, HazardTypeConfig, LocationEstimate, Observation


def to_location(location: LocationEstimate) -> internal.Location:
    return internal.Location(
        directed_road_id=location.road_segment_id,
        lat=location.lat,
        lon=location.lon,
        bearing_deg=location.bearing_deg,
        uncertainty_m=location.uncertainty_m,
        method=location.method,
        notes=location.notes,
    )


def to_prior(config: HazardTypeConfig) -> internal.HazardPrior:
    return internal.HazardPrior(
        hazard_type=config.hazard_type,
        version=config.persistence.version,
        stale_after_s=config.persistence.stale_after_s,
        half_life_s=config.persistence.half_life_s,
        obstruction_delay_s=config.expected_delay_s,
        impact="minor" if config.default_impact == "low" else "serious",
        match_radius_m=config.match_radius_m,
        clearance_uncertainty_m=config.match_radius_m,
    )


def to_observation(observation: Observation) -> internal.Observation:
    support = observation.support
    verification = observation.verification
    visible = False
    if verification is not None and verification.evidence_id not in {
        e.evidence_id for e in observation.evidence
    }:
        verification = None
        support = "uncertain"
    if verification is not None:
        if verification.verdict == "contradicted":
            support = "contradicted"
        elif verification.verdict == "unclear":
            support = "uncertain"
        elif (observation.assertion == "present" and verification.obstruction_visible is False) or (
            observation.assertion == "clear" and verification.obstruction_visible is True
        ):
            support = "contradicted"
        visible = (
            verification.verdict == "supported"
            and verification.road_space_visible is True
            and verification.obstruction_visible is False
        )
    synthetic_clear = (
        observation.source == "synthetic_scenario"
        and bool(observation.label)
        and "synthetic" in (observation.label or "").lower()
        and bool(observation.evidence)
        and all(e.provenance == "synthetic" for e in observation.evidence)
    )
    evidence = tuple(
        internal.Evidence(
            evidence_id=e.evidence_id,
            ride_id=e.ride_id,
            segment_id=e.segment_id,
            camera_id=e.camera_id or f"observer:{observation.observer_id}",
            clip_start_s=e.clip_start_s,
            clip_end_s=e.clip_end_s,
            ride_offset_s=e.ride_offset_s,
            available_at_s=observation.session_time_s + e.ride_offset_s - observation.ride_offset_s,
            provenance=e.provenance,
            affected_area_visible=(
                synthetic_clear
                or (
                    visible
                    and verification is not None
                    and verification.evidence_id == e.evidence_id
                )
            ),
            model_version=e.model,
            prompt_version=e.prompt_version,
            recorded_at_s=(
                e.recorded_at.timestamp()
                if e.recorded_at is not None and e.recorded_at.utcoffset() is not None
                else None
            ),
        )
        for e in observation.evidence
    )
    return internal.Observation(
        observation_id=observation.observation_id,
        hazard_type=observation.hazard_type,
        assertion=observation.assertion,
        support=support,
        location=to_location(observation.location),
        observer_id=observation.observer_id,
        source_group_id=observation.source_group_id,
        session_time_s=observation.session_time_s,
        ride_offset_s=observation.ride_offset_s,
        evidence=evidence,
        description=observation.description,
    )


def to_internal_hazard(
    hazard: Hazard,
    config: HazardTypeConfig,
    now_s: float,
    observations: dict[str, Observation],
) -> internal.Hazard:
    evidence = [
        e
        for oid in hazard.observation_ids
        if oid in observations
        for e in observations[oid].evidence
    ]
    strength: internal.Strength = (
        "independent_corroboration"
        if hazard.confirmation_kind == "independent"
        else "continued_observation"
        if hazard.confirmation_kind == "persistence"
        else "single_sighting"
    )
    prior = to_prior(config)
    # Score with the prior version stored in the report, not a different current default.
    prior = replace(
        prior,
        half_life_s=hazard.persistence.half_life_s,
        stale_after_s=hazard.persistence.stale_after_s,
        version=hazard.persistence.version,
    )
    return internal.Hazard(
        hazard_id=hazard.hazard_id,
        hazard_type=hazard.hazard_type,
        location=to_location(hazard.location),
        state=hazard.state,
        observation_ids=tuple(hazard.observation_ids),
        evidence_ids=tuple(e.evidence_id for e in evidence),
        first_seen_s=hazard.first_seen_s,
        last_supported_s=hazard.last_supported_s,
        evidence_strength=strength,
        impact="minor" if hazard.impact == "low" else "serious",
        prior=prior,
        as_of_s=now_s,
        provenance=tuple(sorted({e.provenance for e in evidence})),
        clearance_evidence_id=hazard.clearance_evidence_id,
    )
