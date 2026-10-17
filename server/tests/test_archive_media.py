from app.api.archive import media_type

SRC = "s3://team-46-vss-chunks-segments/segments/x_segment_001_of_006.mp4"


def test_octet_stream_mp4_becomes_video_mp4() -> None:
    assert media_type(SRC, "binary/octet-stream") == "video/mp4"
    assert media_type(SRC, "application/octet-stream") == "video/mp4"
    assert media_type(SRC, None) == "video/mp4"


def test_specific_upstream_type_is_kept() -> None:
    assert media_type(SRC, "video/mp4") == "video/mp4"
    assert media_type("clip.bin", "binary/octet-stream") == "binary/octet-stream"
