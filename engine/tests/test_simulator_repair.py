"""Shot repair and frequencies (Requirement 5.7), with a tiny stub simulator."""

import random

from hypothesis import given, strategies as st

from atommap.layout import ScaledLayout
from atommap.simulator import part_frequencies, repair_shot, tile_seed

PATH = [("a", "b"), ("b", "c")]


class StubSim:
    def __init__(self, shots):
        self.shots = shots
        self.calls = []

    def run_tile(self, positions_um, seed):
        self.calls.append((list(positions_um), seed))
        return self.shots


def layout3():
    return ScaledLayout(("a", "b", "c"), ((0.0, 0.0), (6.0, 0.0), (12.0, 0.0)))


def test_repair_drops_conflicts_and_keeps_independent():
    assert repair_shot(["a", "c"], PATH, random.Random(0)) == frozenset({"a", "c"})
    kept = repair_shot(["a", "b", "c"], PATH, random.Random(0))
    assert kept in (frozenset({"b"}), frozenset({"a", "c"}))


@given(st.sets(st.sampled_from("abc")), st.integers(0, 1000))
def test_repair_result_is_independent_subset(picked, s):
    kept = repair_shot(picked, PATH, random.Random(s))
    assert kept <= picked
    assert not any(a in kept and b in kept for a, b in PATH)


def test_frequencies_count_repaired_shots():
    # 0 = picked. Shot 1: a and c. Shot 2: nothing. Shot 3: a only. Shot 4: a only.
    sim = StubSim([[0, 1, 0], [1, 1, 1], [0, 1, 1], [0, 1, 1]])
    freq = part_frequencies(sim, layout3(), PATH, 7)
    assert freq == {"a": 0.75, "b": 0.0, "c": 0.25}
    assert sim.calls[0][1] == tile_seed(7, ("a", "b", "c"))


def test_frequencies_deterministic():
    shots = [[0, 0, 0]] * 20
    f1 = part_frequencies(StubSim(shots), layout3(), PATH, 3)
    f2 = part_frequencies(StubSim(shots), layout3(), PATH, 3)
    assert f1 == f2


def test_single_point_part_skips_simulator():
    sim = StubSim([])
    freq = part_frequencies(sim, ScaledLayout(("p",), (), 1.0), [], 1)
    assert freq == {"p": 1.0}
    assert sim.calls == []
