"""Clause-level reading of segment captions for lane-obstruction claims.

Captions from the VSS pipeline often deny things ("No vehicles are blocking the lanes") or mix a
denial with a claim in one sentence ("No clear violations are evident, but ... a sedan partially
blocking the lane"). Dropping every sentence containing "no" loses real claims; keeping them
creates fake hazards. This module splits captions into clauses and classifies each one.

The result is a *candidate* only: it says what the caption claims, not what is true. A denial is
never a clearance observation. Model verification and the hazard engine decide the rest.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Assertion = Literal["present", "denied", "hedged", "adjacent", "unclear", "none"]
LaneRef = Literal["bike_lane", "lane", "roadway", "unknown"]

# Clause boundaries: sentence ends, semicolons and contrastive / causal conjunctions, so that
# "No cars are moving because a truck blocks the lane" yields a separate positive clause.
_CLAUSE_SPLIT = re.compile(
    r"(?<=[.;!?])\s+|,?\s+\b(?:but|because|although|though|while|whereas|however)\b\s*",
    re.IGNORECASE,
)
_BLOCK = re.compile(r"\b(block(?:s|ed|ing)?|obstruct(?:s|ed|ing)?|double[- ]parked)\b", re.I)
_NEGATION = re.compile(r"\b(no|not|none|nothing|without|never|neither|nor)\b|n't\b", re.I)
# A hedge only counts when it modifies the blocking verb ("may be blocking"), so that
# "partially blocking the lane and creating a potential hazard" stays a firm claim.
_HEDGE = re.compile(
    r"\b(may|might|could|possibly|perhaps|appears? to|seems? to|likely|potentially)\b"
    r"(?:\W+\w+){0,2}?\W+(?:block|obstruct|double[- ]park)",
    re.I,
)
_ADJACENT = re.compile(r"\b(beside|next to|alongside|adjacent to|near)\b", re.I)
_UNCLEAR = re.compile(
    r"\b(obscured|occluded|not (?:clearly )?visible|cannot be (?:seen|determined)|"
    r"hard to (?:see|tell)|out of (?:view|frame))\b",
    re.I,
)
_LANE_WORDS = re.compile(
    r"\b(bike lane|bicycle lane|cycle lane|cycling lane|lane|lanes|roadway|road|path|traffic)\b",
    re.I,
)


@dataclass(frozen=True)
class ClauseFinding:
    assertion: Assertion
    lane_ref: LaneRef
    clause: str


def split_clauses(caption: str) -> list[str]:
    parts = (p.strip(" ,.") for p in _CLAUSE_SPLIT.split(caption or ""))
    return [p for p in parts if p]


def _lane_ref(clause: str) -> LaneRef:
    text = clause.lower()
    if re.search(r"\b(bike|bicycle|cycle|cycling) lane\b", text):
        return "bike_lane"
    if re.search(r"\blanes?\b", text):
        return "lane"
    if re.search(r"\b(roadway|road|traffic|path)\b", text):
        return "roadway"
    return "unknown"


def classify_clause(clause: str) -> ClauseFinding:
    """Classifies one clause. `none` means it says nothing about an obstruction."""
    lane = _lane_ref(clause)
    if _UNCLEAR.search(clause) and _LANE_WORDS.search(clause):
        return ClauseFinding("unclear", lane, clause)
    if not _BLOCK.search(clause):
        # "A truck is parked beside the bike lane": near the lane, not in it.
        if _ADJACENT.search(clause) and lane != "unknown" and re.search(r"\bpark", clause, re.I):
            return ClauseFinding("adjacent", lane, clause)
        return ClauseFinding("none", lane, clause)
    if _NEGATION.search(clause):
        return ClauseFinding("denied", lane, clause)
    if _HEDGE.search(clause):
        return ClauseFinding("hedged", lane, clause)
    return ClauseFinding("present", lane, clause)


def lane_block_findings(caption: str) -> list[ClauseFinding]:
    """All clauses of a caption that say something about lane obstruction."""
    return [f for f in map(classify_clause, split_clauses(caption)) if f.assertion != "none"]


_PRIORITY: dict[Assertion, int] = {
    "present": 5,
    "hedged": 4,
    "unclear": 3,
    "adjacent": 2,
    "denied": 1,
    "none": 0,
}


def caption_assertion(caption: str) -> ClauseFinding:
    """Strongest lane-obstruction claim in a caption.

    A positive clause outranks a denial elsewhere in the caption, because captions routinely
    append boilerplate denials ("no violations") to scenes that do contain an obstruction.
    """
    findings = lane_block_findings(caption)
    if not findings:
        return ClauseFinding("none", "unknown", "")
    return max(findings, key=lambda f: (_PRIORITY[f.assertion], f.lane_ref == "bike_lane"))
