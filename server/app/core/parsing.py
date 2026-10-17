"""Pulling structured data out of model output. VLMs wrap JSON in prose and fences; be lenient."""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)
_THINK = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)


def strip_reasoning(text: str) -> str:
    """Removes <think>…</think> blocks that reasoning models (Cosmos Reason) may emit."""
    return _THINK.sub("", text).strip()


def extract_json(text: str) -> dict[str, Any] | None:
    """Returns the first JSON object found in `text`, or None.

    Tries, in order: the whole string, fenced code blocks, then the outermost {...} span.
    """
    text = strip_reasoning(text or "")
    if not text:
        return None

    candidates = [text, *(_FENCE.findall(text))]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            value = json.loads(candidate.strip())
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def clamp01(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, number))
