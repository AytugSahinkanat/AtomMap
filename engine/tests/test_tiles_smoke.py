from atommap.model import Point
from atommap.tiles import build_tiles, shrink_tiles


def test_tiles_smoke():
    pts = [Point(f"p{i}", float(i % 6) * 9, float(i // 6) * 9) for i in range(25)]
    order = {p.id: i for i, p in enumerate(pts)}
    tiles = build_tiles(pts, [p.id for p in pts], order)
    assert all(1 <= len(t) <= 10 for t in tiles)
    assert sorted(i for t in tiles for i in t) == sorted(order)
    assert tiles == build_tiles(pts, [p.id for p in pts], order)

    left = {i for t in tiles for i in t} - set(tiles[0])
    smaller = shrink_tiles(tiles, left)
    assert len(smaller) == len(tiles) - 1
    assert all(set(s) <= set(t) for s, t in zip(smaller, tiles[1:]))
