from app.agent.analyser import boxes_from_model
from app.config import TEAM_CONFIG_KEYS, parse_env_file, team_config_values
from app.core.parsing import extract_json, strip_reasoning
from app.core.protocol import ClientFrame, ServerResult, client_message_adapter
from app.core.ratelimit import SlidingWindowLimiter


class TestExtractJson:
    def test_plain_object(self) -> None:
        assert extract_json('{"a": 1}') == {"a": 1}

    def test_fenced_block(self) -> None:
        assert extract_json('Sure!\n```json\n{"a": 2}\n```\nDone') == {"a": 2}

    def test_object_inside_prose(self) -> None:
        assert extract_json('The answer is {"summary": "ok"} as requested.') == {"summary": "ok"}

    def test_reasoning_is_stripped(self) -> None:
        assert extract_json('<think>{"wrong": true}</think>{"right": true}') == {"right": True}

    def test_no_json(self) -> None:
        assert extract_json("no json here") is None
        assert extract_json("") is None

    def test_arrays_are_not_objects(self) -> None:
        assert extract_json("[1, 2]") is None


def test_strip_reasoning() -> None:
    assert strip_reasoning("<think>hmm</think>  Answer") == "Answer"


class TestRateLimiter:
    def test_blocks_after_limit_within_window(self) -> None:
        limiter = SlidingWindowLimiter(limit=2, window_s=10)
        assert limiter.allow("a", now=0)
        assert limiter.allow("a", now=1)
        assert not limiter.allow("a", now=2)
        assert limiter.allow("b", now=2)

    def test_window_slides(self) -> None:
        limiter = SlidingWindowLimiter(limit=1, window_s=10)
        assert limiter.allow("a", now=0)
        assert not limiter.allow("a", now=9.9)
        assert limiter.allow("a", now=10)

    def test_zero_limit_disables(self) -> None:
        limiter = SlidingWindowLimiter(limit=0)
        assert all(limiter.allow("a", now=0) for _ in range(100))


class TestProtocol:
    def test_frame_parses_camel_case(self) -> None:
        message = client_message_adapter.validate_json(
            '{"type":"frame","seq":3,"capturedAt":1700,"image":"data:image/jpeg;base64,AAEC",'
            '"width":640,"height":480}'
        )
        assert isinstance(message, ClientFrame)
        assert message.captured_at == 1700
        assert message.jpeg_bytes() == b"\x00\x01\x02"

    def test_result_dumps_camel_case(self) -> None:
        dumped = ServerResult(seq=1, captured_at=5, processing_ms=12, summary="hi").dump()
        assert dumped["type"] == "result"
        assert dumped["capturedAt"] == 5
        assert dumped["processingMs"] == 12


def test_boxes_from_model_drops_malformed() -> None:
    boxes = boxes_from_model(
        [
            {"label": "bag", "box": [0.1, 0.2, 0.3, 0.4]},
            {"label": "bad", "box": [0.1, 0.2]},
            {"label": "empty", "box": [0.1, 0.2, 0, 0.4]},
            {"label": "clamped", "box": [-1, 2, 0.5, 0.5]},
            "nonsense",
        ]
    )
    assert [b.label for b in boxes] == ["bag", "clamped"]
    assert (boxes[1].x, boxes[1].y) == (0.0, 1.0)


class TestTeamConfig:
    def test_parse_env_file(self) -> None:
        text = "# comment\nexport A=1\nB='two'\nC=\"three\"\n\nbad line\nD=x=y\n"
        assert parse_env_file(text) == {"A": "1", "B": "two", "C": "three", "D": "x=y"}

    def test_maps_organiser_names(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        path = tmp_path / "team-7.config"
        path.write_text(
            "USERNAME=team-7\nPASSWORD=secret\nINGRESS_URL=https://vss\n"
            "COSMOS3_REASON_URL=http://gpu:8001\nWANDB_TEAM=vastdata\n"
        )
        values = team_config_values(path)
        assert values["vss_username"] == "team-7"
        assert values["team"] == "team-7"
        assert values["vss_password"] == "secret"
        assert values["vss_url"] == "https://vss"
        assert values["cosmos_reason_url"] == "http://gpu:8001"
        assert values["wandb_team"] == "vastdata"

    def test_every_mapping_targets_a_settings_field(self) -> None:
        from app.config import Settings

        assert set(TEAM_CONFIG_KEYS) <= set(Settings.model_fields)


class TestRideWarning:
    def test_valid_warning_passes_through(self) -> None:
        from app.agent.ride_live import normalise_ride_warning

        w = normalise_ride_warning(
            {"hazard": "lane_blocked", "advice": "slow", "message": "Van ahead", "confidence": 0.8}
        )
        assert (w["hazard"], w["advice"], w["message"]) == ("lane_blocked", "slow", "Van ahead")

    def test_unknown_or_unsure_means_continue(self) -> None:
        from app.agent.ride_live import normalise_ride_warning

        assert (
            normalise_ride_warning({"hazard": "dragon", "advice": "slow"})["advice"] == "continue"
        )
        low = normalise_ride_warning({"hazard": "pedestrian", "advice": "slow", "confidence": 0.1})
        assert (low["hazard"], low["advice"]) == ("none", "continue")
        assert normalise_ride_warning(None)["message"] == "All clear"

    def test_unknown_advice_on_real_hazard_is_heads_up(self) -> None:
        from app.agent.ride_live import normalise_ride_warning

        w = normalise_ride_warning({"hazard": "work_zone", "advice": "panic", "confidence": 0.9})
        assert w["advice"] == "heads_up"
        assert w["message"] == "Work zone"
