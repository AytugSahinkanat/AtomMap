"""Property 5: Same input and Seed give identical results.

**Validates: Requirements 5.4, 8.1, 8.5, 11.1, 12.4**

For any valid request, two runs with the same Seed give identical serialized
results, with a fresh or a pre-warmed cache, and the four Competitors leave the
input unchanged. Only `stats.timings` (wall-clock seconds) is stripped before
comparing; every other field, including braket_calls and cache_hits, is compared.
"""

from __future__ import annotations

import copy
import json

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from atommap.competitors import COIN_FLIP_RULES, COMPETITORS, run_competitors
from atommap.graph import build_graph
from atommap.log import DecisionLog
from atommap.loop import run_round
from atommap.simulator import FrequencyCache
from fake_sim import FakeSimulator
from test_prop_rounds import requests

SETTINGS = settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


def canonical(result, names=COMPETITORS) -> str:
    """Serialized result with stats.timings removed (the only stripped field)."""
    d = result.to_dict()
    for comp in d["competitors"].values():
        if "stats" in comp:
            comp["stats"].pop("timings")
    return json.dumps(d, sort_keys=True)


def fail_seeds_for(req, fail_mask):
    probe = FakeSimulator()
    run_competitors(req, probe)
    seen = sorted(set(probe.seeds_seen))
    fail = [s for i, s in enumerate(seen) if (fail_mask >> (i % 11)) & 1]
    return fail if (fail_mask >> 11) & 1 else []


@SETTINGS
@given(req=requests(), fail_mask=st.integers(0, 2**12 - 1))
def test_same_request_same_seed_same_result(req, fail_mask):
    fail = fail_seeds_for(req, fail_mask)
    before = copy.deepcopy(req)

    first = run_competitors(req, FakeSimulator(fail_seeds=fail))
    second = run_competitors(req, FakeSimulator(fail_seeds=fail))

    assert req == before, "request was modified"
    for name in COMPETITORS:
        assert not isinstance(first.competitors[name], dict), first.competitors[name]
    assert canonical(first) == canonical(second)

    # Coin_Flip_Rules explicitly, twice more (Req. 8.5).
    coin = [
        canonical(run_competitors(req, FakeSimulator(fail_seeds=fail), (COIN_FLIP_RULES,)))
        for _ in range(2)
    ]
    assert coin[0] == coin[1]
    assert req == before


@SETTINGS
@given(req=requests(), fail_mask=st.integers(0, 2**12 - 1))
def test_prewarmed_cache_gives_same_round(req, fail_mask):
    fail = fail_seeds_for(req, fail_mask)
    graph = build_graph(req)
    ids = [p.id for p in req.points]

    def one(cache):
        log = DecisionLog(req.mode, ids)
        res = run_round(
            graph, req.points, req.r, set(ids), log, 1, req.seed, "atoms",
            FakeSimulator(fail_seeds=fail), cache,
        )
        steps = [
            (s.step, s.pick, s.source, s.atom_informed, s.remaining, s.top_group, s.skipped_tiles)
            for s in res.steps
        ]
        return (
            res.picks, res.rule_picks, steps, res.splits, res.skipped_tiles,
            res.layout_fallbacks, [e.to_dict() for e in log.entries()],
        )

    shared = FrequencyCache()
    fresh = one(FrequencyCache())
    warm_first = one(shared)
    warm_second = one(shared)  # cache already used by a previous run
    assert fresh == warm_first == warm_second
