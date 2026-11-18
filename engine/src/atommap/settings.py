"""Loader for the committed test settings file (seeds, map sizes, run counts).

The loader takes no override arguments. A missing file, section or value
aborts with SettingsError naming what is missing (Requirement 12.7).
"""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "tests" / "test_settings.json"

REQUIRED: dict[str, tuple[str, ...]] = {
    "seeds": ("hero", "sparse", "determinism", "property"),
    "map_sizes": (
        "hero_points",
        "hero_columns",
        "hero_rows",
        "sparse_points",
        "max_tile_points",
    ),
    "run_counts": (
        "determinism_runs",
        "hypothesis_examples",
        "slow_hypothesis_examples",
        "hero_runs",
    ),
}


class SettingsError(Exception):
    """A required test setting is missing or invalid."""


def load_settings(path: Path | str | None = None) -> dict[str, dict[str, int]]:
    """Read the settings file and check every required value is an integer.

    `path` only selects which committed file to read (used by tests of the
    loader itself). Values cannot be overridden.
    """
    file = Path(path) if path is not None else DEFAULT_PATH
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SettingsError(f"test settings file not found: {file}") from None
    except json.JSONDecodeError as exc:
        raise SettingsError(f"test settings file is not valid JSON: {exc}") from None

    if not isinstance(data, dict):
        raise SettingsError("test settings file must contain a JSON object")

    missing: list[str] = []
    invalid: list[str] = []
    for section, keys in REQUIRED.items():
        values = data.get(section)
        if not isinstance(values, dict):
            missing.extend(f"{section}.{key}" for key in keys)
            continue
        for key in keys:
            if key not in values:
                missing.append(f"{section}.{key}")
            elif isinstance(values[key], bool) or not isinstance(values[key], int):
                invalid.append(f"{section}.{key}")

    if missing:
        raise SettingsError("missing test setting(s): " + ", ".join(missing))
    if invalid:
        raise SettingsError("test setting(s) must be integers: " + ", ".join(invalid))

    return {section: {k: data[section][k] for k in keys} for section, keys in REQUIRED.items()}
