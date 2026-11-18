"""Property 8: Repaired shots are independent sets.

**Validates: Requirements 5.7**

Uses the fake simulator (no Braket). Parts come from `layout_tile`, edges are
restricted to each part.
"""
from __future__ import annotations

import math
import random
from itertools import combinations

from hypothesis import HealthCheck, given, settings, strategies as st

from atommap.layout import layout_tile
from atommap.model import Point
from atommap.simulator import SHOTS, part_frequencies, repair_shot, tile_seed
from fake_sim import FakeSimulator


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
    if draw(st.booleans()) and pairs:  # non-disk graph: add or remove edges
        for i, j in draw(st.lists(st.sampled_from(pairs), max_size=5, unique=True)):
            edges.symmetric_difference_update({(points[i].id, points[j].id)})
    p = draw(st.sampled_from([0.2, 0.5, 0.9, 1.0]))
    seed = draw(st.integers(min_value=0, max_value=2**31))
    return points, sorted(edges), r, p, seed


@settings(max_examples=150, deadline=None, suppress_health_check=list(HealthCheck))
@given(tiles())
def test_frequencies_and_repaired_shots(tile):
    points, edges, r, p, seed = tile
    parts = layout_tile(points, edges, r, seed=0).parts

    for part in parts:
        ids = set(part.ids)
        part_edges = [(a, b) for a, b in edges if a in ids and b in ids]
        sim = FakeSimulator(excite_probability=p)

        freqs = part_frequencies(sim, part, part_edges, seed)
        assert set(freqs) == ids
        assert all(0.0 <= f <= 1.0 for f in freqs.values())

        # same seed -> identical frequencies, from a fresh simulator
        assert part_frequencies(FakeSimulator(excite_probability=p), part, part_edges, seed) == freqs

        if part.fixed_frequency is not None:
            assert freqs == {pid: part.fixed_frequency for pid in part.ids}
            continue

        # Replay the shots the loop saw and check every repaired shot.
        tseed = tile_seed(seed, part.ids)
        shots = sim.run_tile(list(part.positions_um), tseed)
        assert len(shots) == SHOTS
        rng = random.Random(tseed)
        edge_set = {frozenset(e) for e in part_edges}
        counts = {pid: 0 for pid in part.ids}
        for shot in shots:
            picked = {pid for pid, v in zip(part.ids, shot) if v == 0}
            kept = repair_shot(sorted(picked), part_edges, rng)
            assert kept <= picked
            assert not any(frozenset(c) in edge_set for c in combinations(kept, 2))
            # maximal: a dropped picked Point conflicts with a kept one
            for d in picked - kept:
                assert any(frozenset((d, k)) in edge_set for k in kept)
            for pid in kept:
                counts[pid] += 1
        assert freqs == {pid: c / len(shots) for pid, c in counts.items()}


@settings(max_examples=150, deadline=None)
@given(
    st.integers(min_value=2, max_value=10).flatmap(
        lambda n: st.tuples(
            st.just(n),
            st.sets(st.sampled_from(list(combinations(range(n), 2))), max_size=20),
            st.sets(st.integers(min_value=0, max_value=n - 1)),
            st.integers(min_value=0, max_value=2**31),
        )
    )
)
def test_repair_shot_direct(args):
    n, raw_edges, pick_idx, seed = args
    edges = [(f"p{i}", f"p{j}") for i, j in raw_edges]
    picked = {f"p{i}" for i in pick_idx}
    edge_set = {frozenset(e) for e in edges}

    kept = repair_shot(picked, edges, random.Random(seed))
    assert kept <= picked
    assert not any(frozenset(c) in edge_set for c in combinations(kept, 2))
    for d in picked - kept:
        assert any(frozenset((d, k)) in edge_set for k in kept)
    assert kept == repair_shot(picked, edges, random.Random(seed))
