"""FastAPI entry point. One origin serves everything behind the Cloudflare tunnel:

    /api/*     JSON API (typed; exported to web/ via OpenAPI)
    /ws/live   live frame WebSocket
    /*         the built Astro site (web/dist), when present

Run: `uv run uvicorn app.main:app --reload` (or `make dev` from the repo root).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import archive, clips, health, live
from app.api.guard import ApiGuard
from app.clients.vss import VSSError
from app.config import Settings, get_settings
from app.services import Services

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services = Services.create(settings)
        app.state.services = services
        logging.getLogger("app").info(
            "team=%s analyser=%s tracing=%s web_dist=%s",
            settings.team,
            services.analyser_name,
            services.tracing,
            settings.web_dist if settings.web_dist.is_dir() else "(not built)",
        )
        yield
        await services.close()

    app = FastAPI(title="hack", version="0.1.0", lifespan=lifespan)
    app.add_middleware(ApiGuard, settings=settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(VSSError)
    async def vss_error(_: Request, exc: VSSError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=502)

    @app.exception_handler(httpx.HTTPError)
    async def upstream_error(_: Request, exc: httpx.HTTPError) -> JSONResponse:
        return JSONResponse({"detail": f"upstream error: {exc}"}, status_code=502)

    for module in (health, live, clips, archive):
        app.include_router(module.router)

    # Last: the static site, so it never shadows /api or /ws.
    if settings.web_dist.is_dir():
        app.mount("/", StaticFiles(directory=settings.web_dist, html=True), name="web")

    return app


app = create_app()
