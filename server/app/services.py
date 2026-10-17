"""One place that builds every upstream client from Settings. Created once per app (lifespan)
and reached from routes with `Depends(get_services)`."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

import httpx
from fastapi import Request, WebSocket

from app.agent.analyser import FrameAnalyser, StubAnalyser, build_analyser
from app.clients.gpu import Canary, CosmosEmbed, CosmosReason, Yolo
from app.clients.llm import LLM
from app.clients.vss import VSSClient
from app.config import Settings

log = logging.getLogger(__name__)


@dataclass
class Services:
    settings: Settings
    http: httpx.AsyncClient
    vss: VSSClient
    cosmos: CosmosReason
    embed: CosmosEmbed
    yolo: Yolo
    canary: Canary
    llm: LLM
    analyser: FrameAnalyser = field(default_factory=StubAnalyser)
    tracing: bool = False

    @property
    def analyser_name(self) -> str:
        return self.analyser.name

    @classmethod
    def create(cls, settings: Settings) -> Services:
        """Builds clients, starts tracing and picks the frame analyser."""
        services = cls.build(settings)
        services.tracing = init_tracing(settings)
        services.analyser = build_analyser(settings.analyser, services.cosmos)
        return services

    @classmethod
    def build(cls, settings: Settings) -> Services:
        http = httpx.AsyncClient(timeout=settings.upstream_timeout_s)
        vss_http = httpx.AsyncClient(
            timeout=settings.upstream_timeout_s, verify=settings.vss_verify_tls
        )
        token = settings.gpu_bearer_token.get_secret_value()
        return cls(
            settings=settings,
            http=http,
            vss=VSSClient(
                vss_http,
                settings.vss_url,
                settings.vss_username,
                settings.vss_password.get_secret_value(),
            ),
            cosmos=CosmosReason(
                http, settings.cosmos_reason_url, token, settings.cosmos_reason_model
            ),
            embed=CosmosEmbed(http, settings.cosmos_embed_url, token, settings.cosmos_embed_model),
            yolo=Yolo(http, settings.yolo_url, token),
            canary=Canary(http, settings.canary_url, token, settings.canary_model),
            llm=LLM(
                settings.llm_base_url,
                settings.wandb_api_key.get_secret_value(),
                settings.wandb_entity_project,
                settings.llm_model,
            ),
        )

    async def close(self) -> None:
        await self.http.aclose()
        await self.vss.http.aclose()


def init_tracing(settings: Settings) -> bool:
    """Starts Weave tracing when W&B is configured. Every @weave.op call is then traced."""
    key = settings.wandb_api_key.get_secret_value()
    if not (settings.tracing and key and settings.wandb_entity_project):
        return False
    os.environ.setdefault("WANDB_API_KEY", key)
    try:
        import weave

        weave.init(settings.wandb_entity_project)
        return True
    except Exception as exc:  # tracing must never take the app down
        log.warning("Weave init failed: %s", exc)
        return False


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_ws_services(websocket: WebSocket) -> Services:
    return websocket.app.state.services
