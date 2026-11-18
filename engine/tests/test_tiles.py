"""Unit tests for Tiles (Requirements 4.5)."""

from atommap.fixtures import HERO, load_request
from atommap.model import Point, validate_request
from atommap.tiles import MAX_TILE, bisect, build_tiles, shrink_tiles


def _grid(cols: int, rows: int, dx: float = 9.0, dy: float = 9.0) -> list[Point]:
    return [
        Point(f"p{r * cols + c}", c * dx, r * dy)
        for r in range(rows)
        for c in range(cols)
    ]


def _order(pts: list[Point]) -> dict[str, int]:
    return {p.id: i for i, p in enumerate(pts)}


def test_size_limit_and_one_tile_per_point():
    pts = _grid(7, 7)
    order = _order(pts)
    tiles = build_tiles(pts, order, order)
    assert all(1 <= len(t) <= MAX_TILE for t in tiles)
    flat = [i for t in tiles for i in t]
    assert sorted(flat) == sorted(order)
    assert len(flat) == len(set(flat))


def test_small_input_is_single_tile_in_request_order():
    pts = _grid(5, 2)
    order = _order(pts)
    assert build_tiles(pts, order, order) == [tuple(p.id for p in pts)]


def test_exactly_ten_stays_one_tile_eleven_splits():
    pts = _grid(11, 1)
    order = _order(pts)
    assert len(build_tiles(pts[:10], order, order)) == 1
    tiles = build_tiles(pts, order, order)
    assert len(tiles) == 2
    assert sorted(len(t) for t in tiles) == [5, 6]


def test_empty_available_gives_no_tiles():
    pts = _grid(3, 3)
    assert build_tiles(pts, [], _order(pts)) == []


def test_only_available_points_are_tiled():
    pts = _grid(6, 6)
    order = _order(pts)
    avail = [p.id for p in pts if order[p.id] % 2 == 0]
    flat = [i for t in build_tiles(pts, avail, order) for i in t]
    assert sorted(flat) == sorted(avail)


def test_tiles_sorted_by_first_position_and_ids_in_request_order():
    pts = _grid(8, 8)
    order = _order(pts)
    tiles = build_tiles(pts, order, order)
    firsts = [order[t[0]] for t in tiles]
    assert firsts == sorted(firsts)
    for t in tiles:
        pos = [order[i] for i in t]
        assert pos == sorted(pos)


def test_split_uses_longer_axis_wide():
    pts = [Point(f"p{i}", i * 10.0, (i % 2) * 1.0) for i in range(4)]
    a, b = bisect(pts, _order(pts))
    assert {p.id for p in a} == {"p0", "p1"}
    assert {p.id for p in b} == {"p2", "p3"}


def test_split_uses_longer_axis_tall():
    # Request order is scrambled against y, so the split must follow y.
    ys = [30.0, 0.0, 20.0, 10.0]
    pts = [Point(f"p{i}", float(i % 2), y) for i, y in enumerate(ys)]
    a, b = bisect(pts, _order(pts))
    assert {p.id for p in a} == {"p1", "p3"}  # y = 0, 10
    assert {p.id for p in b} == {"p2", "p0"}  # y = 20, 30


def test_split_tie_in_extent_picks_x_and_odd_count_gives_first_half_less():
    pts = [Point("a", 0.0, 0.0), Point("b", 5.0, 5.0), Point("c", 10.0, 10.0)]
    a, b = bisect(pts, _order(pts))
    assert [p.id for p in a] == ["a"]
    assert [p.id for p in b] == ["b", "c"]


def test_coordinate_ties_broken_by_request_order():
    pts = [Point(f"p{i}", 0.0, 0.0) for i in range(4)] + [Point("far", 50.0, 0.0)]
    a, b = bisect(pts, _order(pts))
    assert [p.id for p in a] == ["p0", "p1"]


def test_tiles_are_deterministic():
    pts = _grid(9, 9)
    order = _order(pts)
    assert build_tiles(pts, order, order) == build_tiles(pts, order, order)


def test_shrink_drops_removed_points_and_keeps_grouping():
    pts = _grid(7, 7)
    order = _order(pts)
    tiles = build_tiles(pts, order, order)
    removed = {tiles[0][0], tiles[1][0]}
    left = set(order) - removed
    smaller = shrink_tiles(tiles, left)
    assert [i for t in smaller for i in t] == [i for t in tiles for i in t if i in left]
    assert len(smaller) == len(tiles)
    for old, new in zip(tiles, smaller):
        assert set(new) <= set(old)


def test_shrink_removes_emptied_tiles_and_never_merges_or_regrows():
    pts = _grid(7, 7)
    order = _order(pts)
    tiles = build_tiles(pts, order, order)
    left = set(order) - set(tiles[0])
    smaller = shrink_tiles(tiles, left)
    assert smaller == tiles[1:]
    # Points that come back are not re-added.
    assert shrink_tiles(smaller, set(order)) == smaller
    assert shrink_tiles(tiles, []) == []
    assert shrink_tiles(tiles, set(order)) == tiles


def test_hero_map_tiles():
    req = validate_request(load_request(HERO))
    pts = list(req.points)
    order = _order(pts)
    tiles = build_tiles(pts, order, order)
    assert len(pts) == 70
    assert all(1 <= len(t) <= MAX_TILE for t in tiles)
    flat = [i for t in tiles for i in t]
    assert sorted(flat) == sorted(order)
    assert len(tiles) >= 7


def test_tiles_use_point_coordinates_not_edge_list():
    raw = load_request(HERO)
    plain = validate_request(raw)
    assert plain.edges is None
    ids = [p.id for p in plain.points]
    # Two different edge lists over the same Points.
    raw_a = load_request(HERO)
    raw_a["graph"]["edges"] = [[ids[0], ids[1]]]
    raw_b = load_request(HERO)
    raw_b["graph"]["edges"] = [[ids[5], ids[40]], [ids[2], ids[69]], [ids[10], ids[11]]]
    req_a = validate_request(raw_a)
    req_b = validate_request(raw_b)
    assert req_a.edges != req_b.edges

    def tiles_of(req):
        pts = list(req.points)
        order = _order(pts)
        return build_tiles(pts, order, order)

    assert tiles_of(req_a) == tiles_of(req_b) == tiles_of(plain)
