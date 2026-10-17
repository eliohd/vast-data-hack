"""Clients for the shared NVIDIA GPU endpoints on CoreWeave: Cosmos Reason, Cosmos Embed,
YOLO11 and Canary-1B. Each model has its own host/port; never derive one URL from another.

Calls are wrapped in weave.op so every model call shows up in Weave traces once tracing is on.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import httpx
import weave

from app.core.parsing import strip_reasoning


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def data_url(mime: str, payload: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(payload).decode()}"


class GpuEndpoint:
    def __init__(self, http: httpx.AsyncClient, base_url: str, token: str) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self.headers = _auth_headers(token)

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    async def get(self, path: str, timeout_s: float | None = None) -> httpx.Response:
        return await self.http.get(
            f"{self.base_url}{path}", headers=self.headers, timeout=timeout_s
        )

    async def post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        res = await self.http.post(f"{self.base_url}{path}", headers=self.headers, json=body)
        res.raise_for_status()
        return res.json()


class _ModelDiscovery(GpuEndpoint):
    """OpenAI-style endpoint whose model id can be discovered from /v1/models."""

    def __init__(self, http: httpx.AsyncClient, base_url: str, token: str, model: str) -> None:
        super().__init__(http, base_url, token)
        self._model = model

    async def model(self) -> str:
        if not self._model:
            res = await self.get("/v1/models")
            res.raise_for_status()
            self._model = res.json()["data"][0]["id"]
        return self._model


class CosmosReason(_ModelDiscovery):
    """Vision-language model (OpenAI-compatible chat). Accepts image_url and video_url parts."""

    @weave.op
    async def chat(
        self,
        content: list[dict[str, Any]] | str,
        *,
        system: str | None = None,
        max_tokens: int = 512,
        temperature: float = 0.2,
    ) -> str:
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": content})
        body = {
            "model": await self.model(),
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        data = await self.post_json("/v1/chat/completions", body)
        return strip_reasoning(data["choices"][0]["message"].get("content") or "")

    async def ask_image(self, image_data_url: str, prompt: str, **kwargs: Any) -> str:
        content = [
            {"type": "image_url", "image_url": {"url": image_data_url}},
            {"type": "text", "text": prompt},
        ]
        return await self.chat(content, **kwargs)

    async def ask_video(self, mp4: bytes, prompt: str, **kwargs: Any) -> str:
        content = [
            {"type": "video_url", "video_url": {"url": data_url("video/mp4", mp4)}},
            {"type": "text", "text": prompt},
        ]
        return await self.chat(content, **kwargs)


class CosmosEmbed(_ModelDiscovery):
    """256-dim text and video embeddings in one space (Cosmos-Embed1)."""

    @weave.op
    async def embed(self, value: str, request_type: str = "query") -> list[float]:
        body = {
            "model": await self.model(),
            "input": value,
            "request_type": request_type,
            "encoding_format": "float",
        }
        data = await self.post_json("/v1/embeddings", body)
        return data["data"][0]["embedding"]

    async def embed_text(self, text: str) -> list[float]:
        return await self.embed(text, "query")

    async def embed_video(self, mp4: bytes) -> list[float]:
        return await self.embed(data_url("video/mp4", mp4), "query")


class Yolo(GpuEndpoint):
    """YOLO11 infer service. Health is /healthz (no /v1/models on this server)."""

    @weave.op
    async def infer_video(self, mp4: bytes, filename: str = "clip.mp4") -> dict[str, Any]:
        body = {
            "video_base64": base64.b64encode(mp4).decode(),
            "filename": filename,
            "include_frames": True,
        }
        return await self.post_json("/v1/infer", body)


class Canary(GpuEndpoint):
    """Canary-1B speech-to-text (Riva HTTP). Health is /v1/health/ready; /v1/models is a 404."""

    def __init__(self, http: httpx.AsyncClient, base_url: str, token: str, model: str) -> None:
        super().__init__(http, base_url, token)
        self.model = model

    @weave.op
    async def transcribe(self, audio: bytes, filename: str = "audio.wav") -> dict[str, Any]:
        res = await self.http.post(
            f"{self.base_url}/v1/audio/transcriptions",
            headers=self.headers,
            files={"file": (filename, audio)},
            data={"model": self.model},
        )
        res.raise_for_status()
        return res.json()


async def timed_get(endpoint: GpuEndpoint, path: str, timeout_s: float) -> tuple[bool, int, str]:
    """GETs `path` and returns (ok, latency_ms, detail) without raising."""
    started = time.perf_counter()
    try:
        res = await endpoint.get(path, timeout_s=timeout_s)
        ok = res.status_code < 400
        detail = f"HTTP {res.status_code}"
    except httpx.HTTPError as exc:
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    return ok, round((time.perf_counter() - started) * 1000), detail
