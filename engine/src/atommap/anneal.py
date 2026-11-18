"""Simulated annealing provider: the classical stand-in for the atom shots.

Per Tile: 100 samples of 40 sweeps. In sweep t (0..39) T = 2.0 * (1 - t/40) + 0.05.
Energy = -(picked Points) + 2 * (conflicting pairs among picked Points).
Each sweep visits the Tile's Points in a seeded random order and flips each
with the Metropolis rule (accept if dE <= 0, else with probability exp(-dE/T)).
Start state: every Point unpicked. Each final sample is repaired exactly like
an atom shot (`repair_shot`), and a Point's frequency is the share of repaired
samples that contain it. Returns the same shape as `part_frequencies`.
"""

from __future__ import annotations

import math
import random
from typing import Iterable

import numpy as np

from .simulator import repair_shot, tile_seed

__all__ = ["SAMPLES", "SWEEPS", "temperature", "anneal_frequencies"]

SAMPLES = 100
SWEEPS = 40


def temperature(t: int) -> float:
    return 2.0 * (1 - t / SWEEPS) + 0.05


def anneal_frequencies(
    ids: Iterable[str],
    edges: Iterable[tuple[str, str]],
    seed: int,
) -> dict[str, float]:
    """Share of repaired annealing samples that contain each Point of the Tile."""
    ids = list(ids)
    index = {pid: i for i, pid in enumerate(ids)}
    edge_list = [(a, b) for a, b in edges if a in index and b in index and a != b]
    neighbors: list[set[int]] = [set() for _ in ids]
    for a, b in edge_list:
        neighbors[index[a]].add(index[b])
        neighbors[index[b]].add(index[a])
    n = len(ids)
    if n == 0:
        return {}

    tseed = tile_seed(seed, ids)
    rng = np.random.default_rng(tseed)
    repair_rng = random.Random(tseed)
    counts = {pid: 0 for pid in ids}

    for _ in range(SAMPLES):
        state = [False] * n
        for t in range(SWEEPS):
            temp = temperature(t)
            for i in rng.permutation(n):
                i = int(i)
                conflicts = sum(1 for j in neighbors[i] if state[j])
                d_pick = -1 + 2 * conflicts  # energy change of picking i
                d_e = -d_pick if state[i] else d_pick
                if d_e <= 0 or rng.random() < math.exp(-d_e / temp):
                    state[i] = not state[i]
        picked = [pid for pid, s in zip(ids, state) if s]
        for pid in repair_shot(picked, edge_list, repair_rng):
            counts[pid] += 1
    return {pid: c / SAMPLES for pid, c in counts.items()}
