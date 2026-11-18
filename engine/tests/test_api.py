"""Tests for api.run (Requirements 2.1, 4.6, 4.7, 7.6, 9.5, 9.6, 10.4 to 10.6)."""

from __future__ import annotations

import json

import atommap
import atommap.api as api
from atommap.competitors import CITATION, COMPETITORS
from atommap.fixtures import HERO, load_request
from atommap.model import CompetitorResult, Result
from fake_sim import FakeSimulator
from test_loop import grid_request

SPEED_WORDS = ("faster", "speedup", "speed-up", "speed up", "advantage", "quicker")


def raw_grid(n: int = 4) -> dict:
    req = grid_request(n)
    return {
        "points": [{"id": p.id, "x": p.x, "y": p.y} for p in req.points],
        "mode": req.mode,
        "graph": {"r": req.r},
        "seed": req.seed,
    }


def go(raw, sim=None, emit=None) -> dict:
    text = api.run(json.dumps(raw), emit, simulator=sim or FakeSimulator())
    return json.loads(text)


def test_success_shape_label_citation_all_competitors():
    out = go(raw_grid())
    assert out["ok"] is True
    res = out["result"]
    assert res["meta"]["citation"] == CITATION
    assert res["meta"]["label"] == "simulation"
    assert set(res["competitors"]) == set(COMPETITORS)
    for c in res["competitors"].values():
        assert c["label"] == "simulation"


def test_hero_fixture_runs():
    raw = load_request(HERO, "channel_plan", 0)
    out = go(raw)
    assert out["ok"] is True
    assert set(out["result"]["competitors"]) == set(COMPETITORS)


def test_output_is_standard_json_without_nan():
    text = api.run(json.dumps(raw_grid()), None, simulator=FakeSimulator())
    json.loads(text, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))


def test_invalid_request_names_items_and_has_no_result():
    raw = raw_grid(2)
    raw["points"][1]["id"] = raw["points"][0]["id"]
    out = go(raw)
    assert out["ok"] is False and "result" not in out
    assert out["error"]["type"] == "ValidationError"
    assert raw["points"][0]["id"] in out["error"]["message"]

    out = go({"points": [], "mode": "place"})
    assert out["ok"] is False
    for item in ("graph", "seed"):
        assert item in out["error"]["message"]


def test_bad_json_text():
    out = json.loads(api.run("{not json", None, simulator=FakeSimulator()))
    assert out["ok"] is False and out["error"]["type"] == "ValidationError"


def test_unserializable_field_is_named(monkeypatch):
    real = api.run_competitors

    def patched(request, simulator):
        res = real(request, simulator)
        c = res.competitors["Hybrid"]
        assert isinstance(c, CompetitorResult)
        c.stats.timings["total"] = float("nan")
        return res

    monkeypatch.setattr(api, "run_competitors", patched)
    out = go(raw_grid(3))
    assert out["ok"] is False and "result" not in out
    assert "result.competitors.Hybrid.stats.timings.total" in out["error"]["message"]


def test_non_json_type_is_named(monkeypatch):
    monkeypatch.setattr(
        api, "run_competitors",
        lambda request, simulator: Result(meta={"citation": CITATION, "label": {1, 2}}, competitors={}),
    )
    out = go(raw_grid(2))
    assert out["ok"] is False
    assert "result.meta.label" in out["error"]["message"]


def test_other_exception_gives_type_and_message_no_partial(monkeypatch):
    def boom(request, simulator):
        raise KeyError("kaboom")

    monkeypatch.setattr(api, "run_competitors", boom)
    out = go(raw_grid(2))
    assert out["ok"] is False and "result" not in out
    assert out["error"]["type"] == "KeyError"
    assert "kaboom" in out["error"]["message"]


def test_emit_none_and_callable_both_work():
    seen: list = []
    assert go(raw_grid(3), emit=seen.append)["ok"] is True
    assert go(raw_grid(3), emit=None)["ok"] is True


def test_no_speed_claims_anywhere():
    out = go(raw_grid())

    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                yield str(k)
                yield from walk(x)
        elif isinstance(v, list):
            for x in v:
                yield from walk(x)
        elif isinstance(v, str):
            yield v

    for s in walk(out):
        low = s.lower()
        assert not any(w in low for w in SPEED_WORDS), s


def test_package_docs_carry_citation():
    assert "doi:10.1103/nh3b-1wv5" in atommap.__doc__
    assert "Phys. Rev. Research 8, 033296" in atommap.__doc__
