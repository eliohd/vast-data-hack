"""Health. /api/health is instant; /api/health/upstreams probes every dependency in parallel —
run it first thing at 9:30 (or `make probe`) to see what's reachable from where."""

from __future__ import annotations

import asyncio
import time

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.clients.gpu import GpuEndpoint, timed_get
from app.services import Services, get_services

router = APIRouter(prefix="/api/health", tags=["health"])

PROBE_TIMEOUT_S = 8.0


class Health(BaseModel):
    status: str
    team: str
    analyser: str
    tracing: bool


class UpstreamStatus(BaseModel):
    name: str
    configured: bool
    ok: bool
    latency_ms: int | None = None
    detail: str = ""


class UpstreamReport(BaseModel):
    upstreams: list[UpstreamStatus]


@router.get("", response_model=Health)
async def health(services: Services = Depends(get_services)) -> Health:
    return Health(
        status="ok",
        team=services.settings.team,
        analyser=services.analyser_name,
        tracing=services.tracing,
    )


async def _probe_gpu(name: str, endpoint: GpuEndpoint, path: str) -> UpstreamStatus:
    if not endpoint.configured:
        return UpstreamStatus(name=name, configured=False, ok=False, detail="not configured")
    ok, latency, detail = await timed_get(endpoint, path, PROBE_TIMEOUT_S)
    return UpstreamStatus(name=name, configured=True, ok=ok, latency_ms=latency, detail=detail)


async def _probe_vss(services: Services) -> UpstreamStatus:
    if not services.vss.configured:
        return UpstreamStatus(name="vss", configured=False, ok=False, detail="not configured")
    started = time.perf_counter()
    try:
        me = await asyncio.wait_for(services.vss.me(), PROBE_TIMEOUT_S)
        ok, detail = True, f"logged in as {me.get('username', '?')}"
    except Exception as exc:
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    latency = round((time.perf_counter() - started) * 1000)
    return UpstreamStatus(name="vss", configured=True, ok=ok, latency_ms=latency, detail=detail)


async def _probe_wandb(services: Services) -> UpstreamStatus:
    key = services.settings.wandb_api_key.get_secret_value()
    if not key:
        return UpstreamStatus(name="wandb", configured=False, ok=False, detail="not configured")
    started = time.perf_counter()
    try:
        res = await services.http.get(
            f"{services.settings.llm_base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=PROBE_TIMEOUT_S,
        )
        ok, detail = res.status_code < 400, f"HTTP {res.status_code}"
    except httpx.HTTPError as exc:
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    latency = round((time.perf_counter() - started) * 1000)
    return UpstreamStatus(name="wandb", configured=True, ok=ok, latency_ms=latency, detail=detail)


@router.get("/upstreams", response_model=UpstreamReport)
async def upstreams(services: Services = Depends(get_services)) -> UpstreamReport:
    results = await asyncio.gather(
        _probe_vss(services),
        _probe_gpu("cosmos_reason", services.cosmos, "/v1/models"),
        _probe_gpu("cosmos_embed", services.embed, "/v1/models"),
        _probe_gpu("yolo", services.yolo, "/healthz"),
        _probe_gpu("canary", services.canary, "/v1/health/ready"),
        _probe_wandb(services),
    )
    return UpstreamReport(upstreams=list(results))
