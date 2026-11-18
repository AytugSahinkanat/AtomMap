"""Property 10: Duplicate edges do not change the result.

Feature: engine, Property 10: Duplicate edges do not change the result

**Validates: Requirements 2.10**
"""

import math

from hypothesis import given, settings, strategies as st

from atommap.graph import build_graph
from atommap.model import validate_request


@st.composite
def edge_requests(draw):
    """A request dict with explicit edges (disk graph with random edits),
    plus a variant with repeated and reversed edges."""
    n = draw(st.integers(min_value=0, max_value=12))
    coord = st.floats(min_value=0, max_value=60, allow_nan=False, allow_infinity=False)
    pts = [{"id": f"p{i}", "x": draw(coord), "y": draw(coord)} for i in range(n)]
    r = draw(st.floats(min_value=1, max_value=30, allow_nan=False, allow_infinity=False))

    all_pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    disk = {
        (i, j)
        for i, j in all_pairs
        if math.hypot(pts[i]["x"] - pts[j]["x"], pts[i]["y"] - pts[j]["y"]) < r
    }
    # Non-disk graph: flip membership of a random subset of pairs.
    flips = set(draw(st.sets(st.sampled_from(all_pairs)))) if all_pairs else set()
    base = sorted(disk ^ flips)
    base_edges = [[pts[i]["id"], pts[j]["id"]] for i, j in base]

    # Variant: each edge repeated 1-3 times, random orientation, shuffled.
    variant = []
    for e in base_edges:
        for _ in range(draw(st.integers(min_value=1, max_value=3))):
            variant.append(list(reversed(e)) if draw(st.booleans()) else list(e))
    variant = draw(st.permutations(variant)) if variant else []

    def req(edges):
        return {
            "points": pts,
            "mode": draw_mode,
            "graph": {"r": r, "edges": edges},
            "seed": 1,
        }

    draw_mode = draw(st.sampled_from(["channel_plan", "place"]))
    return req(base_edges), req([list(e) for e in variant])


@settings(max_examples=200, deadline=None)
@given(edge_requests())
def test_duplicate_edges_do_not_change_graph(pair):
    once, repeated = pair
    g_once = build_graph(validate_request(once))
    g_rep = build_graph(validate_request(repeated))
    assert g_rep == g_once
    assert g_rep.nodes == g_once.nodes
    assert g_rep.edges == g_once.edges
