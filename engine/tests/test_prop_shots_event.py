"""Property 1 (experience spec): the shots match the frequencies.

**Validates: Requirements 6.1, 6.2, 6.4 (experience spec)**

For any valid request, every `shots` event comes right after a `frequencies`
event of the same Competitor, Round, step and Group, and for every Point of
the Group the share of `kept` lists that contain its index equals its
frequency exactly. The Shots_Event is the data the run animation replays, so
it must be the same repaired shots the frequencies came from.
"""

from __future__ import annotations

import json
import math

from hypothesis import HealthCheck, given, settings

import atommap.api as api
from atommap.simulator import SHOTS
from fake_sim import FakeSimulator
from test_prop_emit_neutral import raw_request
from test_prop_rounds import requests

SETTINGS = settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)


def check_shots_events(events: list[dict]) -> int:
    """Assert Property 1 on one run's events. Returns the number of shots events."""
    count = 0
    for i, e in enumerate(events):
        if e["kind"] == "frequencies":
            # Requirement 6.1: the shots event comes right after its frequencies event.
            nxt = events[i + 1]
            assert nxt["kind"] == "shots", f"event {i + 1} after a frequencies event is {nxt['kind']}"
        if e["kind"] != "shots":
            continue
        count += 1
        freq = events[i - 1]
        assert freq["kind"] == "frequencies"
        for key in ("competitor", "round", "step", "tile"):
            assert e[key] == freq[key], key
        tile = e["tile"]
        kept = e["kept"]
        assert len(kept) == freq["shots"], "one kept list per shot"
        for lst in kept:
            assert lst == sorted(set(lst)) and all(0 <= j < len(tile) for j in lst)
        n = len(kept)
        for j, pid in enumerate(tile):
            hits = sum(1 for lst in kept if j in lst)
            share = hits / n if n else 0.0
            # Exact: both sides are hits / n computed the same way.
            assert share == freq["frequencies"][pid], (pid, share, freq["frequencies"][pid])
    return count


# Feature: experience, Property 1: The shots match the frequencies
@SETTINGS
@given(req=requests())
def test_the_shots_match_the_frequencies(req):
    events: list = []
    out = json.loads(api.run(json.dumps(raw_request(req)), emit=events.append, simulator=FakeSimulator()))
    assert out["ok"] is True
    check_shots_events(events)


def test_a_tangled_map_sends_shots_for_both_atom_competitors():
    """Not vacuous: Hybrid and Atoms_Alone both send shots events with real content."""
    # The ring of Your map: with r 20 no Point is simplicial, so the Hybrid must ask the atoms.
    pts = [{"id": f"p{i}", "x": round(45 + 15 * math.cos(2 * math.pi * i / 8), 1), "y": round(30 + 15 * math.sin(2 * math.pi * i / 8), 1)} for i in range(8)]
    events: list = []
    text = json.dumps({"points": pts, "mode": "place", "graph": {"r": 20.0}, "seed": 3})
    assert json.loads(api.run(text, emit=events.append, simulator=FakeSimulator()))["ok"] is True
    assert check_shots_events(events) > 0
    by = {e["competitor"] for e in events if e["kind"] == "shots"}
    assert by == {"Hybrid", "Atoms_Alone"}
    shots = [e for e in events if e["kind"] == "shots"]
    assert all(len(e["kept"]) == SHOTS for e in shots)
    assert any(any(lst for lst in e["kept"]) for e in shots)


def test_no_shots_event_for_the_classical_competitors_and_no_cached_repeat():
    """Requirement 6.4: no shots without a real Simulator call (cache hits and single Points make none)."""
    # The ring of Your map: with r 20 no Point is simplicial, so the Hybrid must ask the atoms.
    pts = [{"id": f"p{i}", "x": round(45 + 15 * math.cos(2 * math.pi * i / 8), 1), "y": round(30 + 15 * math.sin(2 * math.pi * i / 8), 1)} for i in range(8)]
    events: list = []
    sim = FakeSimulator()
    text = json.dumps({"points": pts, "mode": "channel_plan", "graph": {"r": 20.0}, "seed": 5})
    assert json.loads(api.run(text, emit=events.append, simulator=sim))["ok"] is True
    for name in ("Annealing_Rules", "Coin_Flip_Rules"):
        assert not [e for e in events if e["competitor"] == name and e["kind"] == "shots"]
    simulates = [e for e in events if e["kind"] == "simulate"]
    shots = [e for e in events if e["kind"] == "shots"]
    assert len(shots) == len(simulates) == sim.calls
