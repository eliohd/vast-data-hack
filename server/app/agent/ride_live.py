"""Single-rider live mode (lane A): one handlebar-camera frame → a hazard warning for Clover.

No archive, no session runtime: each frame stands alone, the phone does the debouncing and
speaks the warning. `normalise_ride_warning` is pure and tested; the analyser just calls Cosmos.
"""

from __future__ import annotations

from typing import Any

import weave

from app.agent.analyser import Analysis, boxes_from_model
from app.agent.prompts import RIDE_HAZARD_PROMPT, RIDE_HAZARD_PROMPT_VERSION
from app.clients.gpu import CosmosReason
from app.core.parsing import clamp01, extract_json
from app.core.protocol import ClientFrame

RIDE_HAZARDS = frozenset(
    {"none", "lane_blocked", "work_zone", "door_risk", "pedestrian", "vehicle_close", "surface"}
)
RIDE_ADVICE = ("continue", "heads_up", "slow", "reroute")
# Below this the model is guessing; tell the rider nothing rather than something wrong.
MIN_WARNING_CONFIDENCE = 0.4


def normalise_ride_warning(parsed: Any) -> dict[str, Any]:
    """Coerces model JSON into {hazard, advice, message, confidence}; unsure means continue."""
    if not isinstance(parsed, dict):
        parsed = {}
    hazard = str(parsed.get("hazard") or "none").strip().lower()
    if hazard not in RIDE_HAZARDS:
        hazard = "none"
    advice = str(parsed.get("advice") or "continue").strip().lower()
    if advice not in RIDE_ADVICE:
        advice = "heads_up" if hazard != "none" else "continue"
    confidence = clamp01(parsed.get("confidence", 0.5), 0.5)
    if hazard == "none" or confidence < MIN_WARNING_CONFIDENCE:
        hazard, advice = "none", "continue"
    message = str(parsed.get("message") or "").strip()
    if advice == "continue":
        message = message if hazard == "none" and message else "All clear"
    return {
        "hazard": hazard,
        "advice": advice,
        "message": message or hazard.replace("_", " ").capitalize(),
        "confidence": confidence,
        "prompt_version": RIDE_HAZARD_PROMPT_VERSION,
    }


class RideHazardAnalyser:
    name = "cosmos-ride"

    def __init__(self, cosmos: CosmosReason) -> None:
        self.cosmos = cosmos

    @weave.op
    async def analyse(self, frame: ClientFrame) -> Analysis:
        text = await self.cosmos.ask_image(frame.image, RIDE_HAZARD_PROMPT, max_tokens=300)
        parsed = extract_json(text)
        warning = normalise_ride_warning(parsed)
        boxes = boxes_from_model(parsed.get("objects")) if parsed else []
        return Analysis(summary=warning["message"], boxes=boxes, data=warning)


class StubRideAnalyser:
    """Offline dev: every 5th frame pretends a van is in the bike lane."""

    name = "stub-ride"

    async def analyse(self, frame: ClientFrame) -> Analysis:
        fake = (
            {
                "hazard": "lane_blocked",
                "advice": "slow",
                "confidence": 0.9,
                "message": "Stub: van in the bike lane ahead",
            }
            if frame.seq % 5 == 0
            else {}
        )
        warning = normalise_ride_warning(fake)
        return Analysis(summary=warning["message"], data=warning)


def build_ride_analyser(cosmos: CosmosReason) -> RideHazardAnalyser | StubRideAnalyser:
    return RideHazardAnalyser(cosmos) if cosmos.configured else StubRideAnalyser()
