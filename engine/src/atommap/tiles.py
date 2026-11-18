"""Tiles: recursive bisection into groups of at most 10 Points (Requirements 4.5, 6.1).

Tiles always use the Point coordinates (x, y in metres), also when the
Conflict_Graph comes from an edge list. A Tile is a tuple of Point ids in
request order. Tiles are built once per Round and only shrink afterwards.
"""

from __future__ import annotations

from typing import Iterable

from .model import Point

MAX_TILE = 10

Tile = tuple[str, ...]


def bisect(points: list[Point], order: dict[str, int]) -> tuple[list[Point], list[Point]]:
    """Split Points in two on the longer axis at the median position.

    Ties in coordinate are broken by request order, so the split is
    deterministic. The first half gets the smaller share when the count is odd.
    Needs at least 2 Points.
    """
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    use_x = (max(xs) - min(xs)) >= (max(ys) - min(ys))  # a tie in extent picks x
    ranked = sorted(points, key=lambda p: ((p.x if use_x else p.y), order[p.id]))
    mid = len(ranked) // 2
    return ranked[:mid], ranked[mid:]


def build_tiles(
    points: Iterable[Point], available: Iterable[str], order: dict[str, int]
) -> list[Tile]:
    """Split the available Points into Tiles of at most MAX_TILE by recursive bisection.

    `order` maps each Point id to its request position. Each Tile lists its ids
    in request order, and Tiles come out sorted by their first id's position.
    """
    avail = set(available)
    pts = [p for p in points if p.id in avail]
    out: list[list[Point]] = []

    def rec(group: list[Point]) -> None:
        if not group:
            return
        if len(group) <= MAX_TILE:
            out.append(group)
            return
        a, b = bisect(group, order)
        rec(a)
        rec(b)

    rec(pts)
    tiles = [tuple(p.id for p in sorted(g, key=lambda p: order[p.id])) for g in out]
    tiles.sort(key=lambda t: order[t[0]])
    return tiles


def shrink_tiles(tiles: Iterable[Tile], available: Iterable[str]) -> list[Tile]:
    """Drop Points no longer available. Empty Tiles disappear. Tiles never merge or regrow."""
    avail = set(available)
    out: list[Tile] = []
    for t in tiles:
        kept = tuple(i for i in t if i in avail)
        if kept:
            out.append(kept)
    return out
