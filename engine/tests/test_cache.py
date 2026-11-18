"""Smoke test for the Tile frequency cache (Requirements 5.4, 5.8)."""

from atommap.layout import ScaledLayout
from atommap.simulator import FrequencyCache, part_frequencies
from fake_sim import FakeSimulator

LAYOUT = ScaledLayout(ids=("a", "b"), positions_um=((0.0, 0.0), (20.0, 0.0)))
EDGES: list[tuple[str, str]] = []


def test_cache_smoke() -> None:
    sim = FakeSimulator()
    cache = FrequencyCache()
    first = cache.part_frequencies(sim, LAYOUT, EDGES, 7)
    second = cache.part_frequencies(sim, LAYOUT, EDGES, 7)
    assert first == second == part_frequencies(FakeSimulator(), LAYOUT, EDGES, 7)
    assert (cache.hits, cache.misses, cache.simulator_calls, sim.calls) == (1, 1, 1, 1)
    assert cache.invalidate(["b"]) == 1
    cache.part_frequencies(sim, LAYOUT, EDGES, 7)
    assert (cache.misses, cache.simulator_calls) == (2, 2)
