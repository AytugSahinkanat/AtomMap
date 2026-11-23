"""One Round of the hybrid loop (Requirements 4.1, 4.3, 4.4, 7.1 to 7.6, 8.4).

Repeat until no Point remains: apply the simplicial rule, get frequencies from
the provider, rank all remaining Points (frequency descending, ties by Point
id), pick one at random from the top group, remove its neighbours and log it.

Providers:
  "atoms"     Tile frequencies from the Simulator (Hybrid). A Tile whose
              Simulator call raises is skipped for that step and gets
              annealing frequencies instead.
  "annealing" Annealing frequencies per Tile (Annealing_Rules).
  "none"      No frequencies; any remaining Point may be picked (Coin_Flip_Rules).
  callable    `f(ids, edges, seed) -> {id: frequency}` called per Tile, treated
              like "annealing" (source "annealing"). For tests.

Top group size = max(1, round(0.4 * remaining)). The pick inside it is seeded
from the run Seed, the Round and the step; no global random state is used.
Tiles are built once per Round, after the first rule pass, and only shrink.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional, Sequence, Union

from .anneal import anneal_frequencies
from .graph import ConflictGraph
from .layout import TileLayouts, layout_tile
from .log import DecisionLog
from .model import Point
from .rules import apply_rules
from .simulator import FrequencyCache, Simulator
from .tiles import Tile, build_tiles, shrink_tiles

__all__ = ["TOP_SHARE", "StepInfo", "RoundResult", "top_group_size", "run_round"]

TOP_SHARE = 0.4

Provider = Union[str, Callable[[list, list, int], dict]]


class SimulatorFailure(Exception):
    """Wraps an exception raised from `simulator.run_tile`."""

    def __init__(self, original: BaseException) -> None:
        super().__init__(str(original))
        self.original = original


class _GuardedSimulator:
    """Turns any exception from the real Simulator into SimulatorFailure."""

    def __init__(
        self, inner: Simulator, on_call: Optional[Callable[[], None]] = None
    ) -> None:
        self._inner = inner
        self._on_call = on_call  # progress hook, runs right before each real call

    def run_tile(self, positions_um, seed):
        if self._on_call is not None:
            self._on_call()  # outside the try: errors from the hook propagate
        try:
            return self._inner.run_tile(positions_um, seed)
        except Exception as exc:  # noqa: BLE001 - only the simulator call is guarded
            raise SimulatorFailure(exc) from exc


@dataclass(frozen=True)
class StepInfo:
    """One non-rule step: exactly one pick."""

    step: int
    pick: str
    source: str  # "atoms" | "annealing" | "coin flip"
    atom_informed: bool  # the pick's frequency came from atoms
    remaining: int  # Points available when the step began
    top_group: int  # size of the group the pick was drawn from
    skipped_tiles: int  # Tiles skipped in this step


@dataclass
class RoundResult:
    round: int
    picks: list[str] = field(default_factory=list)  # all picks in order (rules and steps)
    rule_picks: list[str] = field(default_factory=list)
    steps: list[StepInfo] = field(default_factory=list)
    splits: int = 0
    skipped_tiles: int = 0
    layout_fallbacks: int = 0
    cache_hits: int = 0
    simulator_calls: int = 0
    timings: dict[str, float] = field(default_factory=dict)

    @property
    def atom_picks(self) -> int:
        """Picks made in atom-informed steps."""
        return sum(1 for s in self.steps if s.atom_informed)


def top_group_size(n: int) -> int:
    return max(1, round(TOP_SHARE * n))


def _rank(freqs: dict[str, float], ids: Iterable[str]) -> list[str]:
    return sorted(ids, key=lambda i: (-freqs[i], i))


def run_round(
    graph: ConflictGraph,
    points: Sequence[Point],
    r: float,
    available: Iterable[str],
    log: DecisionLog,
    round: int,
    seed: int,
    provider: Provider,
    simulator: Optional[Simulator] = None,
    cache: Optional[FrequencyCache] = None,
    emit: Optional[Callable[[dict], None]] = None,
) -> RoundResult:
    """Run one Round on `available` (not modified) and return the RoundResult.

    Entries are appended to `log`. Pass one `cache` per run to share
    frequencies across Rounds; counters in the result are deltas of this Round.

    `emit` gets progress events without a competitor field (the caller adds it):
    `{"kind": "simulate", "round", "step", "tile": [ids]}` right before each real
    Simulator call, `{"kind": "frequencies", "round", "step", "tile": [ids],
    "frequencies": {id: 0..1}}` right after it, and `{"kind": "pick", "round", "step", "tile": None,
    "picked": [id], "removed": [ids], "source"}` after each pick (source "rule" for rule picks;
    their step is the last finished step, 0 before the first).
    """
    atoms = provider == "atoms"
    if atoms and simulator is None:
        raise ValueError("the atoms provider needs a Simulator")
    if not atoms and provider not in ("annealing", "none") and not callable(provider):
        raise ValueError(f"Unknown provider {provider!r}")
    if cache is None:
        cache = FrequencyCache()
    anneal_cache = FrequencyCache()  # annealing values, not reported
    current_part: list[tuple[str, ...]] = []  # ids of the part being simulated

    def before_call() -> None:
        if emit is not None:
            emit({"kind": "simulate", "round": round, "step": step,
                  "tile": list(current_part[0]) if current_part else []})

    guarded = (
        _GuardedSimulator(simulator, before_call if emit is not None else None)
        if simulator is not None else None
    )

    adj = graph.adjacency()
    by_id = {p.id: p for p in points}
    order = {pid: i for i, pid in enumerate(graph.nodes)}
    avail = set(available)
    result = RoundResult(round=round)
    hits0, calls0 = cache.hits, cache.simulator_calls
    timings = {"rules": 0.0, "layout": 0.0, "simulator": 0.0, "annealing": 0.0}
    t_start = time.perf_counter()

    tiles: Optional[list[Tile]] = None
    layouts: dict[Tile, TileLayouts] = {}
    step = 0
    real_ids: set[str] = set()  # Points whose frequency came from a real Simulator run

    def tile_edges(ids: Iterable[str]) -> list[tuple[str, str]]:
        s = set(ids)
        return sorted(e for e in graph.edges if e[0] in s and e[1] in s)

    def annealing_for(tile: Tile) -> dict[str, float]:
        t0 = time.perf_counter()
        try:
            edges = tile_edges(tile)
            fn = provider if callable(provider) else anneal_frequencies
            return anneal_cache.get_or_compute(tile, lambda: fn(list(tile), edges, seed))
        finally:
            timings["annealing"] += time.perf_counter() - t0

    def atom_frequencies(tile: Tile) -> dict[str, float]:
        """Frequencies of a whole Tile from the Simulator. Raises SimulatorFailure."""
        lay = layouts.get(tile)
        if lay is None:
            t0 = time.perf_counter()
            lay = layout_tile(
                [by_id[i] for i in tile], tile_edges(tile), r, seed, log, round
            )
            timings["layout"] += time.perf_counter() - t0
            layouts[tile] = lay
            result.splits += lay.splits
            result.layout_fallbacks += lay.fallbacks
        out: dict[str, float] = {}
        fresh: list[str] = []
        t0 = time.perf_counter()
        try:
            for part in lay.parts:
                m0 = cache.misses
                c0 = cache.simulator_calls
                current_part[:] = [tuple(part.ids)]
                part_freqs = cache.part_frequencies(
                    guarded, part, tile_edges(part.ids), seed
                )
                out.update(part_freqs)
                if part.fixed_frequency is None:
                    real_ids.update(part.ids)  # from a real Simulator run
                    if emit is not None and cache.simulator_calls > c0:
                        emit({"kind": "frequencies", "round": round, "step": step,
                              "tile": list(part.ids),
                              "frequencies": dict(part_freqs),
                              "shots": cache.last_shots})
                if cache.misses > m0:
                    fresh.extend(part.ids)
        except SimulatorFailure:
            cache.invalidate(fresh)  # discard partial output of this Tile
            raise
        finally:
            timings["simulator"] += time.perf_counter() - t0
        return out

    while True:
        t0 = time.perf_counter()
        before = set(avail)
        rule_picks = apply_rules(graph, avail, log, round, adj)
        timings["rules"] += time.perf_counter() - t0
        result.rule_picks.extend(rule_picks)
        result.picks.extend(rule_picks)
        if emit is not None:
            replay = set(before)  # same sequence apply_rules followed
            for pid in rule_picks:
                rem = sorted(adj[pid] & replay)
                remaining_before = len(replay)
                replay.discard(pid)
                replay.difference_update(rem)
                emit({"kind": "pick", "round": round, "step": step, "tile": None,
                      "picked": [pid], "removed": rem, "source": "rule",
                      "remaining": remaining_before, "top_group": None,
                      "rank": None, "frequency": None})
        gone = before - avail
        if gone:
            cache.invalidate(gone)
            anneal_cache.invalidate(gone)
        if tiles is None:
            tiles = build_tiles(points, avail, order)
        else:
            tiles = shrink_tiles(tiles, avail)
        if not avail:
            break

        step += 1
        remaining = len(avail)
        k = top_group_size(remaining)
        skipped_now = 0
        skipped_ids: set[str] = set()
        real_ids.clear()

        if provider == "none":
            ranked = sorted(avail, key=lambda i: order[i])
            source = "coin flip"
            k = remaining  # any Point
        else:
            freqs: dict[str, float] = {}
            for tile in tiles:
                if atoms:
                    try:
                        freqs.update(atom_frequencies(tile))
                        continue
                    except SimulatorFailure as fail:
                        skipped_now += 1
                        result.skipped_tiles += 1
                        skipped_ids.update(tile)
                        log.add(round, "atoms", "skip", list(tile), message=str(fail))
                freqs.update(annealing_for(tile))
            ranked = _rank(freqs, avail)
            source = "atoms" if atoms else "annealing"

        rng = random.Random(f"{seed}|{round}|{step}")
        pick = ranked[rng.randrange(k)]
        informed = False
        if atoms:
            # Singleton pieces get 1.0 classically; skipped Tiles use annealing.
            if pick in real_ids and pick not in skipped_ids:
                informed = True
            else:
                source = "annealing"

        nbrs = adj[pick] & avail
        avail.discard(pick)
        avail -= nbrs
        result.picks.append(pick)
        log.add(round, source, "pick", [pick])
        if emit is not None:
            emit({"kind": "pick", "round": round, "step": step, "tile": None,
                  "picked": [pick], "removed": sorted(nbrs), "source": source,
                  "remaining": remaining, "top_group": k,
                  "rank": ranked.index(pick) + 1 if source == "atoms" else None,
                  "frequency": freqs[pick] if source == "atoms" else None})
        if nbrs:
            log.add(round, source, "remove", sorted(nbrs))
        cache.invalidate({pick} | nbrs)
        anneal_cache.invalidate({pick} | nbrs)
        tiles = shrink_tiles(tiles, avail)
        result.steps.append(
            StepInfo(step, pick, source, informed, remaining, k, skipped_now)
        )

    result.cache_hits = cache.hits - hits0
    result.simulator_calls = cache.simulator_calls - calls0
    timings["total"] = time.perf_counter() - t_start
    result.timings = timings
    return result
