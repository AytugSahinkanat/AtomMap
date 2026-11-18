"""Conflict_Graph construction (Requirements 2.2, 2.9, 2.10)."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .model import Request


@dataclass(frozen=True)
class ConflictGraph:
    nodes: tuple[str, ...]  # Point ids in request order
    edges: frozenset[tuple[str, str]]  # sorted pairs (a < b)

    def adjacency(self) -> dict[str, set[str]]:
        adj: dict[str, set[str]] = {n: set() for n in self.nodes}
        for a, b in self.edges:
            adj[a].add(b)
            adj[b].add(a)
        return adj


def build_graph(request: Request) -> ConflictGraph:
    """Build the Conflict_Graph of a validated Request.

    With `request.edges` None, two Points conflict when their distance is
    below r. Otherwise the given edges are used. Edges are stored as sorted
    pairs, so duplicates and reversed pairs collapse. Zero Points give an
    empty graph.
    """
    nodes = tuple(p.id for p in request.points)
    if request.edges is not None:
        edges = frozenset((a, b) if a < b else (b, a) for a, b in request.edges)
        return ConflictGraph(nodes, edges)

    pts = request.points
    found: set[tuple[str, str]] = set()
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < request.r:
                a, b = pts[i].id, pts[j].id
                found.add((a, b) if a < b else (b, a))
    return ConflictGraph(nodes, frozenset(found))
