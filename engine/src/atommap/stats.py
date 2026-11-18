"""Run statistics (Requirements 10.1, 10.2, 10.3, 10.7, 10.8, 10.9).

Everything is computed from this run's Decision_Log and counters only.

Picks, splits and skipped Tiles are counted from the Decision_Log entries.
The atom-informed pick count comes from the loop's StepInfo (a pick made from
annealing frequencies after a skipped Tile has source "annealing" and is not
atom-informed). `mismatches` is always 0: a layout that does not match the
graph is never accepted, it is split instead.
"""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

from .atoms_alone import AtomsAloneResult
from .log import SOURCES
from .loop import RoundResult
from .model import Entry, Stats

__all__ = ["compute_stats", "compute_atoms_alone_stats"]


def _counts(entries: Iterable[Entry], rounds: Optional[Sequence[int]], extra: Iterable[int]):
    entries = list(entries)
    if rounds is None:
        rounds = sorted({e.round for e in entries} | set(extra))
    per_round = {r: 0 for r in rounds}
    per_source = {s: 0 for s in SOURCES}
    splits = skips = 0
    for e in entries:
        if e.action == "pick":
            per_round[e.round] = per_round.get(e.round, 0) + len(e.points)
            per_source[e.source] += len(e.points)
        elif e.action == "split":
            splits += 1
        elif e.action == "skip":
            skips += 1
    return list(per_round.values()), per_source, splits, skips


def _share(quantum: int, total: int) -> float:
    return quantum / total if total else 0.0


def compute_stats(
    entries: Iterable[Entry],
    round_results: Sequence[RoundResult],
    rounds: Optional[Sequence[int]] = None,
) -> Stats:
    """Stats of a Hybrid, Annealing_Rules or Coin_Flip_Rules run.

    `rounds` fixes the order and presence of Rounds in `picks_per_round`
    (e.g. [1, 6, 11]); by default the Rounds seen in the log and results.
    """
    per_round, per_source, splits, skips = _counts(
        entries, rounds, (rr.round for rr in round_results)
    )
    total = sum(per_round)
    quantum = sum(rr.atom_picks for rr in round_results)
    timings: dict[str, float] = {}
    for rr in round_results:
        for k, v in rr.timings.items():
            timings[k] = timings.get(k, 0.0) + v
    return Stats(
        picks_per_round=per_round,
        picks_per_source=per_source,
        quantum_share=_share(quantum, total),
        atoms_not_needed=quantum == 0,
        splits=splits,
        skipped_tiles=skips,
        mismatches=0,
        braket_calls=sum(rr.simulator_calls for rr in round_results),
        cache_hits=sum(rr.cache_hits for rr in round_results),
        layout_fallbacks=sum(rr.layout_fallbacks for rr in round_results),
        timings=timings,
        quantum_picks=quantum,
        total_picks=total,
    )


def compute_atoms_alone_stats(
    entries: Iterable[Entry],
    results: Sequence[AtomsAloneResult],
    rounds: Optional[Sequence[int]] = None,
) -> Stats:
    """Stats of Atoms_Alone: every pick comes from atoms; gaps are listed."""
    per_round, per_source, splits, skips = _counts(entries, rounds, ())
    total = sum(per_round)
    gaps = [g for res in results for g in res.gaps]
    sim = sum(sum(res.timings_s) for res in results)
    return Stats(
        picks_per_round=per_round,
        picks_per_source=per_source,
        quantum_share=_share(total, total),
        atoms_not_needed=total == 0,
        splits=splits,
        skipped_tiles=skips,
        mismatches=0,
        braket_calls=sum(res.simulator_calls for res in results),
        cache_hits=0,
        layout_fallbacks=sum(res.fallbacks for res in results),
        timings={"simulator": sim},
        gaps=gaps,
        quantum_picks=total,
        total_picks=total,
    )
