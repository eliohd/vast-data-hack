"""Direct VastDB access (optional `vast` extra: `uv sync --extra vast`).

Read the index (vss-collection) or keep our own tables (e.g. schema `hackathon`) next to it.
Connect to the data VIP (S3_ENDPOINT). Never drop or recreate vss-collection / vss-prompts-events.
The SDK is synchronous: call these from `asyncio.to_thread(...)` inside request handlers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.config import Settings

# Vector columns are huge; never select them by accident.
VECTOR_COLUMNS = {"vectors", "vectors_visual"}


def _endpoint(url: str) -> str:
    return url if url.startswith(("http://", "https://")) else f"http://{url}"


def column_names(table: Any) -> list[str]:
    """`table.columns` is a property or a method depending on SDK version (as in the skill)."""
    cols: Any = table.columns
    if callable(cols):
        cols = cols()
    return [c.name if hasattr(c, "name") else str(c) for c in cols]


def connect(settings: Settings) -> Any:
    try:
        import vastdb  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError("VastDB SDK missing: run `uv sync --extra vast`") from exc
    return vastdb.connect(
        endpoint=_endpoint(settings.s3_endpoint),
        access=settings.s3_access_key.get_secret_value(),
        secret=settings.s3_secret_key.get_secret_value(),
        ssl_verify=False,
    )


def read_collection(settings: Settings, limit: int = 100) -> list[dict[str, Any]]:
    """Returns up to `limit` rows of the search index without vector columns."""
    session = connect(settings)
    with session.transaction() as tx:
        table = (
            tx.bucket(settings.vastdb_bucket)
            .schema(settings.vdb_schema)
            .table(settings.vdb_collection)
        )
        columns = [c for c in column_names(table) if c not in VECTOR_COLUMNS]
        reader = table.select(columns=columns)
        rows: list[dict[str, Any]] = []
        for batch in reader:
            rows.extend(batch.to_pylist())
            if len(rows) >= limit:
                break
        return rows[:limit]
