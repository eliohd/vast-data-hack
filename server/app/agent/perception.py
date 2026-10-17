"""Archive perception provider. OWNED BY LANE C after bootstrap.

VAST retrieval → Cosmos descriptions / video check + YOLO11 evidence → W&B extraction →
normalised `Observation`s. Implements `PerceptionProvider` (app/agent/interfaces.py); keep the
constructor signature so services.py does not need to change.

Bootstrap version: honest skeleton. It lists nothing and verifies nothing ("unclear"), so the
app runs and shows the archive integration as not yet implemented rather than faking it.
Cache genuine outputs under `cache_dir` (e.g. server/fixtures/rideahead/cache/) with source IDs,
model and prompt versions; replay them as `source="cached_model"`.
"""

from __future__ import annotations

from pathlib import Path

from app.agent.models import Observation, RideManifest, Verification
from app.clients.gpu import CosmosReason, Yolo
from app.clients.llm import LLM
from app.clients.vss import VSSClient


class ArchivePerceptionProvider:
    name = "archive"

    def __init__(
        self, vss: VSSClient, cosmos: CosmosReason, yolo: Yolo, llm: LLM, cache_dir: Path
    ) -> None:
        self.vss = vss
        self.cosmos = cosmos
        self.yolo = yolo
        self.llm = llm
        self.cache_dir = cache_dir

    async def list_rides(self) -> list[RideManifest]:
        return []

    async def inspect_ride(self, ride_id: str) -> list[Observation]:
        return []

    async def verify_evidence(self, evidence_id: str, question: str) -> Verification:
        return Verification(
            evidence_id=evidence_id,
            question=question,
            verdict="unclear",
            rationale="archive verification not implemented yet",
            source="fixture",
        )
