"""D-owned full runtime story using a cost-consistent synthetic demo prior."""

from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.agent.models import SessionConfig
from app.main import create_app
from tests.test_api import make_settings


def test_integrated_runtime_observed_stale_cleared_and_replay(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = make_settings(
        tmp_path,
        ors_api_key=SecretStr(""),
        rideahead_routing="fixture",
        rideahead_scenario="scenario.json",  # A: pinned when the default moved to NYC
    )
    app = create_app(settings)
    with TestClient(app) as client:
        runtime = app.state.services.rideahead
        original_config = runtime.default_config

        def demo_config() -> SessionConfig:
            config = original_config()
            config.hazard_types["lane_blocked"].expected_delay_s = 180
            return config

        monkeypatch.setattr(runtime, "default_config", demo_config)
        snapshot = client.post("/api/rideahead/sessions", json={}).json()
        sid = snapshot["session_id"]

        def advance(when: int) -> dict:
            response = client.post(f"/api/rideahead/sessions/{sid}/advance", json={"to_s": when})
            assert response.status_code == 200
            return response.json()

        observed = advance(60)
        assert observed["hazards"][0]["state"] == "observed"
        assert observed["decisions"][0]["action"] == "reroute"
        assert observed["decisions"][0]["evidence_ids"] == ["ev-fx-001"]
        assert advance(70)["hazards"][0]["last_supported_s"] == 60
        stale = advance(330)
        assert stale["hazards"][0]["state"] == "stale"
        assert stale["decisions"][0]["action"] == "heads_up"
        cleared = advance(450)
        assert cleared["hazards"][0]["state"] == "cleared"
        assert cleared["decisions"][0]["action"] == "continue"
        replayed = advance(60)
        assert replayed["hazards"] == observed["hazards"]
        assert replayed["observations"] == observed["observations"]
        assert replayed["riders"] == observed["riders"]
