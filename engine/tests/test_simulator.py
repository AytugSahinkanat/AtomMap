"""Fast checks of the seed and the pulse program (Requirements 5.1 to 5.5). No simulator run."""

import math

from atommap import simulator
from atommap.physics import OMEGA


def test_tile_seed_is_deterministic_and_order_free():
    assert simulator.tile_seed(7, ["b", "a", "c"]) == simulator.tile_seed(7, ["c", "a", "b"])


def test_tile_seed_in_32_bit_range_and_differs_per_tile():
    seeds = {simulator.tile_seed(2**40, [f"p{i}", f"p{i + 1}"]) for i in range(50)}
    assert all(0 <= s < 2**32 for s in seeds)
    assert len(seeds) == 50
    assert simulator.tile_seed(1, ["a"]) != simulator.tile_seed(2, ["a"])


def test_blockade_radius_value():
    assert math.isclose(simulator.blockade_radius_m(), 8.37e-6, rel_tol=1e-2)


def test_pulse_series_matches_design():
    s = simulator.pulse_series()
    assert s["amplitude"] == [(0.0, 0.0), (0.25e-6, OMEGA), (3.75e-6, OMEGA), (4e-6, 0.0)]
    assert s["detuning"][0][1] == -5 * OMEGA and s["detuning"][-1] == (4e-6, 5 * OMEGA)
    assert s["detuning"][1] == (0.25e-6, -5 * OMEGA) and s["detuning"][2] == (3.75e-6, 5 * OMEGA)
    assert all(v == 0.0 for _, v in s["phase"])
    assert (simulator.STEPS, simulator.SHOTS) == (400, 100)


def test_build_program_converts_to_metres():
    prog = simulator.build_program([(0.0, 0.0), (6.5, 0.0)])
    sites = prog.register.coordinate_list(0), prog.register.coordinate_list(1)
    assert [float(x) for x in sites[0]] == [0.0, 6.5e-6]
