"""Property 1: Rounds are disjoint independent sets that partition the Points.

**Validates: Requirements 3.3, 3.4, 3.5, 3.6**

For any valid request and any Competitor, each Round's picks contain no two
Points joined by an edge, no Point is in more than one Round, and in
Channel_Plan the picked Points plus five_ghz_only equal the input Points with
no overlap. In Place, five_ghz_only is None.
"""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from atommap.competitors import COMPETITORS, run_competitors
from atommap.graph import build_graph
from atommap.model import CompetitorResult, Point, Request
from atommap.physics import blockade_radius_m
from fake_sim import FakeSimulator

CHANNELS = {"channel_plan": [1, 6, 11], "place": [1]}


@st.composite
def requests(draw):
    cols = draw(st.integers(2, 5))
    rows = draw(st.integers(2, 5))
    cells = [(i, j) for i in range(cols) for j in range(rows)]
    # Full lattice (no simplicial Point) or a random subset of it.
    if draw(st.booleans()):
        chosen = cells
    else:
        chosen = draw(
            st.lists(st.sampled_from(cells), unique=True, min_size=1, max_size=len(cells))
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
    if n < 2:
        return base
    flips = draw(
        st.lists(
            st.tuples(st.integers(0, n - 1), st.integers(0, n - 1)).filter(lambda t: t[0] != t[1]),
            max_size=10,
        )
    )
    for a, b in flips:
        edges ^= {(pts[min(a, b)].id, pts[max(a, b)].id)}
    return Request(pts, mode, r, tuple(sorted(edges)), seed)


@settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
@given(req=requests(), fail_mask=st.integers(0, 2**12 - 1))
def test_rounds_are_disjoint_independent_partition(req, fail_mask):
    # Probe run to learn the Tile seeds, then fail a subset on half the runs.
    probe = FakeSimulator()
    run_competitors(req, probe)
    seen = sorted(set(probe.seeds_seen))
    fail = [s for i, s in enumerate(seen) if (fail_mask >> (i % 11)) & 1]
    if not (fail_mask >> 11) & 1:
        fail = []

    res = run_competitors(req, FakeSimulator(fail_seeds=fail), COMPETITORS)
    graph = build_graph(req)
    all_ids = [p.id for p in req.points]

    for name in COMPETITORS:
        c = res.competitors[name]
        assert isinstance(c, CompetitorResult), c
        assert len(c.rounds) == len(CHANNELS[req.mode])
        if req.mode == "channel_plan":
            assert [r.channel for r in c.rounds] == [1, 6, 11]

        seen_ids: list[str] = []
        for rnd in c.rounds:
            picks = set(rnd.picks)
            assert len(picks) == len(rnd.picks), "repeated pick inside a Round"
            for a, b in graph.edges:
                assert not (a in picks and b in picks), f"{name}: edge {a}-{b} in one Round"
            seen_ids.extend(rnd.picks)
        assert len(set(seen_ids)) == len(seen_ids), f"{name}: Point in more than one Round"
        assert set(seen_ids) <= set(all_ids)

        if req.mode == "channel_plan":
            five = c.five_ghz_only
            assert five is not None
            assert len(set(five)) == len(five)
            assert not set(five) & set(seen_ids), "Point both picked and 5 GHz only"
            assert sorted(seen_ids + list(five)) == sorted(all_ids)
        else:
            assert c.five_ghz_only is None
