"""Pulse, constants and simulator call arguments (Requirements 5.1, 5.2, 5.3, 5.5). No real simulation."""

import inspect
import math

import braket.devices
import numpy as np

from atommap import physics, simulator
from atommap.simulator import BraketSimulator, build_program, pulse_series

C6 = 5.42e-24
OMEGA = 15.8e6


def test_constants_have_fixed_values():
    assert physics.C6 == C6 and simulator.C6 == C6
    assert physics.OMEGA == OMEGA and simulator.OMEGA == OMEGA
    assert (simulator.STEPS, simulator.SHOTS) == (400, 100)
    assert simulator.DURATION_S == 4e-6 and simulator.RAMP_S == 0.25e-6


def test_constants_cannot_be_overridden_through_inputs():
    assert list(inspect.signature(physics.blockade_radius_m).parameters) == []
    assert list(inspect.signature(pulse_series).parameters) == []
    assert list(inspect.signature(build_program).parameters) == ["positions_um"]
    assert list(inspect.signature(BraketSimulator.run_tile).parameters) == [
        "self",
        "positions_um",
        "seed",
    ]


def test_blockade_radius_formula_and_repeatability():
    expected = (C6 / OMEGA) ** (1 / 6)
    first = physics.blockade_radius_m()
    assert first == expected
    assert math.isclose(first, 8.37e-6, rel_tol=1e-2)
    assert all(physics.blockade_radius_m() == first for _ in range(5))
    assert simulator.blockade_radius_m() == first


def test_amplitude_pulse_timings():
    amp = pulse_series()["amplitude"]
    assert amp == [(0.0, 0.0), (0.25e-6, OMEGA), (3.75e-6, OMEGA), (4e-6, 0.0)]


def test_detuning_pulse_timings():
    det = pulse_series()["detuning"]
    assert det == [
        (0.0, -5 * OMEGA),
        (0.25e-6, -5 * OMEGA),
        (3.75e-6, 5 * OMEGA),
        (4e-6, 5 * OMEGA),
    ]


def test_phase_is_zero_for_whole_pulse():
    phase = pulse_series()["phase"]
    assert phase[0][0] == 0.0 and phase[-1][0] == 4e-6
    assert all(v == 0.0 for _, v in phase)


def test_braket_simulator_passes_shots_steps_and_blockade_radius(monkeypatch):
    calls = {}

    class FakeMeasurement:
        post_sequence = np.array([0, 1])

    class FakeResult:
        measurements = [FakeMeasurement(), FakeMeasurement()]

    class FakeTask:
        def result(self):
            return FakeResult()

    class FakeLocalSimulator:
        def __init__(self, backend):
            calls["backend"] = backend

        def run(self, program, *args, **kwargs):
            calls["program"] = program
            calls["args"] = args
            calls["kwargs"] = kwargs
            return FakeTask()

    monkeypatch.setattr(braket.devices, "LocalSimulator", FakeLocalSimulator)

    out = BraketSimulator().run_tile([(0.0, 0.0), (6.5, 0.0)], seed=3)

    assert calls["backend"] == "braket_ahs"
    assert calls["args"] == ()
    assert calls["kwargs"] == {
        "shots": 100,
        "steps": 400,
        "blockade_radius": physics.blockade_radius_m(),
    }
    assert out == [[0, 1], [0, 1]]
