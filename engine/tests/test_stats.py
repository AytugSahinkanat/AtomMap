"""Tests for run statistics (Requirements 10.1, 10.2, 10.3, 10.7, 10.8, 10.9)."""

from __future__ import annotations

import json

from atommap.atoms_alone import AtomsAloneResult
from atommap.log import DecisionLog
from atommap.loop import RoundResult, StepInfo
from atommap.stats import compute_atoms_alone_stats, compute_stats

IDS = [f"p{i}" for i in range(8)]


def step(n, pick, source, informed, skipped=0):
    return StepInfo(n, pick, source, informed, 5, 2, skipped)


def hybrid_fixture():
    log = DecisionLog("channel_plan", IDS)
    log.add(1, "rule", "pick", ["p0"], rule="simplicial")
    log.add(1, "atoms", "pick", ["p1"])
    log.add(1, "atoms", "remove", ["p2"])
    log.add(1, "atoms", "split", ["p3", "p4"], reason="layout")
    log.add(1, "atoms", "skip", ["p5", "p6"], message="boom")
    log.add(1, "annealing", "pick", ["p5"])
    log.add(6, "atoms", "pick", ["p7"])
    r1 = RoundResult(
        round=1,
        picks=["p0", "p1", "p5"],
        rule_picks=["p0"],
        steps=[step(1, "p1", "atoms", True), step(2, "p5", "annealing", False, 1)],
        splits=1, skipped_tiles=1, layout_fallbacks=2, cache_hits=3, simulator_calls=4,
        timings={"simulator": 0.5, "total": 1.0},
    )
    r6 = RoundResult(
        round=6, picks=["p7"], steps=[step(1, "p7", "atoms", True)],
        layout_fallbacks=1, cache_hits=1, simulator_calls=2,
        timings={"simulator": 0.25, "total": 0.5},
    )
    return log, [r1, r6]


def test_hybrid_stats():
    log, rrs = hybrid_fixture()
    s = compute_stats(log.entries(), rrs, rounds=[1, 6, 11])
    assert s.picks_per_round == [3, 1, 0]
    assert s.picks_per_source == {"rule": 1, "atoms": 2, "annealing": 1, "coin flip": 0}
    assert (s.quantum_picks, s.total_picks) == (2, 4)
    assert s.quantum_share == 0.5
    assert not s.atoms_not_needed
    assert (s.splits, s.skipped_tiles, s.mismatches) == (1, 1, 0)
    assert (s.braket_calls, s.cache_hits, s.layout_fallbacks) == (6, 4, 3)
    assert s.timings == {"simulator": 0.75, "total": 1.5}
    assert s.gaps is None
    json.dumps(s.to_dict())


def test_no_atom_picks_means_atoms_not_needed():
    log = DecisionLog("place", IDS)
    log.add(1, "rule", "pick", ["p0"], rule="simplicial")
    s = compute_stats(log.entries(), [RoundResult(round=1, picks=["p0"], rule_picks=["p0"])])
    assert s.quantum_share == 0.0 and s.atoms_not_needed
    assert s.splits == 0 and s.skipped_tiles == 0 and s.mismatches == 0
    assert s.to_dict()["atoms_not_needed"] is True


def test_empty_run_has_zero_share():
    s = compute_stats([], [], rounds=[1])
    assert s.quantum_share == 0.0 and s.atoms_not_needed and s.picks_per_round == [0]


def test_atoms_alone_stats_with_gaps():
    log = DecisionLog("place", IDS)
    log.add(1, "atoms", "pick", ["p0", "p1", "p2"])
    log.add(1, "atoms", "remove", ["p3"])
    log.add(1, "atoms", "skip", ["p4"], message="boom")
    res = AtomsAloneResult(
        picked=("p0", "p1", "p2"), gaps=("p4",), simulator_calls=2, skipped_parts=1,
        fallbacks=1, timings_s=(0.25, 0.5),
    )
    s = compute_atoms_alone_stats(log.entries(), [res])
    assert s.picks_per_round == [3]
    assert s.picks_per_source["atoms"] == 3
    assert s.quantum_share == 1.0 and s.quantum_picks == 3 and not s.atoms_not_needed
    assert s.skipped_tiles == 1 and s.braket_calls == 2 and s.layout_fallbacks == 1
    assert s.gaps == ["p4"]
    assert s.timings == {"simulator": 0.75}
    json.dumps(s.to_dict())


def test_atoms_alone_empty():
    s = compute_atoms_alone_stats([], [AtomsAloneResult(picked=(), gaps=())], rounds=[1])
    assert s.quantum_share == 0.0 and s.atoms_not_needed and s.gaps == []
