"""Unit tests for the scaled layout (Requirements 6.1 to 6.4, 6.7, 6.8)."""

from __future__ import annotations

import math

from atommap.layout import LayoutRejected, ScaledLayout, scaled_layout
from atommap.model import Point
from atommap.physics import blockade_radius_m

RB_UM = blockade_radius_m() * 1e6


def line(*xs: float) -> list[Point]:
    return [Point(f"p{i}", x, 0.0) for i, x in enumerate(xs)]


def test_blockade_radius_about_8_37_um():
    assert abs(RB_UM - 8.37) < 0.01


def test_path_of_three_on_a_line_is_accepted():
    pts = line(0.0, 1.0, 2.0)  # r = 1.2 -> neighbours conflict, ends do not
    res = scaled_layout(pts, [("p0", "p1"), ("p1", "p2")], 1.2)
    assert isinstance(res, ScaledLayout)
    assert res.ids == ("p0", "p1", "p2")
    assert res.fixed_frequency is None
    assert len(res.positions_um) == 3
    for x, y in res.positions_um:
        assert abs(x * 10 - round(x * 10)) < 1e-6 and abs(y * 10 - round(y * 10)) < 1e-6
    d01 = math.dist(res.positions_um[0], res.positions_um[1])
    d02 = math.dist(res.positions_um[0], res.positions_um[2])
    assert 4.0 <= d01 < RB_UM
    assert d02 >= RB_UM


def test_single_point_has_no_atoms_and_frequency_one():
    res = scaled_layout([Point("a", 3.0, 4.0)], [], 1.0)
    assert res == ScaledLayout(("a",), (), 1.0)


def test_close_pair_is_pushed_to_min_spacing():
    # Scaled distance is about 0.84 µm, pushed apart to at least 4.0 µm, still an edge.
    pts = [Point("a", 0.0, 0.0), Point("b", 0.1, 0.0)]
    res = scaled_layout(pts, [("a", "b")], 1.0)
    assert isinstance(res, ScaledLayout)
    assert math.dist(*res.positions_um) >= 4.0


def test_coincident_points_are_deterministic():
    pts = [Point("a", 0.0, 0.0), Point("b", 0.0, 0.0)]
    r1 = scaled_layout(pts, [("a", "b")], 1.0)
    r2 = scaled_layout(pts, [("a", "b")], 1.0)
    assert isinstance(r1, ScaledLayout) and r1 == r2
    assert r1.positions_um[0][0] < r1.positions_um[1][0]


def test_too_dense_tile_is_rejected():
    # Ten points all in conflict: a 10-clique cannot keep 4 µm spacing inside
    # the blockade radius.
    pts = [Point(f"p{i}", 0.001 * i, 0.001 * (i % 3)) for i in range(10)]
    edges = [(f"p{i}", f"p{j}") for i in range(10) for j in range(i + 1, 10)]
    res = scaled_layout(pts, edges, 1.0)
    assert isinstance(res, LayoutRejected)
    assert res.reason


def test_missing_edge_is_rejected():
    pts = line(0.0, 1.0)
    res = scaled_layout(pts, [], 1.2)  # the pair is close but no edge is given
    assert isinstance(res, LayoutRejected)
    assert "edges" in res.reason


def test_extra_edge_is_rejected():
    pts = line(0.0, 10.0)
    res = scaled_layout(pts, [("p0", "p1")], 1.0)
    assert isinstance(res, LayoutRejected)


def test_box_limit_is_rejected():
    pts = line(0.0, 1.0)
    # Far apart (200 µm) and no edge: fails only the 100 µm box.
    res = scaled_layout(pts, [], RB_UM / 200.0)
    assert isinstance(res, LayoutRejected)
    assert "box" in res.reason


def test_spacing_is_checked_after_rounding():
    # Two atoms about 3.3 µm apart after scaling are pushed apart and end >= 4.0.
    pts = [Point("a", 0.0, 0.0), Point("b", 3.96e-6, 0.0)]
    res = scaled_layout(pts, [("a", "b")], 1e-5)
    assert isinstance(res, ScaledLayout)
    assert math.dist(*res.positions_um) >= 4.0


def test_bad_r_is_rejected():
    assert isinstance(scaled_layout(line(0.0, 1.0), [], 0.0), LayoutRejected)
