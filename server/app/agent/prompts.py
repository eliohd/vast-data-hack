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

EVIDENCE_VERIFICATION_PROMPT_VERSION = "rideahead-verify-1"
EVIDENCE_VERIFICATION_PROMPT = """Watch this bike-camera clip. Question: {question}

Answer only from what is visible:
1. Is the relevant road space (the cycle lane / the rider's lane ahead) visible?
2. Is the specific obstruction visible in it?
3. What visible detail supports your answer?
If the view is obscured or you cannot tell, the verdict is "unclear".

Reply with JSON only:
{"road_space_visible": true | false | null,
 "obstruction_visible": true | false | null,
 "verdict": "supported" | "contradicted" | "unclear",
 "rationale": "<one or two sentences about visible evidence>"}"""

DECISION_EXPLANATION_PROMPT_VERSION = "rideahead-explain-1"
DECISION_EXPLANATION_PROMPT = """Rephrase this navigation decision for a cyclist in one short,
calm sentence. Use only the facts given; do not add locations, times, probabilities, legal
rules or advice that is not in the facts. Facts (JSON): {facts}"""
