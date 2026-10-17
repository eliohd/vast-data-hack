"""W&B Inference (OpenAI-compatible, on CoreWeave) for the app's own reasoning."""

from __future__ import annotations

from typing import Any

import weave
from openai import AsyncOpenAI

from app.core.parsing import extract_json, strip_reasoning


class LLM:
    def __init__(self, base_url: str, api_key: str, project: str, model: str) -> None:
        self.model = model
        self.configured = bool(api_key)
        # `project` (team/project) feeds W&B usage tracking via the OpenAI-Project header.
        self.client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key or "missing",
            project=project or None,
        )

    @weave.op
    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 800,
    ) -> str:
        res = await self.client.chat.completions.create(
            model=model or self.model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return strip_reasoning(res.choices[0].message.content or "")

    async def chat_json(self, system: str, user: str, **kwargs: Any) -> dict[str, Any] | None:
        """Asks for a JSON object and parses it leniently. Returns None if none was produced."""
        text = await self.chat(
            [
                {"role": "system", "content": f"{system}\nReply with a single JSON object only."},
                {"role": "user", "content": user},
            ],
            **kwargs,
        )
        return extract_json(text)
