"""One place that builds every upstream client from Settings. Created once per app (lifespan)
and reached from routes with `Depends(get_services)`."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

import httpx
from fastapi import Request, WebSocket

from app.agent.analyser import FrameAnalyser, StubAnalyser, build_analyser
from app.agent.hazards import build_engine
from app.agent.interfaces import PerceptionProvider, RoutingProvider
from app.agent.models import IntegrationName, IntegrationStatus
from app.agent.perception import ArchivePerceptionProvider
from app.agent.perception_fixture import FixturePerceptionProvider
from app.agent.routing import CachedRouting, FixtureRoutingProvider, OpenRouteServiceProvider
from app.agent.runtime import RideAheadRuntime, Scenario
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
    rideahead: RideAheadRuntime = field(init=False)

    @property
    def analyser_name(self) -> str:
        return self.analyser.name

    @classmethod
    def create(cls, settings: Settings) -> Services:
        """Builds clients, starts tracing and picks the frame analyser."""
        services = cls.build(settings)
        services.tracing = init_tracing(settings)
        services.analyser = build_analyser(settings.analyser, services.cosmos)
        services.rideahead = services.build_rideahead()
        return services

    # -- RideAhead wiring ------------------------------------------------------------------

    def build_rideahead(self) -> RideAheadRuntime:
        s = self.settings
        fixtures = s.rideahead_fixtures
        perception: PerceptionProvider
        if s.rideahead_perception == "archive":
            perception = ArchivePerceptionProvider(
                self.vss, self.cosmos, self.yolo, self.llm, fixtures / "cache"
            )
        else:
            perception = FixturePerceptionProvider(fixtures / "observations.json")
        routing: RoutingProvider
        store = None
        ors_key = s.ors_api_key.get_secret_value()
        ors_store = fixtures / "routes_ors_cache.json"
        # auto: live ORS with a key; without one, replay recorded ORS responses (labelled cached)
        use_ors = s.rideahead_routing == "ors" or (
            s.rideahead_routing == "auto" and (ors_key or ors_store.is_file())
        )
        if use_ors:
            routing = OpenRouteServiceProvider(self.http, ors_key, s.ors_base_url, s.ors_profile)
            store = ors_store
        else:
            routing = FixtureRoutingProvider(fixtures / "routes.json")
        return RideAheadRuntime(
            perception=perception,
            routing=CachedRouting(routing, store_path=store),
            engine_factory=build_engine,
            scenario=Scenario.load(fixtures / s.rideahead_scenario),
            extra_scenarios=[
                Scenario.load(fixtures / name)
                for name in s.rideahead_extra_scenarios
                if name != s.rideahead_scenario and (fixtures / name).is_file()
            ],
            integrations=self.rideahead_integrations,
            snapshot_dir=s.data_dir / "rideahead" if s.rideahead_snapshots else None,
        )

    def rideahead_integrations(self) -> list[IntegrationStatus]:
        """Honest status per integration. A provider may override with `statuses()`."""
        rt = self.rideahead
        live = rt.perception.name != "fixture"

        def upstream(name: IntegrationName, configured: bool, what: str) -> IntegrationStatus:
            if not live:
                return IntegrationStatus(
                    name=name, state="fixture", detail=f"fixture perception; {what} not called"
                )  # type: ignore[arg-type]
            state = "configured" if configured else "not_configured"
            return IntegrationStatus(name=name, state=state, detail=what)  # type: ignore[arg-type]

        statuses = {
            "vast": upstream("vast", self.vss.configured, "VSS retrieval"),
            "cosmos": upstream("cosmos", self.cosmos.configured, "Cosmos Reason"),
            "yolo": upstream("yolo", self.yolo.configured, "YOLO11"),
            "wandb_inference": upstream("wandb_inference", self.llm.configured, "W&B Inference"),
            "weave": IntegrationStatus(
                name="weave",
                state="connected" if self.tracing else "not_configured",
                detail=self.settings.wandb_entity_project if self.tracing else "tracing off",
            ),
        }
        routing = rt.routing
        if routing.name == "fixture":
            statuses["routing"] = IntegrationStatus(
                name="routing", state="fixture", detail="hand-drawn fixture routes"
            )
        elif routing.serving_cached:
            statuses["routing"] = IntegrationStatus(
                name="routing",
                state="cached",
                detail=f"recorded {routing.name} responses; live call failed: {routing.last_error}",
            )
        elif routing.last_error:
            statuses["routing"] = IntegrationStatus(
                name="routing", state="unavailable", detail=routing.last_error
            )
        else:
            state = "connected" if routing.calls else "configured"
            statuses["routing"] = IntegrationStatus(
                name="routing", state=state, detail=f"{routing.name} {self.settings.ors_profile}"
            )
        extra = getattr(rt.perception, "statuses", None)
        if callable(extra):
            provided: list[IntegrationStatus] = extra()  # type: ignore[assignment]
            for st in provided:
                statuses[st.name] = st
        return list(statuses.values())

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
