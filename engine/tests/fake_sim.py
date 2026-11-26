"""A fake Simulator for tests (Requirements 12.2, 12.3, 12.4).

Same shot format as the real simulator: `SHOTS` shots, each a list of ints in
Tile order, 0 = atom excited (picked), 1 = ground. The loop cannot tell the
difference.

Tiles are identified by their Tile seed, which is the only per-Tile value the
loop passes besides positions. To make a Tile fail, put its seed in
`fail_seeds`. Output depends only on `seed` and the number of positions, via
`numpy.random.default_rng(seed)`; no global random state is touched.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np

from atommap.simulator import SHOTS


class FakeSimulatorError(RuntimeError):
    """Raised for a Tile whose seed is in `fail_seeds`."""


class FakeSimulator:
    def __init__(
        self,
        fail_seeds: Iterable[int] = (),
        excite_probability: float = 0.5,
    ) -> None:
        if not 0.0 <= excite_probability <= 1.0:
            raise ValueError("excite_probability must be in [0, 1]")
        self.fail_seeds = frozenset(int(s) for s in fail_seeds)
        self.excite_probability = excite_probability
        self.calls = 0  # every run_tile call, including ones that raise
        self.seeds_seen: list[int] = []
        self.shots_seen: list[int] = []  # the shots asked for, per call

    def run_tile(
        self, positions_um: list[tuple[float, float]], seed: int, shots: int = SHOTS
    ) -> list[list[int]]:
        self.calls += 1
        self.seeds_seen.append(seed)
        self.shots_seen.append(shots)
        if seed in self.fail_seeds:
            raise FakeSimulatorError(f"fake simulator failure for tile seed {seed}")
        rng = np.random.default_rng(seed)
        excited = rng.random((shots, len(positions_um))) < self.excite_probability
        # 0 = excited (picked), 1 = ground
        return [[0 if e else 1 for e in row] for row in excited]
