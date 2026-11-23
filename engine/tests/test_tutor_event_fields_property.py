"""Property 5 of the tutor spec: event fields and emit neutrality.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7**
"""

from __future__ import annotations

import json

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

import atommap.api as api
from atommap.competitors import ANNEALING_RULES, ATOMS_ALONE, COIN_FLIP_RULES, HYBRID
from atommap.graph import build_graph
from atommap.log import DecisionLog
from atommap.loop import run_round
from fake_sim import FakeSimulator
from test_prop_emit_neutral import canonical, raw_request
from test_prop_rounds import requests

SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


class VariableShotsSimulator(FakeSimulator):
    """FakeSimulator that returns 1..100 shots per call (depends on the seed only)."""

    def __init__(self, offset: int, **kw) -> None:
        super().__init__(**kw)
        self.offset = offset
        self.returned: list[int] = []

    def run_tile(self, positions_um, seed):
        shots = super().run_tile(positions_um, seed)
        n = 1 + (seed * 7 + self.offset) % 100
        shots = shots[:n]
        self.returned.append(len(shots))
        return shots


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _check_pick_fields(e: dict) -> None:
    comp, src = e["competitor"], e["source"]
    for key in ("remaining", "top_group", "rank", "frequency"):
        assert key in e
    if comp == ATOMS_ALONE:
        assert src == "atoms"
        assert e["remaining"] is None and e["top_group"] is None
        assert e["rank"] is None and e["frequency"] is None
    elif src == "rule":
        assert _is_int(e["remaining"]) and e["remaining"] >= 1
        assert e["top_group"] is None and e["rank"] is None and e["frequency"] is None
    elif src in ("annealing", "coin flip"):
        assert _is_int(e["remaining"]) and _is_int(e["top_group"])
        assert 1 <= e["top_group"] <= e["remaining"]
        assert e["rank"] is None and e["frequency"] is None
    else:
        assert comp == HYBRID and src == "atoms"
        assert _is_int(e["remaining"]) and _is_int(e["top_group"])
        assert _is_int(e["rank"])
        assert 1 <= e["rank"] <= e["remaining"]
        assert 1 <= e["top_group"] <= e["remaining"]
        assert 0.0 <= e["frequency"] <= 1.0
    if comp == COIN_FLIP_RULES and src == "coin flip":
        assert e["top_group"] == e["remaining"]
    if comp == ANNEALING_RULES:
        assert src in ("rule", "annealing")
    if comp == COIN_FLIP_RULES:
        assert src in ("rule", "coin flip")


# Feature: tutor, Property 5: Progress events do not change picks, log or Stats, and carry well-formed fields
@SETTINGS
@given(req=requests(), offset=st.integers(0, 99))
def test_events_neutral_and_fields_well_formed(req, offset):
    text = json.dumps(raw_request(req))
    sim_plain = VariableShotsSimulator(offset)
    sim_emit = VariableShotsSimulator(offset)
    events: list = []
    plain = api.run(text, emit=None, simulator=sim_plain)
    with_emit = api.run(text, emit=events.append, simulator=sim_emit)
    assert json.loads(plain)["ok"] is True
    assert canonical(plain) == canonical(with_emit)

    picks = [e for e in events if e["kind"] == "pick"]
    assert picks
    for e in picks:
        _check_pick_fields(e)

    freq_shots = [e["shots"] for e in events if e["kind"] == "frequencies"]
    assert freq_shots == sim_emit.returned


# Feature: tutor, Property 5: Progress events do not change picks, log or Stats, and carry well-formed fields
@SETTINGS
@given(
    req=requests(),
    offset=st.integers(0, 99),
    provider=st.sampled_from(["atoms", "annealing", "none"]),
)
def test_top_group_matches_step_info(req, offset, provider):
    graph = build_graph(req)
    events: list = []
    sim = VariableShotsSimulator(offset) if provider == "atoms" else None
    res = run_round(
        graph, req.points, req.r, graph.nodes, DecisionLog(req.mode, graph.nodes),
        1, req.seed, provider, sim, None, events.append,
    )
    loop_picks = [e for e in events if e["kind"] == "pick" and e["source"] != "rule"]
    assert len(loop_picks) == len(res.steps)
    for e, info in zip(loop_picks, res.steps):
        assert e["step"] == info.step
        assert e["picked"] == [info.pick]
        assert e["top_group"] == info.top_group
        assert e["remaining"] == info.remaining
        assert e["source"] == info.source
        assert (e["rank"] is not None) == (e["source"] == "atoms")
    for e in events:
        if e["kind"] == "pick" and e["source"] == "rule":
            assert _is_int(e["remaining"]) and e["remaining"] >= 1
            assert e["top_group"] is None and e["rank"] is None and e["frequency"] is None
    if sim is not None:
        assert [e["shots"] for e in events if e["kind"] == "frequencies"] == sim.returned
