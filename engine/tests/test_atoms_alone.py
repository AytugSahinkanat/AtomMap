"""Unit tests for Atoms_Alone (Requirements 8.2, 8.3)."""

from __future__ import annotations

import math

from fake_sim import FakeSimulator

from atommap.atoms_alone import LABEL, run_atoms_alone
from atommap.layout import layout_tile
from atommap.log import DecisionLog
from atommap.model import Point
from atommap.simulator import tile_seed
from atommap.tiles import build_tiles

R = 12.0


def make(n: int = 25):
    pts = [Point(f"p{i:02d}", (i % 5) * 10.0, (i // 5) * 10.0) for i in range(n)]
    edges = sorted(
        (a.id, b.id)
        for i, a in enumerate(pts)
        for b in pts[i + 1:]
        if math.hypot(a.x - b.x, a.y - b.y) < R
    )
    order = {p.id: i for i, p in enumerate(pts)}
    return pts, edges, order


def run(sim=None, log=None, available=None):
    pts, edges, order = make()
    avail = available if available is not None else [p.id for p in pts]
    sim = sim or FakeSimulator()
    return pts, edges, order, run_atoms_alone(
        pts, edges, R, avail, order, sim, seed=3, log=log
    )


def test_result_independent_and_gaps_correct():
    pts, edges, order, res = run()
    picked = set(res.picked)
    assert picked and not any(a in picked and b in picked for a, b in edges)
    blocked = {x for a, b in edges for x, y in ((a, b), (b, a)) if y in picked}
    expected = tuple(p.id for p in pts if p.id not in picked and p.id not in blocked)
    assert res.gaps == expected
    assert res.gap_count == len(expected)


def test_only_available_points_are_used():
    pts, edges, order, res = run(available=[f"p{i:02d}" for i in range(12)])
    assert set(res.picked) <= {f"p{i:02d}" for i in range(12)}


def test_label_and_log_has_no_rule_entries():
    log = DecisionLog("channel_plan")
    _, _, _, res = run(log=log)
    assert res.label == LABEL == "atoms alone (in pieces of 10 or less in simulation)"
    assert len(log) > 0
    assert all(e.source == "atoms" for e in log)
    picked_in_log = [p for e in log if e.action == "pick" for p in e.points]
    assert picked_in_log == list(res.picked)


def test_deterministic():
    a = run()[3]
    b = run()[3]
    assert a == b or (a.picked, a.gaps) == (b.picked, b.gaps)


def test_failing_part_is_skipped_and_counted():
    pts, edges, order = make()
    tiles = build_tiles(pts, [p.id for p in pts], order)
    tile = tiles[0]
    parts = layout_tile([p for p in pts if p.id in tile], edges, R, 3).parts
    victim = next(p for p in parts if p.fixed_frequency is None)
    sim = FakeSimulator(fail_seeds=[tile_seed(3, victim.ids)])
    log = DecisionLog("channel_plan")
    res = run_atoms_alone(pts, edges, R, [p.id for p in pts], order, sim, 3, log)
    assert res.skipped_parts == 1
    assert not set(victim.ids) & set(res.picked)
    skips = [e for e in log if e.action == "skip"]
    assert len(skips) == 1 and "fake simulator failure" in skips[0].message
    picked = set(res.picked)
    assert not any(a in picked and b in picked for a, b in edges)
    blocked = {x for a, b in edges for x, y in ((a, b), (b, a)) if y in picked}
    assert res.gaps == tuple(
        p.id for p in pts if p.id not in picked and p.id not in blocked
    )
