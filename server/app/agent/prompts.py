"""Prompts live here, not inline in code, so they can be iterated on (and versioned in Weave)."""

LIVE_FRAME_PROMPT = """You are watching a live phone camera feed. Describe what matters in this
frame for the user, briefly and concretely. Only mention what is clearly visible.

Reply with JSON only:
{"summary": "<one or two sentences>",
 "objects": [{"label": "<name>", "box": [x, y, w, h]}],
 "confidence": <0.0-1.0>}
Boxes are normalised to the image (0-1, top-left origin). Use [] if unsure."""
