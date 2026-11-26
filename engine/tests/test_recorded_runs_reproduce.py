"""The recorded Tutor runs still reproduce from the native Engine (experience spec, Requirement 17.7).

`web/test-data/tutor/*.json` were recorded by `scripts/record_tutor_runs.py` with the real
Braket simulator, before the `shots` event and the lab settings existed. Running the same
requests again, without `settings`, must give the same result and the same events. The
only new events are the `shots` events: with those taken out, the event stream must equal
the recording exactly. This shows that the Engine changes of the experience spec added
data and moved nothing.

Slow: it calls the real simulator. Run with `pytest -m slow tests/test_recorded_runs_reproduce.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import atommap.api as api

RECORDED = Path(__file__).resolve().parents[2] / "web" / "test-data" / "tutor"
NAMES = ["hero_seed1", "sparse_seed1", "rules_only", "place_rules_only"]


def strip_timings(v):
    if isinstance(v, dict):
        return {k: strip_timings(x) for k, x in v.items() if k != "timings"}
    if isinstance(v, list):
        return [strip_timings(x) for x in v]
    return v


@pytest.mark.slow
@pytest.mark.parametrize("name", NAMES)
def test_recorded_run_reproduces_without_settings(name):
    path = RECORDED / f"{name}.json"
    if not path.exists():
        pytest.skip(f"{path.name} is missing")
    rec = json.loads(path.read_text(encoding="utf-8"))
    assert "settings" not in rec["request"]
    events: list = []
    out = json.loads(api.run(json.dumps(rec["request"]), emit=events.append))
    assert out["ok"] is True
    assert strip_timings(out["result"]) == strip_timings(rec["result"])
    without_shots = [e for e in events if e["kind"] != "shots"]
    assert without_shots == rec["events"]
    # The new events are there: one per frequencies event.
    kinds = [e["kind"] for e in events]
    assert kinds.count("shots") == kinds.count("frequencies")
