"""Property 4: Stats agree with the Decision_Log.

**Validates: Requirements 6.11, 7.3, 10.1, 10.2, 10.3, 10.7, 10.9**

For any valid request and any Competitor, the Stats picks per Round and per
source, Quantum_Share, atoms_not_needed, splits and skipped Tiles equal the
values recomputed here from that Competitor's own Decision_Log. mismatches is 0.

Atom-informed picks: in the loop a pick after a skipped Tile is logged with
source "annealing", so atom-informed picks are exactly the pick entries with
source "atoms" (Hybrid). Atoms_Alone picks are all atoms. Annealing_Rules and
Coin_Flip_Rules have none. Nothing here calls stats.py.
"""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from atommap.competitors import (
    ATOMS_ALONE, COMPETITORS, HYBRID, run_competitors,
)
from atommap.graph import build_graph
from atommap.model import CompetitorResult, Point, Request
from atommap.physics import blockade_radius_m
from fake_sim import FakeSimulator

CHANNELS = {"channel_plan": [1, 6, 11], "place": [1]}
SOURCES = ["rule", "atoms", "annealing", "coin flip"]


@st.composite
def requests(draw):
    cols = draw(st.integers(2, 4))
    rows = draw(st.integers(2, 4))
    cells = [(i, j) for i in range(cols) for j in range(rows)]
    chosen = draw(
        st.lists(st.sampled_from(cells), unique=True, min_size=4, max_size=min(12, len(cells)))
    )
    r = blockade_radius_m()
    step = draw(st.sampled_from([0.6, 0.8, 0.95])) * r
    pts = tuple(
        Point(f"p{k:02d}", i * step, j * step) for k, (i, j) in enumerate(chosen)
    )
    mode = draw(st.sampled_from(["channel_plan", "place"]))
    seed = draw(st.integers(0, 1000))
    base = Request(pts, mode, r, None, seed)
    if draw(st.booleans()):  # disk graph
        return base
    # Non-disk graph: toggle random pairs of the disk graph's edges.
    edges = set(build_graph(base).edges)
    n = len(pts)
    flips = draw(
        st.lists(
            st.tuples(st.integers(0, n - 1), st.integers(0, n - 1)).filter(lambda t: t[0] != t[1]),
            max_size=8,
        )
    )
    for a, b in flips:
        pair = (pts[min(a, b)].id, pts[max(a, b)].id)
        edges ^= {pair}
    return Request(pts, mode, r, tuple(sorted(edges)), seed)


def _recompute(result: CompetitorResult, mode: str):
    channels = CHANNELS[mode]
    per_round = {c: 0 for c in channels}
    per_source = {s: 0 for s in SOURCES}
    splits = skips = 0
    for e in result.decision_log:
        if e.action == "pick":
            per_round[e.round] += len(e.points)
            per_source[e.source] += len(e.points)
        elif e.action == "split":
            splits += 1
        elif e.action == "skip":
            skips += 1
    total = sum(per_round.values())
    if result.name == ATOMS_ALONE:
        quantum = total
    elif result.name == HYBRID:
        quantum = per_source["atoms"]
    else:
        quantum = 0
    return [per_round[c] for c in channels], per_source, splits, skips, quantum, total


@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
@given(req=requests(), fail_mask=st.integers(0, 2**12 - 1))
def test_stats_agree_with_decision_log(req, fail_mask):
    # Probe run to learn which Tile seeds the simulator is asked for, then fail
    # a chosen subset of them so some runs have skipped Tiles.
    probe = FakeSimulator()
    run_competitors(req, probe)
    seen = sorted(set(probe.seeds_seen))
    fail = [s for i, s in enumerate(seen) if (fail_mask >> (i % 12)) & 1]
    # Half of the masks (bit 11 clear) mean no failures at all.
    if not (fail_mask >> 11) & 1:
        fail = []

    res = run_competitors(req, FakeSimulator(fail_seeds=fail), COMPETITORS)

    for name in COMPETITORS:
        c = res.competitors[name]
        assert isinstance(c, CompetitorResult), c
        per_round, per_source, splits, skips, quantum, total = _recompute(c, req.mode)
        s = c.stats
        assert s.picks_per_round == per_round
        assert s.picks_per_round == [len(r.picks) for r in c.rounds]
        assert s.picks_per_source == per_source
        assert s.total_picks == total
        assert s.quantum_picks == quantum
        expected_share = quantum / total if total else 0.0
        assert s.quantum_share == expected_share
        assert s.atoms_not_needed == (quantum == 0)
        assert s.splits == splits
        assert s.skipped_tiles == skips
        assert s.mismatches == 0
