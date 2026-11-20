"""Property 3: Progress events do not change the result.

**Validates: Requirements 10.4 (ui spec)**

For any valid request, `api.run(req, emit=None)` and `api.run(req, emit=collector)`
return the same text. Only `stats.timings` (wall-clock seconds) is stripped
before comparing; every other field is compared.
"""

from __future__ import annotations

import json

from hypothesis import HealthCheck, given, settings

import atommap.api as api
from fake_sim import FakeSimulator
from test_prop_rounds import requests

SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


def raw_request(req) -> dict:
    graph = {"r": req.r}
    if req.edges is not None:
        graph["edges"] = [list(e) for e in req.edges]
    return {
        "points": [{"id": p.id, "x": p.x, "y": p.y} for p in req.points],
        "mode": req.mode,
        "graph": graph,
        "seed": req.seed,
    }


def strip_timings(v):
    if isinstance(v, dict):
        return {k: strip_timings(x) for k, x in v.items() if k != "timings"}
    if isinstance(v, list):
        return [strip_timings(x) for x in v]
    return v


def canonical(text: str) -> str:
    return json.dumps(strip_timings(json.loads(text)), sort_keys=True)


# Feature: ui, Property 3: Progress events do not change the result
@SETTINGS
@given(req=requests())
def test_progress_events_do_not_change_the_result(req):
    text = json.dumps(raw_request(req))
    events: list = []
    plain = api.run(text, emit=None, simulator=FakeSimulator())
    with_emit = api.run(text, emit=events.append, simulator=FakeSimulator())
    assert json.loads(plain)["ok"] is True
    assert events
    assert canonical(plain) == canonical(with_emit)
