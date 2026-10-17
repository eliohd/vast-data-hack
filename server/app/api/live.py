"""/ws/live — the fast lane. The phone sends one JPEG at a time; we answer before it sends the
next (the client enforces one frame in flight), so a slow model never builds a queue."""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.api.guard import client_key, websocket_allowed
from app.core.protocol import (
    ClientFrame,
    ClientPing,
    ServerError,
    ServerHello,
    ServerPong,
    ServerResult,
    client_message_adapter,
)
from app.core.ratelimit import SlidingWindowLimiter
from app.services import get_ws_services

router = APIRouter()
log = logging.getLogger(__name__)

MAX_FRAME_BYTES = 2_000_000
# Frames per minute per client; 1 fps for an hour-long demo is 60/min.
frame_limiter = SlidingWindowLimiter(limit=180, window_s=60.0)


@router.websocket("/ws/live")
async def live(websocket: WebSocket) -> None:
    services = get_ws_services(websocket)
    if not websocket_allowed(services.settings, websocket):
        await websocket.close(code=4401, reason="demo key required")
        return

    await websocket.accept()
    session_id = uuid.uuid4().hex[:8]
    who = client_key(websocket.headers, websocket.client.host if websocket.client else None)
    await websocket.send_json(
        ServerHello(session_id=session_id, analyser=services.analyser_name).dump()
    )

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > MAX_FRAME_BYTES * 4 // 3 + 1024:
                await websocket.send_json(ServerError(message="frame too large").dump())
                continue
            try:
                message = client_message_adapter.validate_json(raw)
            except ValidationError:
                await websocket.send_json(ServerError(message="malformed message").dump())
                continue

            if isinstance(message, ClientPing):
                await websocket.send_json(ServerPong(sent_at=message.sent_at).dump())
                continue

            assert isinstance(message, ClientFrame)
            if not frame_limiter.allow(who):
                await websocket.send_json(
                    ServerError(seq=message.seq, message="rate limited — slow down").dump()
                )
                continue

            started = time.perf_counter()
            try:
                analysis = await services.analyser.analyse(message)
            except Exception as exc:
                log.exception("analyser failed")
                await websocket.send_json(
                    ServerError(seq=message.seq, message=f"analysis failed: {exc}").dump()
                )
                continue

            result = ServerResult(
                seq=message.seq,
                captured_at=message.captured_at,
                processing_ms=round((time.perf_counter() - started) * 1000),
                summary=analysis.summary,
                boxes=analysis.boxes,
                data=analysis.data,
            )
            await websocket.send_json(result.dump())
    except WebSocketDisconnect:
        return
