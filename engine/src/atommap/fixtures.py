"""Loader for the committed map fixtures in `fixtures/` at the repo root.

Native use only (tests, tooling). The browser gets fixtures from the UI.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

HERO = "wifi_hall_hero"
SPARSE = "wifi_hall_sparse"


def fixtures_dir() -> Path:
    # engine/src/atommap/fixtures.py -> repo root is parents[3]
    return Path(__file__).resolve().parents[3] / "fixtures"


def load_fixture(name: str) -> dict[str, Any]:
    """Return the raw fixture file content as a dict."""
    path = fixtures_dir() / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_request(name: str, mode: str = "channel_plan", seed: int = 0) -> dict[str, Any]:
    """Return a raw request dict, ready for `validate_request`."""
    data = load_fixture(name)
    return {
        "points": [dict(p) for p in data["points"]],
        "mode": mode,
        "graph": dict(data["graph"]),
        "seed": seed,
    }
