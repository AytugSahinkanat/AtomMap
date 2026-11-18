"""Property 3: Decision_Log replay equals the picks.

**Validates: Requirements 4.2, 4.3, 4.4, 9.2, 9.3, 9.4, 9.8**

For any valid request and any Competitor, replaying the `pick` entries of each
Round in order gives exactly that Round's picks (same order, no repeats). Every
entry has a valid round, source and action and only request ids. `rule`
entries carry the rule name `simplicial`, other entries carry none. Inside a
Round no Point is picked after one of its neighbours. A `remove` entry of a
loop Competitor directly follows its `pick` with the same source. Hybrid makes
no "atoms" picks when every Tile fails.
"""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from atommap.competitors import (
    ANNEALING_RULES,
    ATOMS_ALONE,
    COIN_FLIP_RULES,
    COMPETITORS,
    HYBRID,
    run_competitors,
)
from atommap.graph import build_graph
from atommap.model import CompetitorResult
from fake_sim import FakeSimulator
from test_prop_rounds import CHANNELS, requests

LOOP_COMPETITORS = (HYBRID, ANNEALING_RULES, COIN_FLIP_RULES)
SOURCES = {"rule", "atoms", "annealing", "coin flip"}
ACTIONS = {"pick", "remove", "split", "skip"}

SETTINGS = settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


class AlwaysFailSimulator:
    def run_tile(self, positions_um, seed):
        raise RuntimeError("simulator down")


def _check(req, res, names):
    graph = build_graph(req)
    ids = {p.id for p in req.points}
    nbrs: dict[str, set[str]] = {i: set() for i in ids}
    for a, b in graph.edges:
        nbrs[a].add(b)
        nbrs[b].add(a)
    channels = CHANNELS[req.mode]

    for name in names:
        c = res.competitors[name]
        assert isinstance(c, CompetitorResult), c
        log = c.decision_log

        for e in log:
            assert e.round in channels, (name, e)
            assert e.source in SOURCES, (name, e)
            assert e.action in ACTIONS, (name, e)
            assert e.points and set(e.points) <= ids, (name, e)
            if e.source == "rule":
                assert e.rule == "simplicial", (name, e)
            else:
                assert e.rule is None, (name, e)

        for rnd in c.rounds:
            replay: list[str] = []
            picked: set[str] = set()
            for e in log:
                if e.round != rnd.channel or e.action != "pick":
                    continue
                for pid in e.points:
                    assert not nbrs[pid] & picked, (
                        f"{name}: {pid} picked after a neighbour in round {rnd.channel}"
                    )
                    picked.add(pid)
                    replay.append(pid)
            assert len(set(replay)) == len(replay), f"{name}: repeated pick in log"
            assert replay == list(rnd.picks), f"{name}: round {rnd.channel} replay differs"

        if name == ATOMS_ALONE:
            continue
        for i, e in enumerate(log):
            if e.action != "remove":
                continue
            assert i > 0, (name, e)
            prev = log[i - 1]
            assert prev.action == "pick" and len(prev.points) == 1, (name, prev, e)
            assert prev.source == e.source and prev.round == e.round, (name, prev, e)
            assert set(e.points) <= nbrs[prev.points[0]], (name, prev, e)


@SETTINGS
@given(req=requests(), fail_mask=st.integers(0, 2**12 - 1))
def test_log_replay_equals_picks(req, fail_mask):
    probe = FakeSimulator()
    run_competitors(req, probe, (HYBRID,))  # only Hybrid uses the Simulator here
    seen = sorted(set(probe.seeds_seen))
    fail = [s for i, s in enumerate(seen) if (fail_mask >> (i % 11)) & 1]
    if not (fail_mask >> 11) & 1:
        fail = []
    res = run_competitors(req, FakeSimulator(fail_seeds=fail), COMPETITORS)
    _check(req, res, COMPETITORS)


@SETTINGS
@given(req=requests())
def test_log_replay_when_all_tiles_fail_has_no_atoms_picks(req):
    res = run_competitors(req, AlwaysFailSimulator(), COMPETITORS)
    _check(req, res, COMPETITORS)
    for name in (HYBRID, ANNEALING_RULES, COIN_FLIP_RULES):
        for e in res.competitors[name].decision_log:
            assert not (e.source == "atoms" and e.action == "pick"), (name, e)
