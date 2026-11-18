"""Unit tests for the annealing provider. Validates: Requirements 7.4, 8.4."""

from __future__ import annotations

import random

from atommap.anneal import SAMPLES, anneal_frequencies


def test_deterministic():
    ids = ["a", "b", "c", "d"]
    edges = [("a", "b"), ("b", "c"), ("c", "d")]
    assert anneal_frequencies(ids, edges, 7) == anneal_frequencies(ids, edges, 7)


def test_frequencies_in_unit_interval():
    ids = ["a", "b", "c", "d", "e"]
    edges = [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("a", "e")]
    freqs = anneal_frequencies(ids, edges, 3)
    assert set(freqs) == set(ids)
    assert all(0.0 <= f <= 1.0 for f in freqs.values())


def test_isolated_point_is_one():
    assert anneal_frequencies(["a"], [], 1) == {"a": 1.0}
    freqs = anneal_frequencies(["a", "b", "c"], [("b", "c")], 5)
    assert freqs["a"] == 1.0


def test_single_edge_sums_to_about_one():
    freqs = anneal_frequencies(["a", "b"], [("a", "b")], 11)
    assert abs(freqs["a"] + freqs["b"] - 1.0) <= 0.05


def test_repaired_samples_independent():
    # Same repair step the provider uses: every repaired sample has no conflicting pair.
    edges = [("a", "b"), ("b", "c"), ("a", "c")]
    rng = random.Random(0)
    from atommap.simulator import repair_shot

    for _ in range(SAMPLES):
        kept = repair_shot(["a", "b", "c"], edges, rng)
        assert not any(x in kept and y in kept for x, y in edges)
    # On a triangle at most one Point per sample, so frequencies sum to <= 1.
    freqs = anneal_frequencies(["a", "b", "c"], edges, 2)
    assert sum(freqs.values()) <= 1.0 + 1e-9
