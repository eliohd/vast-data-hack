from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app


def make_settings(tmp_path, **overrides) -> Settings:  # type: ignore[no-untyped-def]
    base = {
        "tracing": False,
        "analyser": "stub",
        "vss_url": "",
        "cosmos_reason_url": "",
        "cosmos_embed_url": "",
        "yolo_url": "",
        "canary_url": "",
        "wandb_api_key": SecretStr(""),
        "web_dist": tmp_path / "no-dist",
        "data_dir": tmp_path / "data",
        "rideahead_perception": "fixture",
    }
    return Settings(**{**base, **overrides})


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:  # type: ignore[no-untyped-def]
    with TestClient(create_app(make_settings(tmp_path))) as test_client:
        yield test_client


def test_health(client: TestClient) -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["analyser"] == "stub"


def test_upstreams_report_unconfigured(client: TestClient) -> None:
    res = client.get("/api/health/upstreams")
    assert res.status_code == 200
    report = {u["name"]: u for u in res.json()["upstreams"]}
    assert set(report) == {"vss", "cosmos_reason", "cosmos_embed", "yolo", "canary", "wandb"}
    assert not any(u["configured"] for u in report.values())


def test_live_socket_round_trip(client: TestClient) -> None:
    with client.websocket_connect("/ws/live") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["analyser"] == "stub"

        ws.send_json({"type": "ping", "sentAt": 42})
        assert ws.receive_json() == {"type": "pong", "sentAt": 42}

        ws.send_json(
            {
                "type": "frame",
                "seq": 1,
                "capturedAt": 1000,
                "image": "data:image/jpeg;base64,AAEC",
                "width": 64,
                "height": 48,
            }
        )
        result = ws.receive_json()
        assert result["type"] == "result"
        assert result["seq"] == 1
        assert result["capturedAt"] == 1000

        ws.send_text("not json")
        assert ws.receive_json()["type"] == "error"


def test_clip_upload_saves_file(client: TestClient, tmp_path) -> None:  # type: ignore[no-untyped-def]
    res = client.post(
        "/api/clips",
        files={"file": ("demo clip.mp4", b"fake-mp4", "video/mp4")},
        data={"ingest": "false"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ingested"] is False
    assert (tmp_path / "data" / "clips" / body["filename"]).read_bytes() == b"fake-mp4"


def test_clip_upload_rejects_unknown_type(client: TestClient) -> None:
    res = client.post("/api/clips", files={"file": ("notes.txt", b"x", "text/plain")})
    assert res.status_code == 400


def test_demo_key_guards_api(tmp_path) -> None:  # type: ignore[no-untyped-def]
    settings = make_settings(tmp_path, demo_key=SecretStr("s3cret"))
    with TestClient(create_app(settings)) as guarded:
        assert guarded.get("/api/health").status_code == 200  # health stays open
        assert guarded.get("/api/clips").status_code == 401
        assert guarded.get("/api/clips", headers={"x-demo-key": "s3cret"}).status_code == 200
