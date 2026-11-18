"""One slow test with the real Braket simulator (Requirement 5)."""

import random
import time

import pytest

from atommap.layout import ScaledLayout, scaled_layout
from atommap.model import Point
from atommap.physics import blockade_radius_m
from atommap.simulator import SHOTS, BraketSimulator, repair_shot, tile_seed


def _independent(kept, edges):
    return not any(a in kept and b in kept for a, b in edges)


@pytest.mark.slow
def test_real_simulator_path_of_five():
    r = 10.0  # metres, arbitrary; the layout rescales so r becomes the blockade radius
    pts = [Point(f"p{i}", i * 0.8 * r, 0.0) for i in range(5)]
    edges = [(f"p{i}", f"p{i + 1}") for i in range(4)]
    lay = scaled_layout(pts, edges, r)
    assert isinstance(lay, ScaledLayout), lay
    assert blockade_radius_m() > 0

    t0 = time.time()
    seed = tile_seed(1, lay.ids)
    shots = BraketSimulator().run_tile(list(lay.positions_um), seed)
    elapsed = time.time() - t0

    assert len(shots) == SHOTS
    rng = random.Random(seed)
    raw_ok = 0
    for shot in shots:
        picked = {pid for pid, v in zip(lay.ids, shot) if v == 0}
        raw_ok += _independent(picked, edges)
        assert _independent(repair_shot(picked, edges, rng), edges)
    share = raw_ok / len(shots)
    print(f"raw independent share: {share:.2f}, runtime: {elapsed:.1f}s")
    assert share >= 0.8
