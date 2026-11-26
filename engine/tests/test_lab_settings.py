"""Lab_Settings (experience spec, Requirement 17): validation, plumbing, Properties 3 and 4.

Property 3: no `settings` and the default `settings` give the same result text.
Property 4: bad `settings` are refused with a plain reason, before any Simulator call.
"""

from __future__ import annotations

import json
import math

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

import atommap.api as api
from atommap import loop, model, simulator as sim_mod
from fake_sim import FakeSimulator
from test_prop_emit_neutral import canonical, raw_request
from test_prop_rounds import requests

SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

# The ring of Your map: with r 20 no Point is simplicial, so the Hybrid asks the atoms.
RING = [
    {"id": f"p{i}", "x": round(45 + 15 * math.cos(2 * math.pi * i / 8), 1),
     "y": round(30 + 15 * math.sin(2 * math.pi * i / 8), 1)}
    for i in range(8)
]


def ring_request(**extra) -> dict:
    return {"points": RING, "mode": "place", "graph": {"r": 20.0}, "seed": 4, **extra}


def run(raw: dict, sim=None, events=None):
    text = api.run(json.dumps(raw), emit=None if events is None else events.append,
                   simulator=sim if sim is not None else FakeSimulator())
    return json.loads(text), text


# ---------------------------------------------------------------- the defaults


def test_the_defaults_are_the_measured_defaults():
    assert model.DEFAULT_SHOTS == sim_mod.SHOTS == 100
    assert model.DEFAULT_TOP_SHARE == loop.TOP_SHARE == 0.4
    assert model.Settings() == model.Settings(shots=100, top_share=0.4)


def test_no_settings_keeps_the_old_two_argument_simulator_call():
    """Without `settings` the Engine never passes `shots`, so an old simulator still works."""

    class TwoArgs(FakeSimulator):
        def run_tile(self, positions_um, seed):  # no shots keyword at all
            return super().run_tile(positions_um, seed)

    out, _ = run(ring_request(), sim=TwoArgs())
    assert out["ok"] is True


# Feature: experience, Property 3: Default settings change nothing
# **Validates: Requirements 17.3, 17.4**
@SETTINGS
@given(req=requests(), with_emit=st.booleans())
def test_default_settings_change_nothing(req, with_emit):
    raw = raw_request(req)
    plain_events: list = []
    lab_events: list = []
    _, plain = run(raw, events=plain_events if with_emit else None)
    _, lab = run({**raw, "settings": {"shots": 100, "top_share": 0.4}},
                 events=lab_events if with_emit else None)
    assert json.loads(plain)["ok"] is True
    assert canonical(plain) == canonical(lab)
    assert plain_events == lab_events


def test_default_settings_change_nothing_on_a_map_that_uses_the_atoms():
    """Not vacuous: on the ring the Hybrid really asks the atoms, and the text still matches."""
    events: list = []
    _, plain = run(ring_request(), events=events)
    _, lab = run(ring_request(settings={"shots": 100, "top_share": 0.4}))
    assert any(e["kind"] == "shots" for e in events)
    assert canonical(plain) == canonical(lab)
    # A partial settings object means the defaults for the missing key.
    _, only_shots = run(ring_request(settings={"shots": 100}))
    _, only_share = run(ring_request(settings={"top_share": 0.4}))
    _, empty = run(ring_request(settings={}))
    assert canonical(plain) == canonical(only_shots) == canonical(only_share) == canonical(empty)


# ---------------------------------------------------------------- plumbing


def test_shots_reach_every_simulator_call_of_the_run():
    fake = FakeSimulator()
    events: list = []
    out, _ = run(ring_request(settings={"shots": 30}), sim=fake, events=events)
    assert out["ok"] is True
    assert fake.calls > 0 and set(fake.shots_seen) == {30}
    freq = [e for e in events if e["kind"] == "frequencies"]
    assert freq and all(e["shots"] == 30 for e in freq)
    assert all(len(e["kept"]) == 30 for e in events if e["kind"] == "shots")
    # Both atom competitors used them.
    assert {e["competitor"] for e in freq} == {"Hybrid", "Atoms_Alone"}


# The loop competitors that rank Points (Coin_Flip_Rules has no ranking).
LOOP_RANKED = ("Hybrid", "Annealing_Rules")


def test_top_share_sets_the_top_group_of_the_loop_competitors():
    events: list = []
    run(ring_request(settings={"top_share": 1.0}), events=events)
    picks = [e for e in events if e["kind"] == "pick" and e["competitor"] in LOOP_RANKED and e["source"] != "rule"]
    assert {e["competitor"] for e in picks} == set(LOOP_RANKED)
    assert all(e["top_group"] == e["remaining"] for e in picks)  # 100%: all remaining Points
    events = []
    run(ring_request(settings={"top_share": 0.1}), events=events)
    picks = [e for e in events if e["kind"] == "pick" and e["competitor"] in LOOP_RANKED and e["source"] != "rule"]
    assert picks and all(e["top_group"] == max(1, round(0.1 * e["remaining"])) for e in picks)


def test_coin_flip_has_no_ranking_so_top_share_does_not_change_it():
    out_a, _ = run(ring_request(settings={"top_share": 0.1}))
    out_b, _ = run(ring_request(settings={"top_share": 1.0}))
    out_c, _ = run(ring_request())
    cf = lambda o: o["result"]["competitors"]["Coin_Flip_Rules"]["rounds"]  # noqa: E731
    assert cf(out_a) == cf(out_b) == cf(out_c)


def test_the_result_does_not_echo_the_settings():
    out, text = run(ring_request(settings={"shots": 50, "top_share": 0.7}))
    assert out["ok"] is True
    assert "top_share" not in text and '"settings"' not in text


# ---------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "bad, message",
    [
        ("fast", "settings must be an object with the keys shots, top_share, got 'fast'"),
        ([100], "settings must be an object with the keys shots, top_share, got [100]"),
        ({"steps": 400}, "settings has an unknown key: steps. Allowed keys: shots, top_share"),
        ({"shots": 100, "seed": 1}, "settings has an unknown key: seed. Allowed keys: shots, top_share"),
        ({"shots": 9}, "settings.shots must be an integer from 10 to 200, got 9"),
        ({"shots": 201}, "settings.shots must be an integer from 10 to 200, got 201"),
        ({"shots": 50.0}, "settings.shots must be an integer from 10 to 200, got 50.0"),
        ({"shots": True}, "settings.shots must be an integer from 10 to 200, got True"),
        ({"shots": "100"}, "settings.shots must be an integer from 10 to 200, got '100'"),
        ({"top_share": 0.09}, "settings.top_share must be a number from 0.1 to 1.0, got 0.09"),
        ({"top_share": 1.01}, "settings.top_share must be a number from 0.1 to 1.0, got 1.01"),
        ({"top_share": "40%"}, "settings.top_share must be a number from 0.1 to 1.0, got '40%'"),
        ({"top_share": False}, "settings.top_share must be a number from 0.1 to 1.0, got False"),
    ],
)
def test_each_bad_value_has_a_plain_message(bad, message):
    fake = FakeSimulator()
    out, _ = run(ring_request(settings=bad), sim=fake)
    assert out["ok"] is False
    assert out["error"]["type"] == "ValidationError"
    assert out["error"]["kind"] == "invalid_settings"
    assert out["error"]["message"] == message
    assert fake.calls == 0


def test_the_bounds_are_allowed():
    for s in ({"shots": 10}, {"shots": 200}, {"top_share": 0.1}, {"top_share": 1}, {"top_share": 1.0}):
        out, _ = run(ring_request(settings=s))
        assert out["ok"] is True, s


def test_nan_and_infinity_are_refused_as_invalid_json():
    """Valid JSON cannot hold NaN or infinity, so a request with them is refused before validation."""
    for v in (float("nan"), float("inf")):
        fake = FakeSimulator()
        out, _ = run(ring_request(settings={"top_share": v}), sim=fake)
        assert out["ok"] is False and out["error"]["kind"] == "invalid_json" and fake.calls == 0


def test_null_settings_is_refused_not_ignored():
    out, _ = run(ring_request(settings=None))
    assert out["ok"] is False and out["error"]["kind"] == "invalid_settings"


def _bad_settings():
    unknown = st.dictionaries(
        st.text(min_size=1, max_size=8).filter(lambda k: k not in model.SETTINGS_KEYS),
        st.integers(), min_size=1, max_size=2,
    )
    bad_shots = st.one_of(
        st.integers(max_value=9), st.integers(min_value=201),
        st.floats(allow_nan=False, allow_infinity=False),
        st.booleans(), st.text(max_size=4), st.none(),
    ).map(lambda v: {"shots": v})
    bad_share = st.one_of(
        st.floats(max_value=0.0999, allow_infinity=False), st.floats(min_value=1.0001, allow_infinity=False),
        st.booleans(), st.text(max_size=4), st.none(),
    ).map(lambda v: {"top_share": v})
    not_object = st.one_of(st.integers(), st.text(max_size=4), st.lists(st.integers(), max_size=2), st.none())
    return st.one_of(unknown, bad_shots, bad_share, not_object)


# Feature: experience, Property 4: Bad settings are refused with a reason
# **Validates: Requirements 17.1, 17.2**
@settings(max_examples=200, deadline=None)
@given(bad=_bad_settings())
def test_bad_settings_are_refused_with_a_reason(bad):
    fake = FakeSimulator()
    out, _ = run(ring_request(settings=bad), sim=fake)
    assert out["ok"] is False
    err = out["error"]
    assert err["kind"] == "invalid_settings"
    assert err["message"].startswith("settings")
    if isinstance(bad, dict) and set(bad) - set(model.SETTINGS_KEYS):
        assert "unknown key" in err["message"]
    elif isinstance(bad, dict):
        (key,) = bad
        assert f"settings.{key}" in err["message"]
    assert fake.calls == 0


@pytest.mark.slow
def test_the_real_simulator_takes_the_shots_setting():
    """The real Braket simulator returns as many shots as the lab asks for, and 100 by default."""
    from atommap.simulator import BraketSimulator

    sim = BraketSimulator()
    positions = [(0.0, 0.0), (6.0, 0.0)]
    assert len(sim.run_tile(positions, 7)) == 100
    assert len(sim.run_tile(positions, 7, shots=20)) == 20
    events: list = []
    out = json.loads(api.run(json.dumps(ring_request(settings={"shots": 20})), emit=events.append))
    assert out["ok"] is True
    assert {e["shots"] for e in events if e["kind"] == "frequencies"} == {20}
