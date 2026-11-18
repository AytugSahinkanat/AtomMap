"""Round driver and Competitors (Requirements 3.1-3.9, 8.1, 8.5-8.8, 9.1)."""

from __future__ import annotations

import copy

import pytest

from atommap.competitors import (
    ANNEALING_RULES, ATOMS_ALONE, CITATION, COIN_FLIP_RULES, COMPETITORS, HYBRID,
    run_competitors,
)
from atommap.graph import build_graph
from atommap.model import CompetitorResult, Point, Request
from fake_sim import FakeSimulator
from test_loop import grid_request


def make_request(mode="channel_plan", n=8, spacing=10.0, r=15.0, seed=3) -> Request:
    pts = tuple(Point(f"p{i:02d}", (i % 4) * spacing, (i // 4) * spacing) for i in range(n))
    return Request(points=pts, mode=mode, r=r, edges=None, seed=seed)


def _edges_ok(request, picks):
    edges = build_graph(request).edges
    s = set(picks)
    return not any(a in s and b in s for a, b in edges)


@pytest.mark.parametrize("name", COMPETITORS)
def test_channel_plan_has_three_rounds_partitioning_points(name):
    # 6x6 square lattice: no simplicial Point, so atom/annealing/coin-flip steps run.
    req = grid_request(6)
    res = run_competitors(req, FakeSimulator())
    c = res.competitors[name]
    assert isinstance(c, CompetitorResult)
    assert [r.channel for r in c.rounds] == [1, 6, 11]
    all_picks = [p for r in c.rounds for p in r.picks]
    assert len(all_picks) == len(set(all_picks))  # disjoint
    for r in c.rounds:
        assert _edges_ok(req, r.picks)
    assert sorted(all_picks + c.five_ghz_only) == sorted(p.id for p in req.points)
    assert set(all_picks).isdisjoint(c.five_ghz_only)


@pytest.mark.parametrize("name", COMPETITORS)
def test_place_has_one_round_and_no_five_ghz_list(name):
    req = make_request(mode="place")
    c = run_competitors(req, FakeSimulator()).competitors[name]
    assert [r.channel for r in c.rounds] == [1]
    assert c.five_ghz_only is None
    assert _edges_ok(req, c.rounds[0].picks)


def test_empty_rounds_when_points_run_out():
    # One Point: Round 1 picks it, Rounds 6 and 11 are empty.
    req = make_request(n=1)
    c = run_competitors(req, FakeSimulator()).competitors[HYBRID]
    assert [len(r.picks) for r in c.rounds] == [1, 0, 0]
    assert c.five_ghz_only == []
    assert c.stats.picks_per_round == [1, 0, 0]


@pytest.mark.parametrize("mode,count", [("channel_plan", 3), ("place", 1)])
def test_zero_points_give_empty_rounds(mode, count):
    req = make_request(mode=mode, n=0)
    res = run_competitors(req, FakeSimulator())
    for name in COMPETITORS:
        c = res.competitors[name]
        assert len(c.rounds) == count
        assert all(r.picks == [] for r in c.rounds)
        assert c.decision_log == []
        assert c.stats.total_picks == 0
        assert c.stats.quantum_share == 0.0
        assert c.five_ghz_only == ([] if mode == "channel_plan" else None)


def test_four_competitors_with_separate_logs_and_stats():
    res = run_competitors(make_request(), FakeSimulator())
    assert list(res.competitors) == list(COMPETITORS)
    results = [res.competitors[n] for n in COMPETITORS]
    assert len({id(c.decision_log) for c in results}) == 4
    assert len({id(c.stats) for c in results}) == 4
    for c in results:
        assert c.label == "simulation"
        assert c.stats.total_picks == sum(len(r.picks) for r in c.rounds)
        assert c.stats.picks_per_round == [len(r.picks) for r in c.rounds]
    assert res.meta["citation"] == CITATION
    assert res.meta["label"] == "simulation"
    # Coin flip never uses atoms; atoms alone has gaps listed.
    assert res.competitors[COIN_FLIP_RULES].stats.quantum_picks == 0
    assert res.competitors[ANNEALING_RULES].stats.quantum_picks == 0
    assert res.competitors[ATOMS_ALONE].stats.gaps is not None
    assert res.competitors[HYBRID].stats.gaps is None
    # Log entries come only from the competitor's own run.
    assert all(e.source != "atoms" for e in res.competitors[COIN_FLIP_RULES].decision_log)


def test_failing_competitor_gets_error_entry_others_kept():
    calls = []

    def boom(ids, edges, seed):
        calls.append(1)  # set before raising, proves the provider really ran
        raise RuntimeError("annealing broke")

    # 6x6 square lattice: no simplicial Point, so the rule cannot solve it alone
    # and the provider must be consulted.
    res = run_competitors(
        grid_request(6), FakeSimulator(), providers={ANNEALING_RULES: boom}
    )
    assert calls, "the failing provider was never called"
    err = res.competitors[ANNEALING_RULES]
    assert isinstance(err, dict)
    assert err["error"] == "RuntimeError: annealing broke"
    for name in (ATOMS_ALONE, HYBRID, COIN_FLIP_RULES):
        assert isinstance(res.competitors[name], CompetitorResult)
    d = res.to_dict()
    assert "error" in d["competitors"][ANNEALING_RULES]


def test_input_is_not_mutated():
    req = make_request()
    before = copy.deepcopy(req)
    run_competitors(req, FakeSimulator())
    assert req == before
