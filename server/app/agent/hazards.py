"""Lane D lifecycle engine at Agent A's frozen canonical boundary."""

from __future__ import annotations

from app.agent import scoring
from app.agent.hazard_adapter import to_observation, to_prior
from app.agent.hazard_engine import HazardEngine as PureEngine
from app.agent.hazard_engine import persistence_weight
from app.agent.models import (
    Decision,
    Hazard,
    Observation,
    Rider,
    RouteCandidate,
    SessionConfig,
)


class RuleHazardEngine:
    name = "deterministic-hazard-engine-v1"

    def __init__(self, config: SessionConfig) -> None:
        self.config = config.model_copy(deep=True)
        self._engine = PureEngine(tuple(to_prior(cfg) for cfg in self.config.hazard_types.values()))
        self._observations: dict[str, Observation] = {}

    def reset(self) -> None:
        self._engine.reset()
        self._observations.clear()

    def ingest(self, observation: Observation) -> Hazard | None:
        # Freeze canonical Pydantic inputs so callers cannot mutate stored history.
        normalized = to_observation(observation)
        previous = self._observations.get(observation.observation_id)
        if previous is not None and previous != observation:
            raise ValueError("observation ID reused with different contents")
        self._engine.ingest(normalized)
        self._observations[observation.observation_id] = observation.model_copy(deep=True)
        return next(
            (
                h
                for h in self.snapshot(observation.session_time_s)
                if observation.observation_id in h.observation_ids
            ),
            None,
        )

    def snapshot(self, as_of_s: float) -> list[Hazard]:
        result = []
        for hazard in self._engine.snapshot(as_of_s):
            first = self._observations[hazard.observation_ids[0]]
            cfg = self.config.hazard_types[hazard.hazard_type]
            confirmation = (
                "independent"
                if hazard.evidence_strength == "independent_corroboration"
                else "persistence"
                if hazard.evidence_strength == "continued_observation"
                else None
            )
            evidence_strength = (
                "strong"
                if confirmation == "independent"
                else ("moderate" if confirmation or first.verification is not None else "weak")
            )
            clearance = next(
                (
                    oid
                    for oid in hazard.observation_ids
                    if any(
                        e.evidence_id == hazard.clearance_evidence_id
                        for e in self._observations[oid].evidence
                    )
                ),
                None,
            )
            result.append(
                Hazard(
                    hazard_id=hazard.hazard_id,
                    hazard_type=first.hazard_type,
                    location=first.location.model_copy(deep=True),
                    state=hazard.state,
                    confirmation_kind=confirmation,
                    observation_ids=list(hazard.observation_ids),
                    first_seen_s=hazard.first_seen_s,
                    last_supported_s=hazard.last_supported_s,
                    persistence=cfg.persistence.model_copy(deep=True),
                    persistence_weight=persistence_weight(hazard, as_of_s),
                    evidence_strength=evidence_strength,
                    impact=cfg.default_impact,
                    clearance_observation_id=clearance,
                    clearance_evidence_id=hazard.clearance_evidence_id,
                    summary=first.description,
                )
            )
        return sorted(result, key=lambda h: (h.first_seen_s, h.hazard_id))

    def score_routes(
        self,
        routes: list[RouteCandidate],
        rider: Rider,
        hazards: list[Hazard],
        config: SessionConfig,
        now_s: float,
    ) -> Decision:
        return scoring.score_with_evidence(
            routes, rider, hazards, config, now_s, self._observations
        )


def build_engine(config: SessionConfig) -> RuleHazardEngine:
    return RuleHazardEngine(config)
