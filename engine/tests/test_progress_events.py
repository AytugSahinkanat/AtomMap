"""Progress events (Requirement 9.9)."""

from __future__ import annotations

import json

import atommap.api as api
from atommap.competitors import ANNEALING_RULES, ATOMS_ALONE, COIN_FLIP_RULES, COMPETITORS, HYBRID
from fake_sim import FakeSimulator
from test_api import raw_grid

REQUIRED = ("competitor", "round", "step", "tile")


def run_with_events(n=4, sim=None):
    raw = raw_grid(n)
    events: list = []
    sim = sim or FakeSimulator()
    out = json.loads(api.run(json.dumps(raw), events.append, simulator=sim))
    return raw, events, out, sim


def strip_timings(v):
    if isinstance(v, dict):
        return {k: strip_timings(x) for k, x in v.items() if k != "timings"}
    if isinstance(v, list):
        return [strip_timings(x) for x in v]
    return v


def test_events_for_every_competitor_have_valid_fields():
    raw, events, out, _ = run_with_events()
    ids = {p["id"] for p in raw["points"]}
    assert out["ok"] is True
    assert {e["competitor"] for e in events} == set(COMPETITORS)
    for e in events:
        assert isinstance(e, dict) and e["type"] == "run"
        assert all(k in e for k in REQUIRED)
        assert e["kind"] in ("simulate", "pick")
        assert e["round"] in (1, 6, 11)
        assert isinstance(e["step"], int) and e["step"] >= 0
        if e["kind"] == "simulate":
            assert e["tile"] and set(e["tile"]) <= ids
        else:
            assert e["tile"] is None and len(e["picked"]) == 1
            assert set(e["picked"]) <= ids
    json.dumps(events)  # plain JSON-friendly


def test_simulate_count_matches_simulator_calls_and_no_calls_for_rule_competitors():
    _, events, _, sim = run_with_events()
    sims = [e for e in events if e["kind"] == "simulate"]
    assert {e["competitor"] for e in sims} <= {HYBRID, ATOMS_ALONE}
    assert not [e for e in sims if e["competitor"] in (ANNEALING_RULES, COIN_FLIP_RULES)]
    assert len(sims) == sim.calls


def test_pick_events_equal_picks_in_result():
    _, events, out, _ = run_with_events()
    for name, c in out["result"]["competitors"].items():
        n = sum(len(r["picks"]) for r in c["rounds"])
        got = [e for e in events if e["kind"] == "pick" and e["competitor"] == name]
        assert len(got) == n
        assert sorted(e["picked"][0] for e in got) == sorted(
            p for r in c["rounds"] for p in r["picks"]
        )


def test_simulate_comes_before_the_pick_it_informs():
    _, events, _, _ = run_with_events()
    for name in (HYBRID, ATOMS_ALONE):
        seen_sim: set = set()
        for e in (x for x in events if x["competitor"] == name):
            if e["kind"] == "simulate":
                seen_sim.update(e["tile"])
            elif e["source"] == "atoms":
                assert e["picked"][0] in seen_sim


def test_results_identical_with_and_without_emit():
    raw = raw_grid(4)
    plain = json.loads(api.run(json.dumps(raw), None, simulator=FakeSimulator()))
    seen: list = []
    with_emit = json.loads(api.run(json.dumps(raw), seen.append, simulator=FakeSimulator()))
    assert seen
    assert strip_timings(plain) == strip_timings(with_emit)


def test_raising_emit_gives_error_and_no_result():
    def boom(event):
        raise RuntimeError("emit broke")

    out = json.loads(api.run(json.dumps(raw_grid(3)), boom, simulator=FakeSimulator()))
    assert out["ok"] is False and "result" not in out
    assert out["error"]["type"] == "RuntimeError"
    assert "emit broke" in out["error"]["message"]
