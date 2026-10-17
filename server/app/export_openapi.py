"""Writes server/openapi.json — the contract web/ generates its TypeScript types from.

uv run python -m app.export_openapi      (or `make gen-api` from the repo root)
"""

from __future__ import annotations

import json

from app.config import SERVER_DIR, Settings
from app.main import create_app


def main() -> None:
    app = create_app(Settings(tracing=False))
    path = SERVER_DIR / "openapi.json"
    path.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
