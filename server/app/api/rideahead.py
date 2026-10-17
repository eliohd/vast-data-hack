"""/api/rideahead — typed RideAhead API. Reads never advance time or call models."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.agent.models import (
    AdvanceRequest,
    Capabilities,
    CreateSessionRequest,
    RideManifest,
    SessionConfigUpdate,
    SessionSnapshot,
)
from app.agent.runtime import RideAheadRuntime, SessionNotFound
from app.services import Services, get_services

router = APIRouter(prefix="/api/rideahead", tags=["rideahead"])


def get_runtime(services: Services = Depends(get_services)) -> RideAheadRuntime:
    return services.rideahead


@router.get("/capabilities", response_model=Capabilities)
async def capabilities(services: Services = Depends(get_services)) -> Capabilities:
    rt = services.rideahead
    config = rt.default_config()
    return Capabilities(
        perception_provider=rt.perception.name,
        routing_provider=rt.routing.name,
        hazard_engine=rt.engine_name,
        integrations=services.rideahead_integrations(),
        hazard_types=list(config.hazard_types.values()),
        default_config=config,
    )


@router.get("/rides", response_model=list[RideManifest])
async def rides(rt: RideAheadRuntime = Depends(get_runtime)) -> list[RideManifest]:
    return await rt.perception.list_rides()


@router.post("/sessions", response_model=SessionSnapshot)
async def create_session(
    body: CreateSessionRequest, rt: RideAheadRuntime = Depends(get_runtime)
) -> SessionSnapshot:
    return await rt.create_session(body.ride_id)


@router.get("/sessions/{session_id}", response_model=SessionSnapshot)
async def get_session(
    session_id: str, rt: RideAheadRuntime = Depends(get_runtime)
) -> SessionSnapshot:
    try:
        return rt.snapshot(session_id)
    except SessionNotFound as exc:
        raise HTTPException(404, "session not found") from exc


@router.post("/sessions/{session_id}/advance", response_model=SessionSnapshot)
async def advance(
    session_id: str, body: AdvanceRequest, rt: RideAheadRuntime = Depends(get_runtime)
) -> SessionSnapshot:
    try:
        return await rt.advance(session_id, body.to_s)
    except SessionNotFound as exc:
        raise HTTPException(404, "session not found") from exc


@router.patch("/sessions/{session_id}/config", response_model=SessionSnapshot)
async def update_config(
    session_id: str, body: SessionConfigUpdate, rt: RideAheadRuntime = Depends(get_runtime)
) -> SessionSnapshot:
    try:
        return await rt.update_config(session_id, body)
    except SessionNotFound as exc:
        raise HTTPException(404, "session not found") from exc
