"""Hazard lifecycle engine. OWNED BY LANE D after bootstrap.

Bootstrap version: a minimal, deterministic rule engine so the runtime runs end to end.
Lane D replaces the internals; keep the `HazardEngine` protocol (app/agent/interfaces.py) and
`build_engine(config)` entry point unchanged.
"""

from __future__ import annotations

from app.agent import scoring
from app.agent.geo import haversine_m
from app.agent.models import (
    Decision,
    Hazard,
    LatLon,
    Observation,
    Rider,
    RouteCandidate,
    SessionConfig,
)


class RuleHazardEngine:
    name = "rule-engine-bootstrap"

    def __init__(self, config: SessionConfig) -> None:
        self.config = config
        self._hazards: dict[str, Hazard] = {}
        self._seen: dict[str, str | None] = {}  # observation_id -> hazard_id
        self._groups: dict[str, set[str]] = {}  # hazard_id -> source groups seen

    def reset(self) -> None:
        self._hazards.clear()
        self._seen.clear()
        self._groups.clear()

    def _match(self, obs: Observation) -> Hazard | None:
        cfg = self.config.hazard_types[obs.hazard_type]
        for hz in self._hazards.values():
            if hz.hazard_type != obs.hazard_type or hz.state == "cleared":
                continue
            a, b = hz.location, obs.location
            if a.road_segment_id and b.road_segment_id:
                if a.road_segment_id == b.road_segment_id:
                    return hz
                continue
            if None not in (a.lat, a.lon, b.lat, b.lon):
                d = haversine_m(LatLon(lat=a.lat, lon=a.lon), LatLon(lat=b.lat, lon=b.lon))  # type: ignore[arg-type]
                if d <= cfg.match_radius_m:
                    return hz
        return None

    def ingest(self, observation: Observation) -> Hazard | None:
        if observation.observation_id in self._seen:
            hid = self._seen[observation.observation_id]
            return self._hazards.get(hid) if hid else None
        obs = observation
        hz = self._match(obs)
        result: Hazard | None = None
        if obs.assertion == "present" and obs.support == "supported":
            if hz is None:
                cfg = self.config.hazard_types[obs.hazard_type]
                hz = Hazard(
                    hazard_id=f"hz-{obs.hazard_type}-{obs.observation_id}",
                    hazard_type=obs.hazard_type,
                    location=obs.location,
                    state="observed",
                    observation_ids=[obs.observation_id],
                    first_seen_s=obs.session_time_s,
                    last_supported_s=obs.session_time_s,
                    persistence=cfg.persistence,
                    evidence_strength="moderate" if obs.verification else "weak",
                    impact=cfg.default_impact,
                    summary=obs.description,
                )
                self._hazards[hz.hazard_id] = hz
                self._groups[hz.hazard_id] = {obs.source_group_id}
            else:
                hz.observation_ids.append(obs.observation_id)
                groups = self._groups[hz.hazard_id]
                if obs.source_group_id not in groups:  # a new sighting, not an adjacent chunk
                    groups.add(obs.source_group_id)
                    hz.last_supported_s = max(hz.last_supported_s, obs.session_time_s)
                    hz.state = "confirmed"
                    hz.confirmation_kind = "persistence"
            result = hz
        elif obs.assertion == "clear" and obs.support == "supported" and hz is not None:
            hz.observation_ids.append(obs.observation_id)
            hz.state = "cleared"
            hz.clearance_observation_id = obs.observation_id
            hz.clearance_evidence_id = obs.evidence[0].evidence_id if obs.evidence else None
            result = hz
        elif obs.support == "contradicted" and hz is not None:
            hz.observation_ids.append(obs.observation_id)
            hz.state = "disputed"
            result = hz
        self._seen[obs.observation_id] = result.hazard_id if result else None
        return result

    def snapshot(self, as_of_s: float) -> list[Hazard]:
        out: list[Hazard] = []
        for hz in self._hazards.values():
            if hz.first_seen_s > as_of_s:
                continue
            view = hz.model_copy(deep=True)
            age = max(0.0, as_of_s - hz.last_supported_s)
            view.persistence_weight = round(2 ** (-age / hz.persistence.half_life_s), 4)
            if view.state in ("observed", "confirmed") and age > hz.persistence.stale_after_s:
                view.state = "stale"
            out.append(view)
        return sorted(out, key=lambda h: (h.first_seen_s, h.hazard_id))

    def score_routes(
        self,
        routes: list[RouteCandidate],
        rider: Rider,
        hazards: list[Hazard],
        config: SessionConfig,
        now_s: float,
    ) -> Decision:
        return scoring.score_routes(routes, rider, hazards, config, now_s)


def build_engine(config: SessionConfig) -> RuleHazardEngine:
    return RuleHazardEngine(config)
