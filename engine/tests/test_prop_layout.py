"""Property 6: Accepted Layouts are valid.

**Validates: Requirements 6.1, 6.2, 6.3, 6.8, 12.5**

The checks are computed here on their own, in integer tenths of a micrometre.
The edge rule is the one the code implements: two atoms are "close" when their
distance is strictly below the blockade radius.
"""
from __future__ import annotations

import math
from itertools import combinations

from hypothesis import HealthCheck, given, settings, strategies as st

from atommap.layout import layout_tile
from atommap.model import Point
from atommap.physics import blockade_radius_m

RB_TENTHS = blockade_radius_m() * 1e6 * 10.0  # blockade radius in tenths of a um
MIN_SQ = 40 * 40  # 4.0 um in tenths, squared
BOX = 1000  # 100 um in tenths


@st.composite
def tiles(draw):
    n = draw(st.integers(min_value=1, max_value=10))
    r = draw(st.floats(min_value=0.5, max_value=50.0))
    side = draw(st.floats(min_value=0.3, max_value=3.0)) * r
    coords = draw(
        st.lists(
            st.tuples(
                st.floats(min_value=0.0, max_value=1.0),
                st.floats(min_value=0.0, max_value=1.0),
            ),
            min_size=n,
            max_size=n,
        )
    )
    points = [Point(f"p{i}", x * side, y * side) for i, (x, y) in enumerate(coords)]
    pairs = list(combinations(range(n), 2))
    edges = set()
    for i, j in pairs:
        d = math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
        if d < r:
            edges.add((points[i].id, points[j].id))
    if draw(st.booleans()) and pairs:  # non-disk graph: flip some pairs
        flips = draw(st.lists(st.sampled_from(pairs), max_size=4, unique=True))
        for i, j in flips:
            e = (points[i].id, points[j].id)
            edges.symmetric_difference_update({e})
    return points, sorted(edges), r


@settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=list(HealthCheck),
)
@given(tiles())
def test_accepted_layouts_are_valid(tile):
    points, edges, r = tile
    result = layout_tile(points, edges, r, seed=0)

    # Every Point is in exactly one part.
    all_ids = [i for part in result.parts for i in part.ids]
    assert sorted(all_ids) == sorted(p.id for p in points)

    for part in result.parts:
        ids = part.ids
        assert len(ids) >= 1
        if len(ids) == 1:
            assert part.positions_um == ()
            assert part.fixed_frequency == 1.0
            continue

        assert len(part.positions_um) == len(ids)
        assert len(ids) <= 10

        tenths = [(round(x * 10), round(y * 10)) for x, y in part.positions_um]
        # Positions are on the 0.1 um grid.
        for (x, y), (tx, ty) in zip(part.positions_um, tenths):
            assert abs(x * 10 - tx) < 1e-6 and abs(y * 10 - ty) < 1e-6

        xs = [t[0] for t in tenths]
        ys = [t[1] for t in tenths]
        assert max(xs) - min(xs) <= BOX
        assert max(ys) - min(ys) <= BOX

        close = set()
        for a, b in combinations(range(len(ids)), 2):
            sq = (tenths[a][0] - tenths[b][0]) ** 2 + (tenths[a][1] - tenths[b][1]) ** 2
            assert sq >= MIN_SQ, f"atoms {ids[a]}, {ids[b]} closer than 4.0 um"
            if math.sqrt(sq) < RB_TENTHS:
                close.add(tuple(sorted((ids[a], ids[b]))))

        idset = set(ids)
        expected = {e for e in edges if e[0] in idset and e[1] in idset}
        assert close == expected
