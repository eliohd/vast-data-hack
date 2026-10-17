"""Protects shared GPUs behind a public URL: optional demo key + per-client rate limit."""

from __future__ import annotations

import hmac

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from starlette.websockets import WebSocket

from app.config import Settings
from app.core.ratelimit import SlidingWindowLimiter

DEMO_KEY_HEADER = "x-demo-key"


def client_key(headers: dict[str, str] | object, host: str | None) -> str:
    """Real client IP behind Cloudflare (CF-Connecting-IP), else the socket peer."""
    getter = getattr(headers, "get", None)
    forwarded = getter("cf-connecting-ip") if getter else None
    return str(forwarded or host or "unknown")


def demo_key_ok(settings: Settings, supplied: str | None) -> bool:
    expected = settings.demo_key.get_secret_value()
    if not expected:
        return True
    return supplied is not None and hmac.compare_digest(supplied, expected)


def websocket_allowed(settings: Settings, websocket: WebSocket) -> bool:
    supplied = websocket.query_params.get("key") or websocket.headers.get(DEMO_KEY_HEADER)
    return demo_key_ok(settings, supplied)


class ApiGuard(BaseHTTPMiddleware):
    """Applies to /api/* only; static pages always load so the UI can explain errors."""

    def __init__(self, app, settings: Settings) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.settings = settings
        self.limiter = SlidingWindowLimiter(settings.rate_limit_per_minute, 60.0)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if not path.startswith("/api/") or path == "/api/health":
            return await call_next(request)
        supplied = request.headers.get(DEMO_KEY_HEADER) or request.query_params.get("key")
        if not demo_key_ok(self.settings, supplied):
            return JSONResponse({"detail": "demo key required"}, status_code=401)
        key = client_key(request.headers, request.client.host if request.client else None)
        if not self.limiter.allow(key):
            return JSONResponse({"detail": "rate limited"}, status_code=429)
        return await call_next(request)
