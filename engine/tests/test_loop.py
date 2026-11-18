"""Tests for one Round of the loop (Requirements 4.1, 4.3, 4.4, 7.1 to 7.6, 8.4)."""

from __future__ import annotations

import pytest

from atommap.fixtures import HERO, load_request
from atommap.graph import build_graph
from atommap.log import DecisionLog
from atommap.loop import run_round, top_group_size
from atommap.model import Point, Request, validate_request
from atommap.physics import blockade_radius_m
from atommap.simulator import FrequencyCache
from fake_sim import FakeSimulator


def grid_request(n: int = 5, seed: int = 3) -> Request:
    """n*n square lattice. It has no simplicial Point, so the atoms/annealing steps run."""
    r = blockade_radius_m()
    step = 0.8 * r  # grid neighbours conflict, diagonals (1.13 r) do not: no triangles
    pts = tuple(
        Point(f"p{i * n + j:02d}", i * step, j * step) for i in range(n) for j in range(n)
    )
    return Request(pts, "channel_plan", r, None, seed)


def cycle_request(n: int = 8) -> Request:
    pts = tuple(Point(f"c{i}", float(i), 0.0) for i in range(n))
    edges = tuple((f"c{i}", f"c{(i + 1) % n}") for i in range(n))
    return Request(pts, "channel_plan", 1.0, edges, 0)


def run(req: Request, provider, sim=None, round=1, cache=None, available=None):
    graph = build_graph(req)
    log = DecisionLog("channel_plan", graph.nodes)
    res = run_round(
        graph, req.points, req.r, graph.nodes if available is None else available,
        log, round, req.seed, provider, sim, cache,
    )
    return graph, log, res


def check_mis(graph, picks, available):
    picked = set(picks)
    assert len(picked) == len(picks)
    for a, b in graph.edges:
        assert not (a in picked and b in picked)
    adj = graph.adjacency()
    for p in available:
        assert p in picked or adj[p] & picked


@pytest.mark.parametrize("provider", ["atoms", "annealing", "none"])
def test_round_is_independent_and_maximal(provider):
    req = grid_request()
    sim = FakeSimulator() if provider == "atoms" else None
    graph, log, res = run(req, provider, sim)
    check_mis(graph, res.picks, graph.nodes)
    assert set(res.picks) == set(res.rule_picks) | {s.pick for s in res.steps}


@pytest.mark.parametrize("provider,source", [("atoms", "atoms"), ("annealing", "annealing"), ("none", "coin flip")])
def test_one_pick_per_step(provider, source):
    req = grid_request()
    sim = FakeSimulator() if provider == "atoms" else None
    graph, log, res = run(req, provider, sim)
    non_rule = [e for e in log if e.action == "pick" and e.source != "rule"]
    assert len(non_rule) == len(res.steps)
    assert all(len(e.points) == 1 for e in non_rule)
    assert all(e.source == source for e in non_rule)
    rule = [e for e in log if e.action == "pick" and e.source == "rule"]
    assert [e.points[0] for e in rule] == res.rule_picks
    assert all(e.rule == "simplicial" for e in rule)


def test_available_subset_and_not_modified():
    req = grid_request()
    graph = build_graph(req)
    avail = set(graph.nodes[:15])
    snapshot = set(avail)
    graph, log, res = run(req, "none", available=avail)
    assert avail == snapshot
    assert set(res.picks) <= snapshot
    adj = graph.adjacency()
    for p in snapshot:
        assert p in res.picks or adj[p] & set(res.picks)
    for a, b in graph.edges:
        assert not (a in res.picks and b in res.picks)


def test_deterministic_same_seed():
    req = grid_request()
    out = []
    for _ in range(2):
        _, log, res = run(req, "atoms", FakeSimulator())
        out.append((res.picks, log.to_list(), [s.source for s in res.steps]))
    assert out[0] == out[1]
    _, _, a = run(req, "none")
    _, _, b = run(req, "none")
    assert a.picks == b.picks


def test_top_group_size():
    assert [top_group_size(n) for n in (1, 2, 3, 5, 8, 10, 70)] == [1, 1, 1, 2, 3, 4, 28]


def test_pick_comes_from_top_40_percent():
    req = cycle_request(8)  # no simplicial Point, so the first step ranks all 8

    def stub(ids, edges, seed):
        return {i: float(int(i[1:]) % 4) for i in ids}  # ties across Points

    graph, log, res = run(req, stub)
    first = res.steps[0]
    assert first.remaining == 8 and first.top_group == 3
    ranked = sorted(graph.nodes, key=lambda i: (-(int(i[1:]) % 4), i))
    assert first.pick in ranked[:3]
    for s in res.steps:
        assert s.top_group == max(1, round(0.4 * s.remaining))
    check_mis(graph, res.picks, graph.nodes)


def test_coin_flip_can_pick_any_point():
    req = cycle_request(8)
    firsts = set()
    for seed in range(40):
        r2 = Request(req.points, req.mode, req.r, req.edges, seed)
        _, _, res = run(r2, "none")
        assert res.steps[0].top_group == 8
        firsts.add(res.steps[0].pick)
    assert len(firsts) > 3


class AlwaysFails:
    def __init__(self):
        self.calls = 0

    def run_tile(self, positions_um, seed):
        self.calls += 1
        raise RuntimeError("boom")


def test_failing_tiles_are_skipped_and_use_annealing():
    req = grid_request()
    sim = AlwaysFails()
    graph, log, res = run(req, "atoms", sim)
    skips = [e for e in log if e.action == "skip"]
    assert skips and len(skips) == res.skipped_tiles
    assert all(e.message == "boom" and e.round == 1 and e.source == "atoms" for e in skips)
    assert sim.calls > 0
    assert res.atom_picks == 0
    assert all(s.source == "annealing" and not s.atom_informed for s in res.steps)
    assert all(e.source == "annealing" for e in log if e.action == "pick" and e.source != "rule")
    check_mis(graph, res.picks, graph.nodes)


def test_one_failing_tile_marks_only_that_step():
    req = grid_request(6)
    probe = FakeSimulator()
    run(req, "atoms", probe)
    failing = FakeSimulator(fail_seeds=[probe.seeds_seen[0]])
    graph, log, res = run(req, "atoms", failing)
    assert res.skipped_tiles >= 1
    assert sum(s.skipped_tiles for s in res.steps) == res.skipped_tiles
    for s in res.steps:
        if s.source == "annealing":
            assert s.skipped_tiles > 0 and not s.atom_informed
        else:
            assert s.source == "atoms" and s.atom_informed
    check_mis(graph, res.picks, graph.nodes)


def test_non_simulator_errors_propagate():
    req = grid_request()
    with pytest.raises(ValueError):
        run(req, "atoms", None)

    def bad(ids, edges, seed):
        raise KeyError("not a simulator error")

    with pytest.raises(KeyError):
        run(cycle_request(8), bad)


def test_cache_hits_on_multi_step_run():
    req = grid_request(6)
    cache = FrequencyCache()
    sim = FakeSimulator()
    _, _, res = run(req, "atoms", sim, cache=cache)
    assert len(res.steps) > 1
    assert res.cache_hits > 0
    assert res.simulator_calls == sim.calls


def test_hero_integration_with_fake_simulator():
    req = validate_request(load_request(HERO, seed=1))
    sim = FakeSimulator()
    graph = build_graph(req)
    log = DecisionLog("channel_plan", graph.nodes)
    res = run_round(graph, req.points, req.r, graph.nodes, log, 1, req.seed, "atoms", sim)
    check_mis(graph, res.picks, graph.nodes)
    assert len(res.steps) >= 1
    assert 0 <= res.atom_picks <= len(res.picks)
    assert res.timings["total"] >= 0
    assert res.splits >= 0 and res.layout_fallbacks >= 0
    assert all(e.round == 1 for e in log)
