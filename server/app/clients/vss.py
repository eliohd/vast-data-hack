"""Client for the team's VSS retrieval backend ($INGRESS_URL).

The backend is private to VAST's network, so this only works on the lab VM (or through a
tunnel to it). Auth: POST /api/v1/auth/login with the team user → JWT, re-login on 401.
Endpoint shapes follow the organisers' `.cursor/skills/retrieval/*` and `ingest/*` skills.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import weave


class VSSError(RuntimeError):
    pass


class VSSClient:
    def __init__(self, http: httpx.AsyncClient, base_url: str, username: str, password: str):
        self.http = http
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self._token: str | None = None
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.username and self.password)

    # -- auth ----------------------------------------------------------------------------

    async def token(self, refresh: bool = False) -> str:
        async with self._lock:
            if self._token and not refresh:
                return self._token
            res = await self.http.post(
                f"{self.base_url}/api/v1/auth/login",
                json={"username": self.username, "password": self.password},
            )
            if res.status_code != 200:
                raise VSSError(f"VSS login failed: HTTP {res.status_code}")
            token: str = res.json()["access_token"]
            self._token = token
            return token

    async def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if not self.configured:
            raise VSSError("VSS is not configured (VSS_URL / VSS_USERNAME / VSS_PASSWORD)")
        for attempt in (0, 1):
            headers = {**kwargs.pop("headers", {}), "Authorization": f"Bearer {await self.token()}"}
            res = await self.http.request(
                method, f"{self.base_url}{path}", headers=headers, **kwargs
            )
            if res.status_code != 401 or attempt == 1:
                return res
            await self.token(refresh=True)
        raise AssertionError("unreachable")

    async def json(self, method: str, path: str, **kwargs: Any) -> Any:
        res = await self.request(method, path, **kwargs)
        if res.status_code >= 400:
            raise VSSError(f"{method} {path} → HTTP {res.status_code}: {res.text[:300]}")
        return res.json()

    # -- retrieval -----------------------------------------------------------------------

    async def me(self) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/auth/me")

    @weave.op
    async def search(self, body: dict[str, Any]) -> dict[str, Any]:
        """Hybrid search. Body: query, top_k, llm_top_n, min_similarity, metadata_filters, …"""
        return await self.json("POST", "/api/v1/search", json=body)

    @weave.op
    async def ask(
        self, question: str, original_video: str | None = None, top_k: int = 5
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"question": question, "top_k": top_k}
        if original_video:
            body["original_video"] = original_video
        return await self.json("POST", "/api/v1/agent/ask", json=body)

    async def explore(self, **params: Any) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/videos/explore", params=params)

    async def segments(self, original_video: str) -> dict[str, Any]:
        return await self.json(
            "GET", "/api/v1/tools/segments", params={"original_video": original_video}
        )

    async def segment_metadata(self, source: str) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/videos/metadata", params={"source": source})

    async def detections(self, source: str) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/tools/detections", params={"source": source})

    async def synthesize(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self.json("POST", "/api/v1/videos/synthesize", json=body)

    async def metadata_schema(self) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/metadata/schema")

    async def ingest_config(self) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/metadata/ingest-config")

    async def dashboard(self, scope: str = "all") -> dict[str, Any]:
        return await self.json("GET", "/api/v1/dashboard/stats", params={"scope": scope})

    async def suggestions(self) -> dict[str, Any]:
        return await self.json("GET", "/api/v1/suggestions")

    # -- ingest --------------------------------------------------------------------------

    @weave.op
    async def upload(
        self, filename: str, content: bytes, content_type: str, fields: dict[str, str]
    ) -> dict[str, Any]:
        """POST /api/v1/videos/upload. Fields: scenario | custom_prompt (≤800 chars), camera_id,
        capture_type, location, tags, is_public, stream_id + chunk_number."""
        return await self.json(
            "POST",
            "/api/v1/videos/upload",
            files={"file": (filename, content, content_type)},
            data=fields,
        )

    @weave.op
    async def reingest(self, body: dict[str, Any]) -> dict[str, Any]:
        """Body: stream_id + chunk_count, or original_video + chunk_count=1; optional
        scenario / custom_prompt / camera_id / capture_type / location overrides."""
        return await self.json("POST", "/api/v1/dashboard/reingest", json=body)

    async def reingest_status(self, job_id: str) -> dict[str, Any]:
        return await self.json("GET", f"/api/v1/dashboard/reingest/{job_id}")

    # -- media ---------------------------------------------------------------------------

    async def stream_url(self, source: str) -> str:
        """Playable URL for a segment. The JWT rides in the query string (a <video> limitation),
        so only ever use this server-side — never hand it to the browser."""
        params = httpx.QueryParams({"source": source, "token": await self.token()})
        return f"{self.base_url}/api/v1/videos/stream?{params}"
