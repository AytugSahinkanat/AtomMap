"""Unit tests for the new progress event fields (tutor spec, Requirements 1.2 to 1.6).

Fields: `shots` on `frequencies`; `remaining`, `top_group`, `rank`, `frequency` on `pick`.
"""

from __future__ import annotations

import math
import random

from atommap.atoms_alone import run_atoms_alone
from atommap.graph import build_graph
from atommap.log import DecisionLog
from atommap.loop import run_round, top_group_size
from atommap.model import Point, Request
from fake_sim import FakeSimulator
from test_progress_events import _cycle_with_leaf_request


class ShortSimulator(FakeSimulator):
    """A FakeSimulator that returns only `n_shots` shots."""

    def __init__(self, n_shots: int) -> None:
        super().__init__()
        self.n_shots = n_shots

    def run_tile(self, positions_um, seed):
        return super().run_tile(positions_um, seed)[: self.n_shots]


def _round(provider, sim=None, request=None, seed=None):
    req = request or _cycle_with_leaf_request()
    graph = build_graph(req)
    events: list = []
    if provider == "atoms" and sim is None:
        sim = FakeSimulator()
    run_round(
        graph, req.points, req.r, graph.nodes, DecisionLog("channel_plan", graph.nodes),
        1, req.seed if seed is None else seed, provider, sim, None, events.append,
    )
    return events


def _picks(events):
    return [e for e in events if e["kind"] == "pick"]


# --- shots (Requirements 1.5, 1.6) ---


def test_loop_frequencies_shots_equals_simulator_shot_count():
    for n_shots in (100, 37, 1):
        events = _round("atoms", ShortSimulator(n_shots))
        freq = [e for e in events if e["kind"] == "frequencies"]
        assert freq
        assert all(e["shots"] == n_shots for e in freq)


def test_atoms_alone_frequencies_shots_equals_simulator_shot_count():
    req = _cycle_with_leaf_request()
    graph = build_graph(req)
    order = {pid: i for i, pid in enumerate(graph.nodes)}
    for n_shots in (100, 25):
        events: list = []
        run_atoms_alone(
            req.points, graph.edges, req.r, graph.nodes, order,
            ShortSimulator(n_shots), 0, None, 1, events.append,
        )
        freq = [e for e in events if e["kind"] == "frequencies"]
        assert freq
        assert all(e["shots"] == n_shots for e in freq)


# --- fields per source (Requirements 1.2, 1.3, 1.4, 1.5) ---


def test_rule_pick_has_remaining_and_null_others():
    for provider in ("atoms", "annealing", "none"):
        rules = [e for e in _picks(_round(provider)) if e["source"] == "rule"]
        assert rules
        for e in rules:
            assert isinstance(e["remaining"], int) and e["remaining"] >= 1
            assert e["top_group"] is None and e["rank"] is None and e["frequency"] is None
        # 8-cycle + leaf pair: 10 Points undecided before the first rule pick
        assert rules[0]["remaining"] == 10


def test_annealing_pick_has_remaining_and_top_group_but_no_rank_or_frequency():
    loop_picks = [e for e in _picks(_round("annealing")) if e["source"] == "annealing"]
    assert loop_picks
    first = loop_picks[0]
    assert first["remaining"] == 8
    assert first["top_group"] == top_group_size(8)
    assert first["rank"] is None and first["frequency"] is None


def test_coin_flip_pick_top_group_is_remaining_and_no_rank_or_frequency():
    loop_picks = [e for e in _picks(_round("none")) if e["source"] == "coin flip"]
    assert loop_picks
    first = loop_picks[0]
    assert first["remaining"] == 8
    assert first["top_group"] == first["remaining"]
    assert first["rank"] is None and first["frequency"] is None


def test_atoms_pick_has_all_four_fields_consistent_with_frequencies_event():
    events = _round("atoms")
    first = next(e for e in _picks(events) if e["source"] == "atoms")
    assert first["remaining"] == 8 and first["top_group"] == top_group_size(8)
    freqs: dict = {}
    for e in events:
        if e["kind"] == "frequencies" and e["step"] == first["step"]:
            freqs.update(e["frequencies"])
    ranked = sorted(freqs, key=lambda i: (-freqs[i], i))
    pid = first["picked"][0]
    assert first["rank"] == ranked.index(pid) + 1
    assert first["rank"] <= first["top_group"]
    assert first["frequency"] == freqs[pid]


def test_atoms_alone_pick_has_all_four_fields_null():
    req = _cycle_with_leaf_request()
    graph = build_graph(req)
    order = {pid: i for i, pid in enumerate(graph.nodes)}
    events: list = []
    run_atoms_alone(
        req.points, graph.edges, req.r, graph.nodes, order, FakeSimulator(), 0, None, 1, events.append
    )
    picks = _picks(events)
    assert picks
    for e in picks:
        assert e["source"] == "atoms"
        for key in ("remaining", "top_group", "rank", "frequency"):
            assert key in e and e[key] is None


# --- a Point alone in its group (Requirements 1.3, 1.4) ---


def _singleton_request(trial: int = 391) -> Request:
    """Seeded random map. Found by search: trial 391 (26 Points) picks a Point
    alone in its group; trial 103 (33 Points) makes an atoms pick while another
    Point is alone in its group and ranked ahead of it. Such a Point has no atom,
    no `frequencies` event and frequency 1.0."""
    rnd = random.Random(trial)
    n = rnd.randint(11, 40)
    side = rnd.choice([2, 3, 4, 6])
    pts = [Point(f"p{i:02d}", rnd.random() * side, rnd.random() * side) for i in range(n)]
    edges = [
        (a.id, b.id)
        for i, a in enumerate(pts)
        for b in pts[i + 1:]
        if math.hypot(a.x - b.x, a.y - b.y) < 1.0
    ]
    return Request(tuple(pts), "channel_plan", 1.0, tuple(edges), trial)


def _scan_atoms_ranks(trial: int) -> tuple[int, int, int]:
    """Replay the events of one atoms round and check every atoms pick made while
    other Points are alone in their group. Returns (atoms picks checked,
    singleton picks seen, atoms picks with a singleton ranked ahead).

    Frequencies are rebuilt as the loop sees them: a `frequencies` event is sent
    only on a real Simulator call, and its values stay valid until one of its
    Points leaves (the cache). A remaining Point with no such value is alone in
    its group: frequency 1.0, no event.
    """
    req = _singleton_request(trial)
    events = _round("atoms", request=req)
    avail = {p.id for p in req.points}
    known: dict[frozenset, dict] = {}  # part ids -> frequencies, like the cache
    checked = singleton_picks = 0
    counted = 0  # atoms picks with a singleton ranked ahead of them
    for e in events:
        if e["kind"] == "frequencies":
            known[frozenset(e["tile"])] = dict(e["frequencies"])
            continue
        if e["kind"] != "pick":
            continue
        pid = e["picked"][0]
        if e["source"] != "rule":
            freqs = {i: v for part in known.values() for i, v in part.items()}
            singles = avail - set(freqs)
            if pid in singles:
                singleton_picks += 1
                assert e["source"] == "annealing"
                assert e["rank"] is None and e["frequency"] is None
            elif e["source"] == "atoms" and singles:
                full = {**freqs, **{i: 1.0 for i in singles}}
                before = sum(
                    1 for i in full if i != pid and (-full[i], i) < (-full[pid], pid)
                )
                assert e["rank"] == before + 1  # the singletons are counted
                if any(full[i] > full[pid] or (full[i] == full[pid] and i < pid) for i in singles):
                    counted += 1
                assert e["frequency"] == freqs[pid]
                checked += 1
        gone = {pid, *e["removed"]}
        avail -= gone
        known = {k: v for k, v in known.items() if k.isdisjoint(gone)}
    return checked, singleton_picks, counted


def test_atoms_pick_rank_counts_other_points_alone_in_their_group():
    checked, _, counted = _scan_atoms_ranks(103)
    assert checked, "scenario must contain an atoms pick while other Points are alone in their group"
    assert counted, "a Point alone in its group must be ranked ahead of the atoms pick"


def test_point_alone_in_its_group_is_picked_classically_with_null_rank_and_frequency():
    _, singleton_picks, _ = _scan_atoms_ranks(391)
    assert singleton_picks, "scenario must contain a pick of a Point alone in its group"
