import pytest

from atommap.simulator import SHOTS
from fake_sim import FakeSimulator, FakeSimulatorError

POS = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)]


def test_same_seed_same_shots():
    a = FakeSimulator().run_tile(POS, 42)
    b = FakeSimulator().run_tile(POS, 42)
    assert a == b
    assert a != FakeSimulator().run_tile(POS, 43)


def test_format_matches_real_simulator():
    shots = FakeSimulator().run_tile(POS, 1)
    assert len(shots) == SHOTS
    for shot in shots:
        assert isinstance(shot, list) and len(shot) == len(POS)
        assert all(type(v) is int and v in (0, 1) for v in shot)


def test_bias_extremes():
    assert all(v == 0 for s in FakeSimulator(excite_probability=1.0).run_tile(POS, 1) for v in s)
    assert all(v == 1 for s in FakeSimulator(excite_probability=0.0).run_tile(POS, 1) for v in s)


def test_raises_for_chosen_tile_seed_and_counts_calls():
    sim = FakeSimulator(fail_seeds={7})
    sim.run_tile(POS, 1)
    with pytest.raises(FakeSimulatorError):
        sim.run_tile(POS, 7)
    assert sim.calls == 2
    assert sim.seeds_seen == [1, 7]
