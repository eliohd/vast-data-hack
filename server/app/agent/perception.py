"""Archive perception provider. OWNED BY LANE C.

VAST retrieval → Cosmos descriptions / video check + YOLO11 evidence → W&B extraction →
normalised `Observation`s. Implements `PerceptionProvider` (app/agent/interfaces.py); the
constructor signature is unchanged so services.py does not need to change.

This version replays genuine cached outputs only (`source="cached_model"`); it makes no model
calls, so creating a session is fast and repeatable. The cache is built by
`python -m app.agent.perception_build` (traced in Weave) and reviewed in
docs/rideahead/handoff-C.md.

Cache files in `cache_dir`:
- ride_gx010001_manifest.json   ride, anchors, shortlist, reviewed support per clip
- captions_gx010001_shortlist.json   VSS captions + YOLO11 counts
- model_outputs_v2.json   W&B extraction + Cosmos verification per clip
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from app.agent.models import (
    Evidence,
    IntegrationStatus,
    LocationEstimate,
    Observation,
    RideManifest,
    SegmentRef,
    Verification,
)
from app.clients.gpu import CosmosReason, Yolo
from app.clients.llm import LLM
from app.clients.vss import VSSClient

MANIFEST = "ride_gx010001_manifest.json"
CAPTIONS = "captions_gx010001_shortlist.json"
MODEL_OUTPUTS = "model_outputs_v2.json"
SEGMENT_PREFIX = "s3://team-46-vss-chunks-segments/segments/"

Support = Literal["supported", "uncertain", "contradicted"]
Assertion = Literal["present", "clear", "unclear"]


def media_ref(segment_file: str) -> str:
    """App-controlled media path (server proxies VSS; the browser never sees a JWT URL)."""
    return f"/api/archive/media?source={quote(SEGMENT_PREFIX + segment_file, safe='')}"


def interpolate(anchors: list[dict[str, Any]], offset_s: float) -> tuple[float, float, float, str]:
    """(lat, lon, uncertainty_m, method) at a ride offset, linear between neighbouring anchors.

    Outside the anchored span the nearest anchor is used with its uncertainty doubled.
    """
    pts = sorted(anchors, key=lambda a: a["ride_offset_s"])
    for a in pts:
        if abs(a["ride_offset_s"] - offset_s) <= 2.5:
            return a["lat"], a["lon"], a["uncertainty_m"], "manual_anchor"
    for a, b in itertools.pairwise(pts):
        if a["ride_offset_s"] <= offset_s <= b["ride_offset_s"]:
            t = (offset_s - a["ride_offset_s"]) / (b["ride_offset_s"] - a["ride_offset_s"])
            lat = a["lat"] + t * (b["lat"] - a["lat"])
            lon = a["lon"] + t * (b["lon"] - a["lon"])
            return lat, lon, max(a["uncertainty_m"], b["uncertainty_m"]), "interpolated"
    near = min(pts, key=lambda a: abs(a["ride_offset_s"] - offset_s))
    return near["lat"], near["lon"], near["uncertainty_m"] * 2, "interpolated"


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
        self.manifest: dict[str, Any] = self._load(MANIFEST) or {}
        captions = self._load(CAPTIONS) or {}
        self.captions = {c["id"]: c for c in captions.get("segments", [])}
        outputs = self._load(MODEL_OUTPUTS) or {}
        self.weave_traced: bool = bool(outputs.get("weave_traced"))
        # first entry wins if a segment was run twice
        self.outputs: dict[str, dict[str, Any]] = {}
        for r in outputs.get("results", []):
            self.outputs.setdefault(r["segment_id"], r)
        self.verifications: dict[str, Verification] = {}

    def _load(self, name: str) -> dict[str, Any] | None:
        path = self.cache_dir / name
        return json.loads(path.read_text()) if path.is_file() else None

    # -- rides -----------------------------------------------------------------------------

    @property
    def ride_id(self) -> str:
        return self.manifest.get("ride_id", "")

    def _ride_offset(self, entry: dict[str, Any]) -> float:
        return float(entry["ride_offset_s"])

    async def list_rides(self) -> list[RideManifest]:
        if not self.manifest:
            return []
        section = self.manifest["demo_section"]
        segments = []
        for entry in self.manifest["shortlist"]:
            cap = self.captions.get(entry["id"]) or self.outputs.get(entry["id"]) or {}
            file = cap.get("segment_file")
            segments.append(
                SegmentRef(
                    segment_id=SEGMENT_PREFIX + file if file else entry["id"],
                    ride_offset_s=self._ride_offset(entry),
                    duration_s=float(self.manifest.get("segment_duration_s", 5)),
                    media_ref=media_ref(file) if file else None,
                    caption=cap.get("caption"),
                )
            )
        return [
            RideManifest(
                ride_id=self.ride_id,
                title=f"{self.manifest['recording_id']}: {section['name']}",
                camera_id=self.manifest.get("camera_id"),
                duration_s=float(self.manifest["chunk_count"] * self.manifest["chunk_duration_s"]),
                segments=segments,
                has_gps=False,
                location_label=f"manually reconstructed route, {section['name']} (New York City)",
                provenance="cached_recorded",
            )
        ]

    # -- observations ----------------------------------------------------------------------

    def _verification(self, evidence_id: str, out: dict[str, Any]) -> Verification | None:
        v = out.get("verification")
        if not v:
            return None
        parsed = v.get("parsed") or {}
        return Verification(
            evidence_id=evidence_id,
            question=v.get("question", ""),
            verdict=v.get("verdict", "unclear"),
            obstruction_visible=parsed.get("obstruction_visible"),
            road_space_visible=parsed.get("road_space_visible", parsed.get("bike_lane_visible")),
            rationale=parsed.get("rationale") or "",
            model=v.get("model"),
            prompt_version=v.get("prompt_version"),
            source="cached_model",
            latency_ms=v.get("latency_ms"),
        )

    def _observation(self, entry: dict[str, Any]) -> Observation | None:
        seg_id = entry["id"]
        out = self.outputs.get(seg_id)
        support: Support | None = entry.get("review_support")
        if out is None or support is None:
            return None  # only reviewed claims become observations
        extraction = (out.get("extraction") or {}).get("parsed") or {}
        assertion: Assertion = "present" if extraction.get("assertion") == "present" else "unclear"
        section = self.manifest["demo_section"]
        offset = self._ride_offset(entry)
        lat, lon, unc, method = interpolate(section["anchors"], offset)
        chunk = seg_id.split("-c")[1][:2]
        evidence_id = f"ev-{seg_id}"
        evidence = Evidence(
            evidence_id=evidence_id,
            ride_id=self.ride_id,
            segment_id=SEGMENT_PREFIX + out["segment_file"],
            camera_id=self.manifest.get("camera_id"),
            clip_start_s=0.0,
            clip_end_s=float(self.manifest.get("segment_duration_s", 5)),
            ride_offset_s=offset,
            media_ref=media_ref(out["segment_file"]),
            provenance="cached_recorded",
            caption=out.get("caption"),
            object_counts=out.get("object_counts") or {},
            model=(out.get("extraction") or {}).get("model"),
            prompt_version=(out.get("extraction") or {}).get("prompt_version"),
        )
        verification = self._verification(evidence_id, out)
        if verification:
            self.verifications[evidence_id] = verification
        description = extraction.get("description") or entry.get("role", "")
        if support != "supported":
            description = f"{description} (review: {support}; {entry.get('review_note', '')})"
        confidence = extraction.get("confidence")
        return Observation(
            observation_id=f"obs-{seg_id}",
            hazard_type="lane_blocked",
            assertion=assertion,
            evidence=[evidence],
            location=LocationEstimate(
                lat=lat,
                lon=lon,
                road_segment_id=section.get("road_segment_id"),
                bearing_deg=float(section["travel_bearing_deg"]),
                method=method,  # type: ignore[arg-type]
                uncertainty_m=unc,
                notes="manually reconstructed route from street signs in captions/frames",
            ),
            observer_id="bike_a",
            source_group_id=f"{self.manifest.get('recording_id', 'ride').lower()}-c{chunk}",
            description=description[:400],
            support=support,
            verification=verification,
            model_confidence=confidence if isinstance(confidence, int | float) else None,
            ride_offset_s=offset,
            session_time_s=max(0.0, offset - float(section.get("section_start_offset_s", 0))),
            source="cached_model",
            label="Cached model output (recorded footage, reviewed)",
        )

    async def inspect_ride(self, ride_id: str) -> list[Observation]:
        if ride_id != self.ride_id:
            return []
        observations = [self._observation(e) for e in self.manifest.get("shortlist", [])]
        return sorted((o for o in observations if o is not None), key=lambda o: o.session_time_s)

    async def verify_evidence(self, evidence_id: str, question: str) -> Verification:
        if not self.verifications:
            await self.inspect_ride(self.ride_id)
        found = self.verifications.get(evidence_id)
        if found:
            return found.model_copy(update={"question": question or found.question})
        return Verification(
            evidence_id=evidence_id,
            question=question,
            verdict="unclear",
            rationale="no cached verification for this clip (live re-check not enabled)",
            source="cached_model",
        )

    # -- status ----------------------------------------------------------------------------

    def statuses(self) -> list[IntegrationStatus]:
        n = len(self.outputs)
        tr = "traced in Weave when built" if self.weave_traced else "not traced"
        return [
            IntegrationStatus(
                name="vast",
                state="cached",
                detail="captions, YOLO counts and segments retrieved from VSS (VastDB archive); "
                "media streamed via /api/archive/media",
            ),
            IntegrationStatus(
                name="cosmos",
                state="cached",
                detail=f"Cosmos Reason clip verification, {n} cached outputs ({tr})",
            ),
            IntegrationStatus(
                name="yolo",
                state="cached",
                detail="YOLO11 detections stored at VSS ingest; endpoint not called by the app",
            ),
            IntegrationStatus(
                name="wandb_inference",
                state="cached",
                detail=f"W&B Inference observation extraction, {n} cached outputs ({tr})",
            ),
        ]
