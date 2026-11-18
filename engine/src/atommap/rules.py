"""Classical_Rules: the single simplicial rule (Requirements 4.1, 4.2, 4.4)."""

from __future__ import annotations

from typing import Iterable

from .graph import ConflictGraph
from .log import DecisionLog

SIMPLICIAL = "simplicial"


def apply_rules(
    graph: ConflictGraph,
    available: set[str],
    log: DecisionLog,
    round: int,
    adjacency: dict[str, set[str]] | None = None,
) -> list[str]:
    """Apply the simplicial rule until nothing changes.

    A Point is simplicial when its available neighbours are all joined to
    each other (a clique); an isolated Point qualifies. The Point is picked
    and its available neighbours are removed. `available` is modified in
    place. Each action is logged (a `pick` entry, then a `remove` entry when
    neighbours exist), with source "rule" and rule name "simplicial".
    Points are scanned in request order, restarting after every action, so
    the result is deterministic. Returns the picked ids in order.
    """
    adj = adjacency if adjacency is not None else graph.adjacency()
    picked: list[str] = []
    changed = True
    while changed:
        changed = False
        for p in graph.nodes:
            if p not in available:
                continue
            nbrs = adj[p] & available
            if not _is_clique(nbrs, adj):
                continue
            available.discard(p)
            available -= nbrs
            picked.append(p)
            log.add(round, "rule", "pick", [p], rule=SIMPLICIAL)
            if nbrs:
                log.add(
                    round, "rule", "remove", sorted(nbrs), rule=SIMPLICIAL
                )
            changed = True
            break
    return picked


def _is_clique(nodes: Iterable[str], adj: dict[str, set[str]]) -> bool:
    nodes = list(nodes)
    for i, a in enumerate(nodes):
        na = adj[a]
        for b in nodes[i + 1 :]:
            if b not in na:
                return False
    return True
