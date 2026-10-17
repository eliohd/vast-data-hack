"""Fixture perception provider (lane A). Reads a labelled JSON file; makes no model calls.

Everything it returns carries `source="fixture"` / `provenance="synthetic"` unless the file says
otherwise (e.g. a cache of genuine model outputs saved by lane C, marked `cached_model`).
"""

from __future__ import annotations

import json
from pathlib import Path

from app.agent.models import Observation, RideManifest, Verification


class FixturePerceptionProvider:
    def __init__(self, path: Path, name: str = "fixture") -> None:
        self.name = name
        data = json.loads(path.read_text())
        self.rides = [RideManifest.model_validate(r) for r in data.get("rides", [])]
        self.observations = [Observation.model_validate(o) for o in data.get("observations", [])]
        self.verifications = {
            v["evidence_id"]: Verification.model_validate(v) for v in data.get("verifications", [])
        }

    async def list_rides(self) -> list[RideManifest]:
        return [r.model_copy(deep=True) for r in self.rides]

    async def inspect_ride(self, ride_id: str) -> list[Observation]:
        return [
            o.model_copy(deep=True)
            for o in self.observations
            if any(e.ride_id == ride_id for e in o.evidence)
        ]

    async def verify_evidence(self, evidence_id: str, question: str) -> Verification:
        found = self.verifications.get(evidence_id)
        if found:
            return found.model_copy(update={"question": question})
        return Verification(
            evidence_id=evidence_id,
            question=question,
            verdict="unclear",
            rationale="no verification available in fixture",
            source="fixture",
        )
