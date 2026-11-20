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
        assert e["kind"] in ("simulate", "frequencies", "pick")
        assert e["round"] in (1, 6, 11)
        assert isinstance(e["step"], int) and e["step"] >= 0
        if e["kind"] in ("simulate", "frequencies"):
            assert e["tile"] and set(e["tile"]) <= ids
            if e["kind"] == "frequencies":
                assert set(e["frequencies"]) == set(e["tile"])
                assert all(0 <= v <= 1 for v in e["frequencies"].values())
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
            elif e["kind"] == "pick" and e["source"] == "atoms":
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


# --- frequencies and removed (Requirements 10.1, 10.2, 10.3 of the ui spec) ---

from atommap.graph import build_graph  # noqa: E402
from atommap.log import DecisionLog  # noqa: E402
from atommap.loop import run_round  # noqa: E402
from atommap.model import Point, Request  # noqa: E402


def _cycle_with_leaf_request() -> Request:
    # 8-cycle (no simplicial Point) plus a separate pair leaf-mate: a rule pick, cycle untouched
    pts = [Point(f"c{i}", float(i), 0.0) for i in range(8)] + [Point("leaf", 0.0, 50.0), Point("mate", 0.0, 51.0)]
    edges = [(f"c{i}", f"c{(i + 1) % 8}") for i in range(8)] + [("leaf", "mate")]
    return Request(tuple(pts), "channel_plan", 1.0, tuple(edges), 0)


def _round_events(provider):
    req = _cycle_with_leaf_request()
    graph = build_graph(req)
    events: list = []
    sim = FakeSimulator() if provider == "atoms" else None
    res = run_round(
        graph, req.points, req.r, graph.nodes, DecisionLog("channel_plan", graph.nodes),
        1, req.seed, provider, sim, None, events.append,
    )
    return graph, events, res


def test_frequencies_event_follows_each_simulate_with_same_tile_and_unit_values():
    for competitor_events in (
        [e for e in run_with_events()[1] if e["competitor"] == c] for c in (HYBRID, ATOMS_ALONE)
    ):
        seq = [e for e in competitor_events if e["kind"] in ("simulate", "frequencies")]
        assert seq
        assert len(seq) % 2 == 0
        for sim_ev, freq_ev in zip(seq[0::2], seq[1::2]):
            assert sim_ev["kind"] == "simulate" and freq_ev["kind"] == "frequencies"
            assert freq_ev["tile"] == sim_ev["tile"]
            assert (freq_ev["round"], freq_ev["step"]) == (sim_ev["round"], sim_ev["step"])
            assert set(freq_ev["frequencies"]) == set(sim_ev["tile"])
            assert all(0.0 <= v <= 1.0 for v in freq_ev["frequencies"].values())


def test_round_emits_frequencies_right_after_simulate():
    _, events, _ = _round_events("atoms")
    kinds = [e["kind"] for e in events]
    assert "simulate" in kinds
    for i, e in enumerate(events):
        if e["kind"] == "simulate":
            nxt = events[i + 1]
            assert nxt["kind"] == "frequencies" and nxt["tile"] == e["tile"]
        if e["kind"] == "frequencies":
            assert events[i - 1]["kind"] == "simulate"


def test_no_frequencies_event_without_simulator():
    for provider in ("annealing", "none"):
        _, events, _ = _round_events(provider)
        assert not [e for e in events if e["kind"] in ("simulate", "frequencies")]


def test_every_pick_event_has_removed_list_and_rule_picks_say_rule():
    for provider in ("atoms", "annealing", "none"):
        graph, events, res = _round_events(provider)
        picks = [e for e in events if e["kind"] == "pick"]
        assert [e["picked"][0] for e in picks] == res.picks
        adj = graph.adjacency()
        gone: set = set()
        for e in picks:
            assert isinstance(e["removed"], list)
            pid = e["picked"][0]
            assert set(e["removed"]) == adj[pid] - gone - {pid}
            assert pid not in e["removed"]
            gone |= {pid} | set(e["removed"])
            assert (e["source"] == "rule") == (pid in res.rule_picks)
        assert "leaf" in res.rule_picks
        leaf = next(e for e in picks if e["picked"] == ["leaf"])
        assert leaf["source"] == "rule" and leaf["removed"] == ["mate"]


def test_api_pick_events_have_removed_for_all_competitors():
    _, events, _, _ = run_with_events()
    picks = [e for e in events if e["kind"] == "pick"]
    assert picks
    for e in picks:
        assert isinstance(e["removed"], list)
        assert e["source"] in ("rule", "atoms", "annealing", "coin flip")
