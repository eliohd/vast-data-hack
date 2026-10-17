"""Settings, loaded from (highest priority first):

1. real environment variables
2. ``server/.env``                      (our names, see .env.example)
3. the organisers' team config file      (``/config/<team>.config`` on the lab VM, or $TEAM_CONFIG)

The team config uses the organisers' variable names (USERNAME, INGRESS_URL, COSMOS3_REASON_URL…).
``TEAM_CONFIG_KEYS`` maps those onto our field names, so on the VM nothing needs copying.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import SecretStr
from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent

# field name -> organiser variable names, first match wins
TEAM_CONFIG_KEYS: dict[str, tuple[str, ...]] = {
    "team": ("USERNAME",),
    "vss_url": ("INGRESS_URL",),
    "vss_username": ("USERNAME",),
    "vss_password": ("PASSWORD",),
    "gpu_bearer_token": ("GPU_BEARER_TOKEN",),
    "cosmos_reason_url": ("COSMOS3_REASON_URL", "COSMOS_REASON_URL"),
    "cosmos_reason_model": ("COSMOS3_REASON_MODEL", "COSMOS_REASON_MODEL"),
    "cosmos_embed_url": ("COSMOS_EMBED1_URL",),
    "cosmos_embed_model": ("COSMOS_EMBED1_MODEL",),
    "yolo_url": ("YOLO_URL",),
    "canary_url": ("CANARY_1B_URL",),
    "canary_model": ("CANARY_1B_MODEL",),
    "wandb_api_key": ("WANDB_API_KEY",),
    "wandb_team": ("WANDB_TEAM",),
    "wandb_project": ("WANDB_PROJECT",),
    "s3_endpoint": ("S3_ENDPOINT",),
    "s3_access_key": ("ACCESS_KEY",),
    "s3_secret_key": ("SECRET_KEY",),
    "s3_chunks_bucket": ("S3_CHUNKS_BUCKET",),
    "s3_segments_bucket": ("S3_SEGMENTS_BUCKET",),
    "vdb_endpoint": ("VDB_ENDPOINT",),
    "vastdb_bucket": ("VASTDB_BUCKET",),
    "vdb_schema": ("VDB_SCHEMA",),
    "vdb_collection": ("VDB_COLLECTION",),
    "vdb_prompts_collection": ("VDB_PROMPTS_COLLECTION",),
    "ors_api_key": ("ORS_API_KEY", "OPENROUTESERVICE_API_KEY"),
}


def parse_env_file(text: str) -> dict[str, str]:
    """Parses a shell-style KEY=VALUE file (comments, blank lines, `export ` and quotes allowed)."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def find_team_config() -> Path | None:
    explicit = os.environ.get("TEAM_CONFIG")
    if explicit:
        return Path(explicit)
    config_dir = Path("/config")
    if not config_dir.is_dir():
        return None
    candidates = sorted(config_dir.glob("*.config"))
    return candidates[0] if len(candidates) == 1 else None


def team_config_values(path: Path | None) -> dict[str, str]:
    if path is None or not path.is_file():
        return {}
    raw = parse_env_file(path.read_text())
    mapped: dict[str, str] = {}
    for field, keys in TEAM_CONFIG_KEYS.items():
        for key in keys:
            if raw.get(key):
                mapped[field] = raw[key]
                break
    return mapped


class TeamConfigSource(PydanticBaseSettingsSource):
    """Lowest-priority source: the organisers' team config file."""

    def __init__(self, settings_cls: type[BaseSettings]) -> None:
        super().__init__(settings_cls)
        self._values = team_config_values(find_team_config())

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        return self._values.get(field_name), field_name, False

    def __call__(self) -> dict[str, Any]:
        return dict(self._values)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=SERVER_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # identity
    team: str = "team-x"

    # VSS retrieval backend (private: only reachable from the lab VM or via its tunnel)
    vss_url: str = ""
    vss_username: str = ""
    vss_password: SecretStr = SecretStr("")
    vss_verify_tls: bool = True

    # GPU model endpoints (public, bearer token)
    gpu_bearer_token: SecretStr = SecretStr("")
    cosmos_reason_url: str = ""
    cosmos_reason_model: str = ""  # discovered from /v1/models when empty
    cosmos_embed_url: str = ""
    cosmos_embed_model: str = ""
    yolo_url: str = ""
    canary_url: str = ""
    canary_model: str = "nvidia/canary-1b"

    # W&B Inference (OpenAI-compatible) + Weave tracing
    wandb_api_key: SecretStr = SecretStr("")
    wandb_team: str = ""
    wandb_project: str = ""
    llm_base_url: str = "https://api.inference.wandb.ai/v1"
    llm_model: str = "meta-llama/Llama-3.3-70B-Instruct"
    tracing: bool = True

    # S3 + VastDB (direct access; optional `vast` extra)
    s3_endpoint: str = ""
    s3_access_key: SecretStr = SecretStr("")
    s3_secret_key: SecretStr = SecretStr("")
    s3_chunks_bucket: str = ""
    s3_segments_bucket: str = ""
    vdb_endpoint: str = ""
    vastdb_bucket: str = ""
    vdb_schema: str = "vss-schema"
    vdb_collection: str = "vss-collection"
    vdb_prompts_collection: str = "vss-prompts-events"

    # RideAhead
    ors_api_key: SecretStr = SecretStr("")  # openrouteservice (bicycle routing)
    ors_base_url: str = "https://api.openrouteservice.org"
    ors_profile: str = "cycling-regular"
    rideahead_routing: Literal["auto", "fixture", "ors"] = "auto"  # auto: ors if key set
    rideahead_perception: Literal["fixture", "archive"] = "fixture"
    rideahead_fixtures: Path = SERVER_DIR / "fixtures" / "rideahead"
    rideahead_scenario: str = (
        "scenario_nyc.json"  # file in rideahead_fixtures; scenario.json = London fixture
    )
    rideahead_snapshots: bool = False  # write <data_dir>/rideahead/<session>.json on change

    # app
    analyser: Literal["auto", "stub", "cosmos"] = "auto"
    demo_key: SecretStr = SecretStr("")  # when set, /api and /ws require it
    rate_limit_per_minute: int = 240
    cors_origins: list[str] = ["http://localhost:4321", "http://127.0.0.1:4321"]
    web_dist: Path = REPO_DIR / "web" / "dist"
    data_dir: Path = SERVER_DIR / "data"
    upstream_timeout_s: float = 60.0
    max_upload_mb: int = 100

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            TeamConfigSource(settings_cls),
            file_secret_settings,
        )

    @property
    def wandb_entity_project(self) -> str:
        """`team/project` for Weave and the W&B Inference usage header."""
        if self.wandb_team and self.wandb_project:
            return f"{self.wandb_team}/{self.wandb_project}"
        return self.wandb_project or ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
