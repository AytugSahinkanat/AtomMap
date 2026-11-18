"""Unit tests for the Tile frequency cache (Requirements 5.4, 5.8)."""

import pytest

from atommap.layout import ScaledLayout
from atommap.simulator import FrequencyCache, part_frequencies, tile_seed
from fake_sim import FakeSimulator, FakeSimulatorError

SEED = 11


def tile(*ids: str) -> ScaledLayout:
    """A part with its atoms 20 µm apart on a line (no conflicts)."""
    return ScaledLayout(
        ids=tuple(ids), positions_um=tuple((20.0 * i, 0.0) for i in range(len(ids)))
    )


def test_same_tile_twice_makes_one_simulator_call() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    first = cache.part_frequencies(sim, tile("a", "b", "c"), [], SEED)
    second = cache.part_frequencies(sim, tile("a", "b", "c"), [], SEED)
    assert first == second
    assert sim.calls == 1
    assert (cache.hits, cache.misses, cache.simulator_calls) == (1, 1, 1)


def test_key_ignores_order_of_ids() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    cache.part_frequencies(sim, tile("a", "b"), [], SEED)
    cache.part_frequencies(sim, tile("b", "a"), [], SEED)
    assert sim.calls == 1
    assert cache.hits == 1


def test_hit_returns_a_copy() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    first = cache.part_frequencies(sim, tile("a", "b"), [], SEED)
    expected = dict(first)
    first["a"] = -1.0
    assert cache.part_frequencies(sim, tile("a", "b"), [], SEED) == expected


def test_removing_a_point_invalidates_its_tile() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    cache.part_frequencies(sim, tile("a", "b"), [], SEED)
    assert cache.invalidate(["b"]) == 1
    assert len(cache) == 0
    cache.part_frequencies(sim, tile("a", "b"), [], SEED)
    assert sim.calls == 2
    assert cache.misses == 2


def test_invalidating_an_unrelated_id_keeps_the_entry() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    cache.part_frequencies(sim, tile("a", "b"), [], SEED)
    assert cache.invalidate(["z"]) == 0
    assert len(cache) == 1
    cache.part_frequencies(sim, tile("a", "b"), [], SEED)
    assert sim.calls == 1
    assert cache.hits == 1


def test_several_tiles_one_removal_drops_only_affected() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    t1, t2, t3 = tile("a", "b"), tile("c", "d"), tile("e", "f")
    for t in (t1, t2, t3):
        cache.part_frequencies(sim, t, [], SEED)
    assert sim.calls == 3
    assert cache.invalidate(["c"]) == 1
    for t in (t1, t2, t3):
        cache.part_frequencies(sim, t, [], SEED)
    assert sim.calls == 4  # only t2 recomputed
    assert (cache.hits, cache.misses) == (2, 4)


def test_failing_simulator_call_caches_nothing_and_is_retried() -> None:
    layout = tile("a", "b")
    bad = tile_seed(SEED, layout.ids)
    sim = FakeSimulator(fail_seeds=[bad])
    cache = FrequencyCache()
    for attempt in (1, 2):
        with pytest.raises(FakeSimulatorError):
            cache.part_frequencies(sim, layout, [], SEED)
        assert len(cache) == 0
        assert sim.calls == attempt
    assert cache.hits == 0
    assert cache.misses == 2
    assert cache.simulator_calls == 2
    # once the simulator works, the same lookup succeeds and is then cached
    sim.fail_seeds = frozenset()
    result = cache.part_frequencies(sim, layout, [], SEED)
    assert result == part_frequencies(FakeSimulator(), layout, [], SEED)
    cache.part_frequencies(sim, layout, [], SEED)
    assert sim.calls == 3
    assert len(cache) == 1


def test_single_point_part_makes_no_simulator_call() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    single = ScaledLayout(ids=("a",), positions_um=((0.0, 0.0),), fixed_frequency=1.0)
    assert cache.part_frequencies(sim, single, [], SEED) == {"a": 1.0}
    assert sim.calls == 0
    assert cache.simulator_calls == 0
    assert cache.misses == 1


def test_results_identical_with_and_without_cache() -> None:
    parts = [tile("a", "b", "c"), tile("d", "e"), tile("a", "b", "c"), tile("f", "g")]
    # (index of part to look up) interleaved with removals
    script = [
        ("get", 0), ("get", 1), ("get", 0), ("remove", "b"),
        ("get", 0), ("get", 2), ("get", 3), ("remove", "g"),
        ("get", 3), ("get", 1), ("remove", "zzz"), ("get", 1),
    ]  # fmt: skip
    cached_sim = FakeSimulator()
    plain_sim = FakeSimulator()
    cache = FrequencyCache()
    for op, arg in script:
        if op == "remove":
            cache.invalidate([arg])
            continue
        with_cache = cache.part_frequencies(cached_sim, parts[arg], [], SEED)
        without = part_frequencies(plain_sim, parts[arg], [], SEED)
        assert with_cache == without
    assert cached_sim.calls < plain_sim.calls
    # a recomputed Tile used the same Tile seed as the first time
    first_seed = tile_seed(SEED, ("a", "b", "c"))
    assert cached_sim.seeds_seen.count(first_seed) == 2
