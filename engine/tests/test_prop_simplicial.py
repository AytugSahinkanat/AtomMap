"""Property 13: The simplicial rule is safe.

Feature: engine, Property 13: The simplicial rule is safe

**Validates: Requirements 4.1, 4.2, 12.2**
"""

import math
from itertools import combinations

from hypothesis import given, settings, strategies as st

from atommap.graph import build_graph
from atommap.log import DecisionLog
from atommap.model import validate_request
from atommap.rules import apply_rules


@st.composite
def graph_requests(draw):
    """Up to 14 Points; either a pure disk graph (r only) or a non-disk
    graph (disk edges with a random subset of pairs flipped)."""
    n = draw(st.integers(min_value=0, max_value=14))
    coord = st.floats(min_value=0, max_value=60, allow_nan=False, allow_infinity=False)
    pts = [{"id": f"p{i}", "x": draw(coord), "y": draw(coord)} for i in range(n)]
    r = draw(st.floats(min_value=1, max_value=40, allow_nan=False, allow_infinity=False))
    mode = draw(st.sampled_from(["channel_plan", "place"]))
    graph = {"r": r}
    if draw(st.booleans()):
        pairs = list(combinations(range(n), 2))
        disk = {
            (i, j)
            for i, j in pairs
            if math.hypot(pts[i]["x"] - pts[j]["x"], pts[i]["y"] - pts[j]["y"]) < r
        }
        flips = set(draw(st.sets(st.sampled_from(pairs)))) if pairs else set()
        graph["edges"] = [[pts[i]["id"], pts[j]["id"]] for i, j in sorted(disk ^ flips)]
    return {"points": pts, "mode": mode, "graph": graph, "seed": 1}


def brute_force_mis(nodes, adj):
    """Return one maximum independent set of `nodes` (list of ids)."""
    nodes = list(nodes)
    best: tuple[str, ...] = ()
    for k in range(len(nodes), 0, -1):
        if k <= len(best):
            break
        for combo in combinations(nodes, k):
            if all(b not in adj[a] for a, b in combinations(combo, 2)):
                return combo
    return best


@settings(max_examples=200, deadline=None)
@given(graph_requests())
def test_simplicial_rule_is_safe(raw):
    request = validate_request(raw)
    graph = build_graph(request)
    adj = graph.adjacency()

    full = brute_force_mis(graph.nodes, adj)

    available = set(graph.nodes)
    log = DecisionLog(request.mode, graph.nodes)
    picked = apply_rules(graph, available, log, 1, adj)

    rest = brute_force_mis(sorted(available), adj)
    combined = list(picked) + list(rest)

    # Combined picks form an independent set with no repeats.
    assert len(set(combined)) == len(combined)
    for a, b in combinations(combined, 2):
        assert b not in adj[a], f"{a} and {b} conflict"

    # Same maximum size as brute force on the whole graph.
    assert len(combined) == len(full)
