"""/api/archive — thin, typed-enough proxies to VSS for the browser. Credentials and the JWT stay
on the server; the browser never sees them (video playback is proxied too)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from app.services import Services, get_services

router = APIRouter(prefix="/api/archive", tags=["archive"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(15, ge=1, le=100)
    llm_top_n: int = Field(3, ge=1, le=100)
    min_similarity: float = Field(0.3, ge=0, le=1)
    metadata_filters: dict[str, Any] = Field(default_factory=dict)
    time_filter: str = "all"


class AskRequest(BaseModel):
    question: str
    original_video: str | None = None
    top_k: int = Field(5, ge=1, le=50)


@router.post("/search")
async def search(body: SearchRequest, services: Services = Depends(get_services)) -> dict[str, Any]:
    return await services.vss.search(body.model_dump())


@router.post("/ask")
async def ask(body: AskRequest, services: Services = Depends(get_services)) -> dict[str, Any]:
    return await services.vss.ask(body.question, body.original_video, body.top_k)


@router.get("/explore")
async def explore(
    scope: str = "all",
    limit: int = Query(48, ge=1, le=100),
    offset: int = Query(0, ge=0),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    return await services.vss.explore(scope=scope, limit=limit, offset=offset)


@router.get("/segment")
async def segment(source: str, services: Services = Depends(get_services)) -> dict[str, Any]:
    return await services.vss.segment_metadata(source)


@router.get("/detections")
async def detections(source: str, services: Services = Depends(get_services)) -> dict[str, Any]:
    return await services.vss.detections(source)


@router.get("/media")
async def media(
    source: str, request: Request, services: Services = Depends(get_services)
) -> StreamingResponse:
    """Streams a segment through the server (Range-aware) so <video src> works without a JWT."""
    url = await services.vss.stream_url(source)
    headers = {"Range": request.headers["range"]} if "range" in request.headers else {}
    upstream_req = services.vss.http.build_request("GET", url, headers=headers)
    upstream = await services.vss.http.send(upstream_req, stream=True)
    passthrough = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() in {"content-type", "content-length", "content-range", "accept-ranges"}
    }
    return StreamingResponse(
        upstream.aiter_bytes(),
        status_code=upstream.status_code,
        headers=passthrough,
        background=BackgroundTask(upstream.aclose),
    )
