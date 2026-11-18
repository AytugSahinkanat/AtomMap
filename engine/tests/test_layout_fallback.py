"""Unit tests for the optimiser fallback and the split (Requirements 6.5, 6.6, 6.9 to 6.11)."""

from __future__ import annotations

from atommap.layout import (
    LayoutRejected,
    ScaledLayout,
    TileLayouts,
    layout_tile,
    optimiser_layout,
    scaled_layout,
)
from atommap.log import DecisionLog
from atommap.model import Point

PATH_EDGES = [("p0", "p1"), ("p1", "p2")]
# Coordinates put p0 and p2 close together, so the scaled layout shows an extra edge.
TRIANGLE = [Point("p0", 0.0, 0.0), Point("p1", 1.0, 0.0), Point("p2", 0.5, 0.2)]

STAR_EDGES = [("c", f"l{i}") for i in range(6)]
STAR = [Point("c", 0.0, 0.0)] + [Point(f"l{i}", 0.1 * (i + 1), 0.05 * i) for i in range(6)]


def test_optimiser_accepts_what_scaled_rejects():
    assert isinstance(scaled_layout(TRIANGLE, PATH_EDGES, 1.2), LayoutRejected)
    assert isinstance(optimiser_layout(TRIANGLE, PATH_EDGES, seed=1), ScaledLayout)
    res = layout_tile(TRIANGLE, PATH_EDGES, 1.2, seed=1)
    assert res.splits == 0 and res.fallbacks == 1
    assert [p.ids for p in res.parts] == [("p0", "p1", "p2")]


def test_star_with_six_leaves_must_split_and_covers_every_point():
    log = DecisionLog("channel_plan")
    res = layout_tile(STAR, STAR_EDGES, 1.0, seed=3, log=log)
    assert isinstance(res, TileLayouts)
    assert res.splits >= 1
    seen = [i for part in res.parts for i in part.ids]
    assert sorted(seen) == sorted(p.id for p in STAR)  # each Point in exactly one part
    for part in res.parts:
        assert part.fixed_frequency is None or part.fixed_frequency == 1.0
        assert len(part.ids) == 1 or part.fixed_frequency is None


def test_split_is_logged_and_counted():
    log = DecisionLog("channel_plan")
    res = layout_tile(STAR, STAR_EDGES, 1.0, seed=3, log=log, round=6)
    entries = log.entries()
    assert len(entries) == res.splits >= 1
    first = entries[0]
    assert first.action == "split" and first.round == 6
    assert sorted(first.points) == sorted(p.id for p in STAR)
    assert first.reason


def test_single_point_never_splits():
    res = layout_tile([Point("a", 0.0, 0.0)], [], 1.0)
    assert res.parts == (ScaledLayout(("a",), (), 1.0),)
    assert res.splits == 0 and res.fallbacks == 0


def test_same_seed_gives_same_result():
    a = layout_tile(STAR, STAR_EDGES, 1.0, seed=7)
    b = layout_tile(STAR, STAR_EDGES, 1.0, seed=7)
    assert a == b
    assert optimiser_layout(TRIANGLE, PATH_EDGES, 7) == optimiser_layout(TRIANGLE, PATH_EDGES, 7)
