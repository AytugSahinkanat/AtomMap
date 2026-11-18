"""Property 11: Result JSON round trip.

**Validates: Requirements 9.5, 9.7**

For any valid result (including ones with a Competitor error entry), the
serialized text parses with the standard json parser, contains only JSON types
(no NaN/Infinity), and serializing the parsed value again gives the same text.
The parsed value equals Result.to_dict().

model.py has no from_dict, so the round trip is text -> parse -> text.
"""

from __future__ import annotations

import json

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from atommap.competitors import ANNEALING_RULES, COIN_FLIP_RULES, COMPETITORS, HYBRID, run_competitors
from fake_sim import FakeSimulator
from test_loop import grid_request
from test_prop_rounds import requests


def _boom(ids, edges, seed):
    raise RuntimeError("provider broke")


def _dump(d) -> str:
    return json.dumps(d, allow_nan=False, sort_keys=True)


def _check(res) -> None:
    d = res.to_dict()
    text1 = _dump(d)  # raises ValueError on NaN/Infinity
    parsed = json.loads(text1, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
    text2 = _dump(parsed)
    assert text1 == text2
    assert parsed == json.loads(_dump(d))
    assert set(parsed["competitors"]) == set(COMPETITORS)
    for name, c in res.competitors.items():
        if isinstance(c, dict):
            assert parsed["competitors"][name] == c
            assert "error" in parsed["competitors"][name]


@settings(
    max_examples=120,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
@given(
    req=requests(),
    failing=st.lists(st.sampled_from([HYBRID, ANNEALING_RULES, COIN_FLIP_RULES]), unique=True, max_size=3),
)
def test_result_json_round_trip(req, failing):
    res = run_competitors(req, FakeSimulator(), providers={n: _boom for n in failing})
    _check(res)


def test_error_entry_is_present_and_round_trips():
    res = run_competitors(grid_request(6), FakeSimulator(), providers={ANNEALING_RULES: _boom})
    assert isinstance(res.competitors[ANNEALING_RULES], dict)
    _check(res)
