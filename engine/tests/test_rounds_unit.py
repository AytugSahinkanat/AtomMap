"""Rounds unit tests (Requirements 2.9, 3.1, 3.2, 3.9, 8.7, 10.2, 10.3)."""

from __future__ import annotations

import pytest

from atommap.competitors import (
    ANNEALING_RULES, ATOMS_ALONE, COIN_FLIP_RULES, COMPETITORS, HYBRID,
    run_competitors,
)
from atommap.model import Point, Request
from fake_sim import FakeSimulator
from test_loop import grid_request


def path_request(mode="channel_plan", n=6) -> Request:
    # Points 10 apart with r=15: only neighbours conflict, so the graph is a path
    # and the simplicial rule solves it without atoms.
    pts = tuple(Point(f"p{i:02d}", i * 10.0, 0.0) for i in range(n))
    return Request(points=pts, mode=mode, r=15.0, edges=None, seed=1)


@pytest.mark.parametrize(
    "mode,channels,five",
    [("channel_plan", [1, 6, 11], []), ("place", [1], None)],
)
def test_zero_points_rounds_channels_and_five_ghz(mode, channels, five):
    res = run_competitors(path_request(mode=mode, n=0), FakeSimulator())
    assert list(res.competitors) == list(COMPETITORS)
    for name in COMPETITORS:
        c = res.competitors[name]
        assert [r.channel for r in c.rounds] == channels
        assert all(r.picks == [] for r in c.rounds)
        assert c.five_ghz_only == five


@pytest.mark.parametrize("mode", ["channel_plan", "place"])
def test_zero_points_quantum_share_zero_with_flag(mode):
    res = run_competitors(path_request(mode=mode, n=0), FakeSimulator())
    for name in COMPETITORS:
        s = res.competitors[name].stats
        assert s.quantum_picks == 0
        assert s.quantum_share == 0
        assert s.atoms_not_needed is True


@pytest.mark.parametrize("mode", ["channel_plan", "place"])
def test_hybrid_solved_by_rules_has_zero_quantum_share_with_flag(mode):
    res = run_competitors(path_request(mode=mode), FakeSimulator())
    s = res.competitors[HYBRID].stats
    assert s.total_picks > 0
    assert s.quantum_picks == 0
    assert s.quantum_share == 0
    assert s.atoms_not_needed is True


class AlwaysFailingSimulator:
    def __init__(self):
        self.calls = 0

    def run_tile(self, positions_um, seed):
        self.calls += 1
        raise RuntimeError("simulator down")


def test_all_tiles_fail_flag_is_false():
    sim = AlwaysFailingSimulator()
    res = run_competitors(grid_request(6), sim, names=(HYBRID,))
    s = res.competitors[HYBRID].stats
    assert sim.calls > 0
    assert s.quantum_picks == 0
    assert s.skipped_tiles > 0
    assert s.atoms_not_needed is False


def test_no_simulator_call_flag_is_true():
    sim = FakeSimulator()
    res = run_competitors(path_request(), sim, names=(HYBRID,))
    s = res.competitors[HYBRID].stats
    assert sim.calls == 0
    assert s.atoms_not_needed is True


def test_hybrid_with_quantum_picks_flag_is_false():
    res = run_competitors(grid_request(6), FakeSimulator(), names=(HYBRID,))
    s = res.competitors[HYBRID].stats
    assert s.quantum_picks > 0
    assert s.atoms_not_needed is False


@pytest.mark.parametrize("req", [path_request(), grid_request(6)])
def test_annealing_and_coin_flip_never_count_quantum(req):
    res = run_competitors(req, FakeSimulator())
    for name in (ANNEALING_RULES, COIN_FLIP_RULES):
        s = res.competitors[name].stats
        assert s.quantum_picks == 0
        assert s.quantum_share == 0
        assert s.atoms_not_needed is True


def test_logs_are_separate_and_sources_match_the_competitor():
    res = run_competitors(grid_request(6), FakeSimulator())
    logs = {n: res.competitors[n].decision_log for n in COMPETITORS}
    assert len({id(v) for v in logs.values()}) == 4
    entry_ids = [id(e) for v in logs.values() for e in v]
    assert len(entry_ids) == len(set(entry_ids))  # no entry shared between logs
    for name in (ANNEALING_RULES, COIN_FLIP_RULES):
        assert all(e.source != "atoms" for e in logs[name])
    assert all(e.source != "rule" for e in logs[ATOMS_ALONE])
    assert all(e.source != "annealing" for e in logs[COIN_FLIP_RULES])
    assert all(e.source != "coin flip" for e in logs[ANNEALING_RULES])
    assert all(e.source != "coin flip" for e in logs[HYBRID])
