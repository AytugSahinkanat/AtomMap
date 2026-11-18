"""Rydberg pulse, program, seeding and the real Braket simulator (Requirement 5).

Shot repair, the cache and the fake simulator live elsewhere. Braket is
imported lazily so importing this module stays cheap.
"""

from __future__ import annotations

import hashlib
import random
from typing import Iterable, Protocol, Sequence

import numpy as np

from .layout import ScaledLayout
from .physics import C6, OMEGA, blockade_radius_m

__all__ = [
    "C6",
    "OMEGA",
    "blockade_radius_m",
    "DURATION_S",
    "RAMP_S",
    "STEPS",
    "SHOTS",
    "Simulator",
    "BraketSimulator",
    "tile_seed",
    "pulse_series",
    "build_program",
    "repair_shot",
    "part_frequencies",
    "FrequencyCache",
]

DURATION_S = 4e-6
RAMP_S = 0.25e-6
STEPS = 400
SHOTS = 100


class Simulator(Protocol):
    """The seam between the loop and the simulator.

    `positions_um` are the atom positions of one Tile in Tile order. `seed` is
    the Tile seed (see `tile_seed`). Returns one entry per shot; each shot is
    the post-sequence in Tile order, where 0 means the atom is excited (the
    point is picked).
    """

    def run_tile(
        self, positions_um: list[tuple[float, float]], seed: int
    ) -> list[list[int]]: ...


def tile_seed(seed: int, ids: Iterable[str]) -> int:
    """Run Seed plus a stable sha256 hash of the sorted Tile ids, mod 2**32."""
    digest = hashlib.sha256("\x1f".join(sorted(ids)).encode("utf-8")).digest()
    return (int(seed) + int.from_bytes(digest[:8], "big")) % (2**32)


def repair_shot(
    picked: Iterable[str],
    edges: Iterable[tuple[str, str]],
    rng: random.Random,
) -> frozenset[str]:
    """Walk the picked ids in a seeded random order, dropping any that conflicts with a kept one."""
    adjacency: dict[str, set[str]] = {}
    for a, b in edges:
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)
    order = sorted(set(picked))  # sorted first so the shuffle depends only on the rng
    rng.shuffle(order)
    kept: set[str] = set()
    for pid in order:
        if adjacency.get(pid, set()).isdisjoint(kept):
            kept.add(pid)
    return frozenset(kept)


def part_frequencies(
    simulator: Simulator,
    layout: ScaledLayout,
    edges: Iterable[tuple[str, str]],
    seed: int,
) -> dict[str, float]:
    """Share of repaired shots that contain each Point of a laid-out part.

    Post sequence 0 means picked. A single-Point part returns its fixed
    frequency without calling the simulator.
    """
    if layout.fixed_frequency is not None:
        return {pid: layout.fixed_frequency for pid in layout.ids}
    tseed = tile_seed(seed, layout.ids)
    shots = simulator.run_tile(list(layout.positions_um), tseed)
    rng = random.Random(tseed)
    counts = {pid: 0 for pid in layout.ids}
    for shot in shots:
        picked = [pid for pid, v in zip(layout.ids, shot) if v == 0]
        for pid in repair_shot(picked, edges, rng):
            counts[pid] += 1
    n = len(shots)
    return {pid: (c / n if n else 0.0) for pid, c in counts.items()}


class _CountingSimulator:
    """Counts run_tile calls (including ones that raise) on the way through."""

    def __init__(self, inner: Simulator, owner: "FrequencyCache") -> None:
        self._inner = inner
        self._owner = owner

    def run_tile(
        self, positions_um: list[tuple[float, float]], seed: int
    ) -> list[list[int]]:
        self._owner.simulator_calls += 1
        return self._inner.run_tile(positions_um, seed)


class FrequencyCache:
    """Tile frequencies keyed by the frozenset of the Tile's Point ids (Requirement 5.8).

    An entry lives until one of its Points is removed (`invalidate`). The key
    holds no Seed: one cache belongs to one run. Seeding is per call from the
    Seed and the Tile ids (`tile_seed`), so recomputing an entry gives the same
    values and results are identical with or without the cache (5.4).

    `hits` and `misses` count lookups. `simulator_calls` counts real Simulator
    calls made through `part_frequencies` (single-Point parts make none).
    """

    def __init__(self) -> None:
        self._entries: dict[frozenset[str], dict[str, float]] = {}
        self.hits = 0
        self.misses = 0
        self.simulator_calls = 0

    def __len__(self) -> int:
        return len(self._entries)

    def get_or_compute(self, ids: Iterable[str], compute) -> dict[str, float]:
        key = frozenset(ids)
        found = self._entries.get(key)
        if found is not None:
            self.hits += 1
            return dict(found)
        self.misses += 1
        value = compute()  # a raise here stores nothing
        self._entries[key] = dict(value)
        return dict(value)

    def part_frequencies(
        self,
        simulator: Simulator,
        layout: ScaledLayout,
        edges: Iterable[tuple[str, str]],
        seed: int,
    ) -> dict[str, float]:
        """Cached `part_frequencies` for one laid-out part."""
        edge_list = list(edges)
        return self.get_or_compute(
            layout.ids,
            lambda: part_frequencies(
                _CountingSimulator(simulator, self), layout, edge_list, seed
            ),
        )

    def invalidate(self, removed_ids: Iterable[str]) -> int:
        """Drop every entry whose key contains a removed id. Returns how many were dropped."""
        removed = set(removed_ids)
        stale = [k for k in self._entries if not removed.isdisjoint(k)]
        for k in stale:
            del self._entries[k]
        return len(stale)


def pulse_series() -> dict[str, list[tuple[float, float]]]:
    """The pulse as (time in s, value) points. Amplitude and detuning in rad/s, phase in rad."""
    t_end = DURATION_S
    t_fall = 3.75e-6  # t_end - RAMP_S, written out to avoid float error
    return {
        "amplitude": [(0.0, 0.0), (RAMP_S, OMEGA), (t_fall, OMEGA), (t_end, 0.0)],
        "detuning": [
            (0.0, -5.0 * OMEGA),
            (RAMP_S, -5.0 * OMEGA),
            (t_fall, 5.0 * OMEGA),
            (t_end, 5.0 * OMEGA),
        ],
        "phase": [(0.0, 0.0), (t_end, 0.0)],
    }


def build_program(positions_um: Sequence[Sequence[float]]):
    """Braket AHS program for atoms at `positions_um` (converted to metres)."""
    from braket.ahs.analog_hamiltonian_simulation import AnalogHamiltonianSimulation
    from braket.ahs.atom_arrangement import AtomArrangement
    from braket.ahs.driving_field import DrivingField
    from braket.timings.time_series import TimeSeries

    register = AtomArrangement()
    for x, y in positions_um:
        register.add((float(x) * 1e-6, float(y) * 1e-6))

    series = pulse_series()

    def ts(points: list[tuple[float, float]]) -> TimeSeries:
        out = TimeSeries()
        for t, v in points:
            out.put(t, v)
        return out

    field = DrivingField(
        amplitude=ts(series["amplitude"]),
        phase=ts(series["phase"]),
        detuning=ts(series["detuning"]),
    )
    return AnalogHamiltonianSimulation(register=register, hamiltonian=field)


class BraketSimulator:
    """The real Amazon Braket local AHS simulator."""

    def run_tile(
        self, positions_um: list[tuple[float, float]], seed: int
    ) -> list[list[int]]:
        from braket.devices import LocalSimulator

        program = build_program(positions_um)
        np.random.seed(seed % (2**32))  # right before the call (Requirement 5.4)
        task = LocalSimulator("braket_ahs").run(
            program, shots=SHOTS, steps=STEPS, blockade_radius=blockade_radius_m()
        )
        result = task.result()
        return [[int(v) for v in m.post_sequence] for m in result.measurements]
