"""Property 2: Rounds are maximal.

**Validates: Requirements 3.7, 7.4, 7.5**

For any valid request and any Competitor except Atoms_Alone (Hybrid,
Annealing_Rules, Coin_Flip_Rules), including runs where the Simulator fails
for some or all Tiles, no Point that was available to a Round (not picked in
an earlier Round) and was not picked in it can be added without a conflict
with that Round's picks.
"""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from atommap.competitors import ANNEALING_RULES, COIN_FLIP_RULES, HYBRID, run_competitors
from atommap.graph import build_graph
from atommap.model import CompetitorResult
from fake_sim import FakeSimulator
from test_prop_rounds import requests

LOOP_COMPETITORS = (HYBRID, ANNEALING_RULES, COIN_FLIP_RULES)


class AlwaysFailSimulator:
    """Every Tile raises."""

    def run_tile(self, positions_um, seed):
        raise RuntimeError("simulator down")


def _assert_maximal(req, res, names):
    graph = build_graph(req)
    nbrs: dict[str, set[str]] = {p.id: set() for p in req.points}
    for a, b in graph.edges:
        nbrs[a].add(b)
        nbrs[b].add(a)
    for name in names:
        c = res.competitors[name]
        assert isinstance(c, CompetitorResult), c
        used: set[str] = set()
        for rnd in c.rounds:
            picks = set(rnd.picks)
            for v in nbrs:
                if v in used or v in picks:
                    continue
                assert nbrs[v] & picks, (
                    f"{name}: round {rnd.channel} could still add {v}"
                )
            used |= picks


SETTINGS = settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


@SETTINGS
@given(req=requests(), fail_mask=st.integers(0, 2**12 - 1))
def test_rounds_are_maximal_with_some_failing_tiles(req, fail_mask):
    probe = FakeSimulator()
    run_competitors(req, probe, (HYBRID,))  # only Hybrid uses the Simulator
    seen = sorted(set(probe.seeds_seen))
    fail = [s for i, s in enumerate(seen) if (fail_mask >> (i % 11)) & 1]
    if not (fail_mask >> 11) & 1:
        fail = []
    res = run_competitors(req, FakeSimulator(fail_seeds=fail), LOOP_COMPETITORS)
    _assert_maximal(req, res, LOOP_COMPETITORS)


@SETTINGS
@given(req=requests())
def test_rounds_are_maximal_when_all_tiles_fail(req):
    res = run_competitors(req, AlwaysFailSimulator(), LOOP_COMPETITORS)
    _assert_maximal(req, res, LOOP_COMPETITORS)
    assert res.competitors[HYBRID].stats.quantum_picks == 0
