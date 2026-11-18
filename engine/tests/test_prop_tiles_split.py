"""Property 7: Tiles and splits partition the Points.

**Validates: Requirements 4.5, 6.9**
"""

from __future__ import annotations

import math

from hypothesis import HealthCheck, event, example, given, settings, strategies as st

from atommap.layout import layout_tile
from atommap.log import DecisionLog
from atommap.model import Point
from atommap.tiles import MAX_TILE, build_tiles


@st.composite
def remaining_graphs(draw):
    """Points, edges (disk graph, maybe perturbed), r and an available subset."""
    n = draw(st.integers(min_value=1, max_value=25))
    side = draw(st.sampled_from([20.0, 100.0]))
    coords = draw(
        st.lists(
            st.tuples(
                st.floats(0.0, side, allow_nan=False, allow_infinity=False),
                st.floats(0.0, side, allow_nan=False, allow_infinity=False),
            ),
            min_size=n,
            max_size=n,
        )
    )
    # r from tiny to larger than the whole area, so dense graphs occur
    r = draw(st.floats(side / 30.0, side * 1.5, allow_nan=False, allow_infinity=False))
    points = [Point(f"p{i:02d}", x, y) for i, (x, y) in enumerate(coords)]
    edges = {
        (points[i].id, points[j].id)
        for i in range(n)
        for j in range(i + 1, n)
        if math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < r
    }
    all_pairs = [(points[i].id, points[j].id) for i in range(n) for j in range(i + 1, n)]
    if all_pairs and draw(st.booleans()):  # non-disk graph
        flips = draw(st.lists(st.sampled_from(all_pairs), max_size=12))
        for pair in flips:
            edges ^= {pair}
    avail_mask = draw(st.lists(st.booleans(), min_size=n, max_size=n))
    available = [p.id for p, keep in zip(points, avail_mask) if keep]
    return points, edges, r, available


def _star_case(leaves: int, extra: int = 0):
    """K1,leaves (hub p00, leaves around it) plus `extra` isolated Points.

    A unit disk graph has at most 5 pairwise non-adjacent neighbours of one
    vertex, so K1,6 and larger stars have no exact Layout and must split.
    The leaves sit on a 9 m circle, so the scaled layout also fails
    (neighbouring leaves are closer than r = 10 m but have no edge).
    """
    hub = Point("p00", 50.0, 50.0)
    pts = [hub]
    for k in range(leaves):
        a = 2 * math.pi * k / leaves
        pts.append(Point(f"p{k + 1:02d}", 50.0 + 9.0 * math.cos(a), 50.0 + 9.0 * math.sin(a)))
    for k in range(extra):
        pts.append(Point(f"p{leaves + 1 + k:02d}", 50.0 + 3.0 * k, 90.0))
    edges = {("p00", p.id) for p in pts[1 : leaves + 1]}
    return pts, edges, 10.0, [p.id for p in pts]


@st.composite
def star_graphs(draw):
    """A star with 6 to 9 leaves (no exact Layout) inside one Tile, plus noise.

    Leaves are drawn near the hub, extra edges between non-leaf Points are
    flipped at random, and a few Points may be unavailable. Every such graph
    contains an induced K1,6 when all its Points are available, so the split
    path runs often.
    """
    leaves = draw(st.integers(min_value=6, max_value=9))
    extra = draw(st.integers(min_value=0, max_value=MAX_TILE - 1 - leaves))
    hub = Point("p00", 50.0, 50.0)
    pts = [hub]
    for k in range(leaves + extra):
        x = draw(st.floats(40.0, 60.0, allow_nan=False, allow_infinity=False))
        y = draw(st.floats(40.0, 60.0, allow_nan=False, allow_infinity=False))
        pts.append(Point(f"p{k + 1:02d}", x, y))
    edges = {("p00", p.id) for p in pts[1 : leaves + 1]}
    others = [p.id for p in pts[leaves + 1 :]]
    other_pairs = [(a, b) for i, a in enumerate(["p00"] + others) for b in others[i:] if a < b]
    if other_pairs:
        for pair in draw(st.lists(st.sampled_from(other_pairs), max_size=6)):
            edges ^= {pair}
    r = draw(st.floats(5.0, 30.0, allow_nan=False, allow_infinity=False))
    drop = draw(st.sets(st.sampled_from([p.id for p in pts]), max_size=2))
    available = [p.id for p in pts if p.id not in drop]
    return pts, edges, r, available


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=list(HealthCheck),
)
@given(st.one_of(remaining_graphs(), star_graphs()))
@example(_star_case(6))
@example(_star_case(7, extra=2))
def test_tiles_and_splits_partition_points(case):
    points, edges, r, available = case
    order = {p.id: i for i, p in enumerate(points)}
    by_id = {p.id: p for p in points}

    tiles = build_tiles(points, available, order)

    # Tiles: at most 10 Points, every available Point in exactly one Tile
    assert all(1 <= len(t) <= MAX_TILE for t in tiles)
    flat = [i for t in tiles for i in t]
    assert len(flat) == len(set(flat))
    assert set(flat) == set(available)

    any_split = False
    for tile in tiles:
        tile_set = set(tile)
        tile_edges = [e for e in edges if e[0] in tile_set and e[1] in tile_set]
        log = DecisionLog("channel_plan", [p.id for p in points])
        res = layout_tile([by_id[i] for i in tile], tile_edges, r, seed=0, log=log, round=1)

        part_ids = [list(part.ids) for part in res.parts]
        flat_parts = [i for ids in part_ids for i in ids]
        assert len(flat_parts) == len(set(flat_parts)), "a Point is in two parts"
        assert set(flat_parts) == tile_set, "a Point was lost or invented"
        assert len(res.parts) == res.splits + 1
        n_split_entries = sum(1 for e in log.entries() if e.action == "split")
        assert n_split_entries == res.splits
        any_split = any_split or res.splits > 0
    event(f"splits>0={any_split}")


def test_star_examples_split():
    """The fixed @example stars really take the split path (guards coverage)."""
    for case in (_star_case(6), _star_case(7, extra=2)):
        points, edges, r, available = case
        order = {p.id: i for i, p in enumerate(points)}
        tiles = build_tiles(points, available, order)
        assert len(tiles) == 1
        by_id = {p.id: p for p in points}
        tile = tiles[0]
        tile_edges = [e for e in edges if e[0] in tile and e[1] in tile]
        res = layout_tile([by_id[i] for i in tile], tile_edges, r, seed=0)
        assert res.splits >= 1
