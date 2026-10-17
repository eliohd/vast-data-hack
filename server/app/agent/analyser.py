"""Turns one live frame into a result. This is where the product logic goes.

`StubAnalyser` needs nothing (local dev, tests). `CosmosAnalyser` asks Cosmos Reason about the
frame. Add your own analyser (Cosmos + archive precedent search + W&B LLM…) and select it in
`build_analyser`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

import weave

from app.agent.prompts import LIVE_FRAME_PROMPT
from app.clients.gpu import CosmosReason
from app.core.parsing import clamp01, extract_json
from app.core.protocol import Box, ClientFrame


@dataclass
class Analysis:
    summary: str
    boxes: list[Box] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)


class FrameAnalyser(Protocol):
    name: str

    async def analyse(self, frame: ClientFrame) -> Analysis: ...


class StubAnalyser:
    name = "stub"

    async def analyse(self, frame: ClientFrame) -> Analysis:
        size_kb = round(len(frame.jpeg_bytes()) / 1024, 1)
        return Analysis(
            summary=f"Received a {frame.width}x{frame.height} frame ({size_kb} KB).",
            data={"prompt": frame.prompt, "bytes": round(size_kb * 1024)},
        )


def boxes_from_model(objects: Any) -> list[Box]:
    """Accepts [{"label", "box": [x, y, w, h]}] and drops anything malformed."""
    boxes: list[Box] = []
    if not isinstance(objects, list):
        return boxes
    for item in objects:
        if not isinstance(item, dict):
            continue
        coords = item.get("box")
        if not (isinstance(coords, list) and len(coords) == 4):
            continue
        x, y, w, h = (clamp01(v) for v in coords)
        if w == 0 or h == 0:
            continue
        boxes.append(
            Box(
                label=str(item.get("label", "object")),
                confidence=clamp01(item.get("confidence", 1.0), 1.0),
                x=x,
                y=y,
                w=w,
                h=h,
            )
        )
    return boxes


class CosmosAnalyser:
    name = "cosmos"

    def __init__(self, cosmos: CosmosReason) -> None:
        self.cosmos = cosmos

    @weave.op
    async def analyse(self, frame: ClientFrame) -> Analysis:
        prompt = LIVE_FRAME_PROMPT
        if frame.prompt:
            prompt += f"\n\nThe user asks: {frame.prompt}"
        text = await self.cosmos.ask_image(frame.image, prompt, max_tokens=400)
        parsed = extract_json(text)
        if parsed is None:
            return Analysis(summary=text.strip() or "(no answer)", data={"raw": text})
        return Analysis(
            summary=str(parsed.get("summary") or text).strip(),
            boxes=boxes_from_model(parsed.get("objects")),
            data=parsed,
        )


def build_analyser(kind: str, cosmos: CosmosReason) -> FrameAnalyser:
    if kind == "cosmos" or (kind == "auto" and cosmos.configured):
        return CosmosAnalyser(cosmos)
    return StubAnalyser()
