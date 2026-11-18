"""The four Competitors (Requirements 8.1, 8.5, 8.6, 8.7, 8.8, 9.1).

  Atoms_Alone       atoms only, no Classical_Rules (can leave gaps)
  Hybrid            atoms + simplicial rule (qReduMIS)
  Annealing_Rules   annealing + simplicial rule
  Coin_Flip_Rules   random picks + simplicial rule

Each Competitor gets its own graph, DecisionLog, FrequencyCache and Stats, and
works on copies of the input, so the request is never modified. A Competitor
that raises becomes `{"error": "<Type>: <message>"}`; the others still return.
"""

from __future__ import annotations

from typing import Callable, Optional

from .atoms_alone import AtomsAloneResult, run_atoms_alone
from .graph import ConflictGraph, build_graph
from .log import DecisionLog
from .loop import RoundResult, run_round
from .model import CompetitorResult, Request, Result
from .rounds import channels_for, drive_rounds
from .simulator import FrequencyCache, Simulator
from .stats import compute_atoms_alone_stats, compute_stats

__all__ = [
    "ATOMS_ALONE", "HYBRID", "ANNEALING_RULES", "COIN_FLIP_RULES", "COMPETITORS",
    "CITATION", "RESULT_LABEL", "run_competitor", "run_competitors",
]

ATOMS_ALONE = "Atoms_Alone"
HYBRID = "Hybrid"
ANNEALING_RULES = "Annealing_Rules"
COIN_FLIP_RULES = "Coin_Flip_Rules"
COMPETITORS = (ATOMS_ALONE, HYBRID, ANNEALING_RULES, COIN_FLIP_RULES)

RESULT_LABEL = "simulation"
CITATION = "Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5"

_PROVIDERS = {HYBRID: "atoms", ANNEALING_RULES: "annealing", COIN_FLIP_RULES: "none"}


def run_competitor(
    name: str,
    request: Request,
    simulator: Optional[Simulator],
    provider: Optional[object] = None,
) -> CompetitorResult:
    """Run one Competitor over all Rounds of the request's Mode.

    `provider` overrides the frequency provider of a loop Competitor (tests).
    """
    if name not in COMPETITORS:
        raise ValueError(f"Unknown competitor {name!r}")
    points = tuple(request.points)
    graph: ConflictGraph = build_graph(request)
    ids = [p.id for p in points]
    order = {pid: i for i, pid in enumerate(graph.nodes)}
    log = DecisionLog(request.mode, ids)
    channels = list(channels_for(request.mode))

    if name == ATOMS_ALONE:
        if simulator is None:
            raise ValueError("Atoms_Alone needs a Simulator")

        def run_alone(channel: int, avail: set):
            if not avail:
                return [], AtomsAloneResult(picked=(), gaps=())
            res = run_atoms_alone(
                points, sorted(graph.edges), request.r, avail, order,
                simulator, request.seed, log, channel,
            )
            return list(res.picked), res

        rounds, five, outs = drive_rounds(request.mode, ids, run_alone)
        stats = compute_atoms_alone_stats(log.entries(), outs, channels)
    else:
        prov = provider if provider is not None else _PROVIDERS[name]
        cache = FrequencyCache()  # one per Competitor run

        def run_loop(channel: int, avail: set):
            if not avail:
                return [], RoundResult(round=channel)
            res = run_round(
                graph, points, request.r, avail, log, channel,
                request.seed, prov, simulator, cache,
            )
            return list(res.picks), res

        rounds, five, outs = drive_rounds(request.mode, ids, run_loop)
        stats = compute_stats(log.entries(), outs, channels)

    return CompetitorResult(
        name=name,
        rounds=rounds,
        decision_log=log.entries(),
        stats=stats,
        label=RESULT_LABEL,
        five_ghz_only=five,
    )


def run_competitors(
    request: Request,
    simulator: Optional[Simulator],
    names: tuple[str, ...] = COMPETITORS,
    providers: Optional[dict[str, object]] = None,
) -> Result:
    """Run the Competitors on the same request; a failing one gets an error entry."""
    providers = providers or {}
    out: dict = {}
    for name in names:
        try:
            out[name] = run_competitor(name, request, simulator, providers.get(name))
        except Exception as exc:  # noqa: BLE001 - one Competitor must not sink the others
            out[name] = {"error": f"{type(exc).__name__}: {exc}"}
    return Result(meta={"citation": CITATION, "label": RESULT_LABEL}, competitors=out)
