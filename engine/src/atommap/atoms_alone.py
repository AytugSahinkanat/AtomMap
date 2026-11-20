"""Atoms_Alone: the atoms without any Classical_Rules (Requirements 8.2, 8.3).

Per Round: split the available Points into Tiles, lay each Tile out (which may
split it further), keep the biggest repaired shot of each laid-out part, merge
the parts and drop every Point that conflicts with an already kept Point. The
result is always an Independent_Set but can leave gaps.

A part whose Simulator call raises is skipped (Requirement 7): one `skip`
entry with the exception message, counted in `skipped_parts`. Its Points are
not picked, so they may show up as gaps.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

from .layout import ScaledLayout, layout_tile
from .log import DecisionLog
from .model import Point
from .simulator import Simulator, repair_shot, tile_seed
from .tiles import build_tiles

__all__ = ["LABEL", "AtomsAloneResult", "run_atoms_alone"]

LABEL = "atoms alone (in pieces of 10 or less in simulation)"


@dataclass(frozen=True)
class AtomsAloneResult:
    picked: tuple[str, ...]  # in pick order
    gaps: tuple[str, ...]  # available, not picked, no picked neighbour
    label: str = LABEL
    tiles: int = 0
    parts: int = 0
    splits: int = 0
    fallbacks: int = 0
    simulator_calls: int = 0
    skipped_parts: int = 0
    dropped: tuple[str, ...] = ()  # removed because of a conflict with a kept Point
    timings_s: tuple[float, ...] = field(default_factory=tuple)  # per Simulator call

    @property
    def gap_count(self) -> int:
        return len(self.gaps)


def _best_shot(
    layout: ScaledLayout,
    shots: list[list[int]],
    edges: list[tuple[str, str]],
    tseed: int,
) -> list[str]:
    """Ids of the biggest repaired shot (first shot wins a tie), in part order."""
    rng = random.Random(tseed)
    best: frozenset[str] = frozenset()
    for shot in shots:
        picked = [pid for pid, v in zip(layout.ids, shot) if v == 0]
        kept = repair_shot(picked, edges, rng)
        if len(kept) > len(best):
            best = kept
    return [pid for pid in layout.ids if pid in best]


def _shot_frequencies(
    layout: ScaledLayout,
    shots: list[list[int]],
    edges: list[tuple[str, str]],
    tseed: int,
) -> dict[str, float]:
    """Share of repaired shots containing each Point (events only, own rng)."""
    rng = random.Random(tseed)
    counts = {pid: 0 for pid in layout.ids}
    for shot in shots:
        picked = [pid for pid, v in zip(layout.ids, shot) if v == 0]
        for pid in repair_shot(picked, edges, rng):
            counts[pid] += 1
    n = len(shots)
    return {pid: (c / n if n else 0.0) for pid, c in counts.items()}


def run_atoms_alone(
    points: Iterable[Point],
    edges: Iterable[tuple[str, str]],
    r: float,
    available: Iterable[str],
    order: dict[str, int],
    simulator: Simulator,
    seed: int = 0,
    log: Optional[DecisionLog] = None,
    round: int = 1,
    emit: Optional[Callable[[dict], None]] = None,
) -> AtomsAloneResult:
    """One Round of Atoms_Alone on the available Points.

    `emit` gets events without a competitor field: "simulate" before each
    Simulator call (step = part number in the Round, tile = part ids), a
    "frequencies" event after each successful call (share of repaired shots
    per Point) and one
    "pick" per kept Point after its part (tile None, source "atoms"), with
    `removed`: its neighbours not already removed by an earlier pick.
    """
    pts = {p.id: p for p in points}
    avail = set(available)
    edge_list = [(a, b) if a < b else (b, a) for a, b in edges]
    adj: dict[str, set[str]] = {i: set() for i in avail}
    for a, b in edge_list:
        if a in avail and b in avail:
            adj[a].add(b)
            adj[b].add(a)

    tiles = build_tiles(pts.values(), avail, order)
    kept: list[str] = []
    kept_set: set[str] = set()
    dropped: list[str] = []
    excluded: set[str] = set()  # neighbours of kept Points (events only)
    removed_by: dict[str, list[str]] = {}
    splits = fallbacks = calls = skipped = n_parts = 0
    timings: list[float] = []

    for tile in tiles:
        tile_pts = [pts[i] for i in tile]
        tl = layout_tile(tile_pts, edge_list, r, seed, log, round)
        splits += tl.splits
        fallbacks += tl.fallbacks
        for part in tl.parts:
            n_parts += 1
            gids = set(part.ids)
            sub = [e for e in edge_list if e[0] in gids and e[1] in gids]
            tseed = tile_seed(seed, part.ids)
            # A single Point has no positions from the layout: run it as one
            # atom at the origin so the pick really comes from the atoms.
            positions = list(part.positions_um) or [(0.0, 0.0)]
            calls += 1
            if emit is not None:
                emit({"kind": "simulate", "round": round, "step": n_parts,
                      "tile": list(part.ids)})
            t0 = time.perf_counter()
            try:
                shots = simulator.run_tile(positions, tseed)
            except Exception as exc:  # noqa: BLE001 - skip the part, keep going
                timings.append(time.perf_counter() - t0)
                skipped += 1
                if log is not None:
                    log.add(
                        round, "atoms", "skip", list(part.ids),
                        message=f"{type(exc).__name__}: {exc}",
                    )
                continue
            timings.append(time.perf_counter() - t0)
            if emit is not None:
                emit({"kind": "frequencies", "round": round, "step": n_parts,
                      "tile": list(part.ids),
                      "frequencies": _shot_frequencies(part, shots, sub, tseed)})
            candidates = _best_shot(part, shots, sub, tseed)
            new: list[str] = []
            for pid in candidates:
                if adj[pid].isdisjoint(kept_set):
                    kept_set.add(pid)
                    kept.append(pid)
                    new.append(pid)
                    fresh = adj[pid] - excluded - kept_set
                    removed_by[pid] = sorted(fresh)
                    excluded |= fresh
                else:
                    dropped.append(pid)
                    if log is not None:
                        log.add(round, "atoms", "remove", [pid])
            if new and log is not None:
                log.add(round, "atoms", "pick", new)
            if emit is not None:
                for pid in new:
                    emit({"kind": "pick", "round": round, "step": n_parts,
                          "tile": None, "picked": [pid], "removed": removed_by[pid],
                          "source": "atoms"})

    gaps = tuple(
        i for i in sorted(avail, key=lambda i: order[i])
        if i not in kept_set and adj[i].isdisjoint(kept_set)
    )
    return AtomsAloneResult(
        picked=tuple(kept),
        gaps=gaps,
        tiles=len(tiles),
        parts=n_parts,
        splits=splits,
        fallbacks=fallbacks,
        simulator_calls=calls,
        skipped_parts=skipped,
        dropped=tuple(dropped),
        timings_s=tuple(timings),
    )
