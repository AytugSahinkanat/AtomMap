"""Property 12: Atoms_Alone is independent and reports its gaps exactly.

Feature: engine, Property 12: Atoms_Alone is independent and reports its gaps exactly

**Validates: Requirements 8.2, 8.3**

For any valid request, the Atoms_Alone picks in each Round are an independent
set of the Conflict_Graph, and the reported gaps are exactly the Points
available to that Round that are not picked and have no picked neighbour. The
expected gaps are computed here from the graph alone, not from engine code
other than `build_graph`.
"""

from __future__ import annotations

import math
from itertools import combinations

from fake_sim import FakeSimulator
from hypothesis import assume, given, settings, strategies as st

from atommap.atoms_alone import LABEL, run_atoms_alone
from atommap.competitors import ATOMS_ALONE, run_competitors
from atommap.graph import build_graph
from atommap.log import CHANNELS, DecisionLog
from atommap.model import validate_request

EXPECTED_LABEL = "atoms alone (in pieces of 10 or less in simulation)"


@st.composite
def graph_requests(draw):
    """Up to 12 Points. Either a pure disk graph (r only) or a non-disk graph:
    the disk edges with a random subset of pairs flipped (edges added or removed)."""
    n = draw(st.integers(min_value=0, max_value=12))
    coord = st.floats(min_value=0, max_value=60, allow_nan=False, allow_infinity=False)
    pts = [{"id": f"p{i:02d}", "x": draw(coord), "y": draw(coord)} for i in range(n)]
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
    seed = draw(st.integers(min_value=0, max_value=1000))
    return {"points": pts, "mode": mode, "graph": graph, "seed": seed}


def _adjacency(graph):
    return graph.adjacency()


def _expected_gaps(graph, adj, available, picked):
    """Available, not picked, and no picked neighbour, in request order."""
    picked = set(picked)
    return [
        n for n in graph.nodes
        if n in available and n not in picked and not (adj[n] & picked)
    ]


def _assert_independent(picks, adj):
    assert len(set(picks)) == len(picks), "a Point was picked twice"
    for a, b in combinations(picks, 2):
        assert b not in adj[a], f"{a} and {b} conflict but were both picked"


def _failing_sim(request, graph, data):
    """A FakeSimulator that fails for a random subset of the seeds a probe run saw.

    Seeds depend on the parts, which depend on the Points and edges, so the
    probe (a run without failures) tells us real seeds of Round 1.
    """
    probe = FakeSimulator()
    run_competitors(request, probe, names=(ATOMS_ALONE,))
    seen = sorted(set(probe.seeds_seen))
    if not seen or not data.draw(st.booleans()):
        return FakeSimulator()
    chosen = data.draw(st.sets(st.sampled_from(seen)))
    return FakeSimulator(fail_seeds=chosen)


@settings(max_examples=150, deadline=None)
@given(raw=graph_requests(), data=st.data())
def test_atoms_alone_single_round_direct(raw, data):
    """run_atoms_alone on one Round with a random available subset."""
    request = validate_request(raw)
    graph = build_graph(request)
    adj = _adjacency(graph)
    assume(graph.nodes)
    available = set(data.draw(st.sets(st.sampled_from(graph.nodes), min_size=1)))
    sim = _failing_sim(request, graph, data)
    order = {pid: i for i, pid in enumerate(graph.nodes)}
    log = DecisionLog("channel_plan", graph.nodes)

    res = run_atoms_alone(
        request.points, sorted(graph.edges), request.r, available, order,
        sim, request.seed, log, 1,
    )

    picked = list(res.picked)
    assert set(picked) <= available
    _assert_independent(picked, adj)
    assert list(res.gaps) == _expected_gaps(graph, adj, available, picked)
    assert res.gap_count == len(res.gaps)
    assert res.label == LABEL == EXPECTED_LABEL
    assert all(e.source == "atoms" for e in log), "Atoms_Alone logged a non-atoms entry"
    assert not any(e.source == "rule" for e in log)
    logged = [p for e in log if e.action == "pick" for p in e.points]
    assert logged == picked


@settings(max_examples=150, deadline=None)
@given(raw=graph_requests(), data=st.data())
def test_atoms_alone_via_run_competitors(raw, data):
    """Full run in both Modes: per-Round independence, exact gaps, one pick per Point."""
    request = validate_request(raw)
    graph = build_graph(request)
    adj = _adjacency(graph)
    sim = _failing_sim(request, graph, data)

    result = run_competitors(request, sim, names=(ATOMS_ALONE,))
    comp = result.competitors[ATOMS_ALONE]
    assert not isinstance(comp, dict), f"Atoms_Alone errored: {comp}"

    assert comp.label == "simulation"  # Competitor result label (Honesty rule 2)
    assert [r.channel for r in comp.rounds] == list(CHANNELS[request.mode])

    remaining = set(graph.nodes)
    all_picks: list[str] = []
    expected_gaps: list[str] = []
    for rnd in comp.rounds:
        _assert_independent(rnd.picks, adj)
        assert set(rnd.picks) <= remaining, "Round picked a Point from an earlier Round"
        expected_gaps += _expected_gaps(graph, adj, remaining, rnd.picks)
        remaining -= set(rnd.picks)
        all_picks += rnd.picks

    # Each Point is picked at most once across Rounds.
    assert len(set(all_picks)) == len(all_picks)

    # Gaps are aggregated in Stats.gaps, Round by Round, each Round in request order.
    assert comp.stats.gaps == expected_gaps

    if request.mode == "channel_plan":
        assert comp.five_ghz_only == [n for n in graph.nodes if n in remaining]
    else:
        assert comp.five_ghz_only is None

    # Log: atoms only, no rule entries; its picks match the Rounds.
    assert all(e.source == "atoms" for e in comp.decision_log)
    assert not any(e.source == "rule" for e in comp.decision_log)
    for rnd in comp.rounds:
        logged = [
            p for e in comp.decision_log
            if e.action == "pick" and e.round == rnd.channel
            for p in e.points
        ]
        assert logged == rnd.picks

    # Every pick is attributed to atoms, so the quantum share is 1 (or 0 with no picks).
    assert comp.stats.total_picks == len(all_picks)
    assert comp.stats.quantum_picks == len(all_picks)
    assert comp.stats.quantum_share == (1.0 if all_picks else 0.0)
