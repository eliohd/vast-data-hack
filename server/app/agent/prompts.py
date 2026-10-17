"""Prompts live here, not inline in code, so they can be iterated on (and versioned in Weave)."""

LIVE_FRAME_PROMPT = """You are watching a live phone camera feed. Describe what matters in this
frame for the user, briefly and concretely. Only mention what is clearly visible.

Reply with JSON only:
{"summary": "<one or two sentences>",
 "objects": [{"label": "<name>", "box": [x, y, w, h]}],
 "confidence": <0.0-1.0>}
Boxes are normalised to the image (0-1, top-left origin). Use [] if unsure."""

# -- RideAhead (versioned; bump the version string whenever the text changes) ----------------

OBSERVATION_EXTRACTION_PROMPT_VERSION = "rideahead-extract-1"
OBSERVATION_EXTRACTION_PROMPT = """You turn a dashcam/bike-camera clip description into one
structured cycling-hazard claim. Hazard types: "lane_blocked" (something occupies the cycle lane
or the cyclist's lane so a rider must leave it), "work_zone" (roadworks / barriers / cones).

Read clause by clause. Negation applies only to its own clause:
- "No vehicles block the bike lane." → assertion "clear" for that clip (not a hazard)
- "No cars are moving because a truck blocks the lane." → "present" (the truck blocks it)
- "A truck is parked beside the bike lane." → "unclear" unless it occupies the lane
- "A truck may be blocking the lane." → "unclear", support "uncertain"
- The relevant road space is obscured or out of view → "unclear"
Object detections support a claim but do not prove blockage. Never invent location, distance,
duration or legal status.

Reply with JSON only:
{"hazard_type": "lane_blocked" | "work_zone",
 "assertion": "present" | "clear" | "unclear",
 "support": "supported" | "uncertain" | "contradicted",
 "description": "<one short factual sentence>",
 "evidence_quote": "<the clause you relied on>",
 "confidence": <0.0-1.0, self-reported>}"""

EVIDENCE_VERIFICATION_PROMPT_VERSION = "rideahead-verify-2"
# v2 (lane C proposal): locate the lane markings first, then ask about wheels inside them, so
# vehicles beside the lane or in the buffer are not reported as blocking it.
EVIDENCE_VERIFICATION_PROMPT = """You are checking a short forward-facing bicycle camera clip.
Claim to check: {question}

Answer step by step from what is visible, then give JSON:
1. Where are the bicycle-lane markings (green paint, bike symbols, lane lines, flexible posts)?
   If you cannot see them, the lane is not visible.
2. Is any vehicle (or object) with its wheels or body inside those markings, not merely beside
   them or in a hatched buffer?
3. At which second(s) is it visible?
Use "supported" only if something occupies part of the bike lane, "contradicted" only if the
bike lane is clearly visible and unobstructed, otherwise "unclear".

Reply with JSON only:
{"road_space_visible": true | false | null,
 "obstruction_visible": true | false | null,
 "verdict": "supported" | "contradicted" | "unclear",
 "object": "<vehicle or object type, or null>",
 "evidence_seconds": [<start>, <end>] | null,
 "rationale": "<one short factual sentence about visible evidence>"}"""

DECISION_EXPLANATION_PROMPT_VERSION = "rideahead-explain-1"
DECISION_EXPLANATION_PROMPT = """Rephrase this navigation decision for a cyclist in one short,
calm sentence. Use only the facts given; do not add locations, times, probabilities, legal
rules or advice that is not in the facts. Facts (JSON): {facts}"""


def verification_prompt(question: str) -> str:
    """EVIDENCE_VERIFICATION_PROMPT with the claim filled in (JSON braces make .format unsafe)."""
    return EVIDENCE_VERIFICATION_PROMPT.replace("{question}", question)
