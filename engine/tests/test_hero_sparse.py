"""Hero map and sparse control tests (Requirements 1.15, 12.8, 12.9, 12.10).

Seeds come from tests/test_settings.json via load_settings(). The real-simulator
Hybrid run on the hero map happens once (module-scoped fixture) and is shared by
the hero test and the sparse comparison test.
"""

import time

import pytest

from atommap.competitors import (
    COMPETITORS,
    HYBRID,
    RESULT_LABEL,
    run_competitors,
)
from atommap.fixtures import HERO, SPARSE, load_request
from atommap.graph import build_graph
from atommap.model import CompetitorResult, validate_request
from atommap.settings import load_settings
from atommap.simulator import BraketSimulator

from fake_sim import FakeSimulator

TIME_LIMIT_S = 20.0  # Requirement 1.15


def _check_rounds(result: CompetitorResult, graph, n_points):
    seen = set()
    for rnd in result.rounds:
        picks = set(rnd.picks)
        assert len(picks) == len(rnd.picks)
        assert not any(a in picks and b in picks for a, b in graph.edges)
        assert not (picks & seen)
        seen |= picks
    five = set(result.five_ghz_only or [])
    assert not (five & seen)
    assert len(seen | five) == n_points
    assert result.label == RESULT_LABEL == "simulation"


@pytest.fixture(scope="module")
def hero_real_run():
    """The one real-simulator Hybrid run on the hero map, shared by the tests."""
    cfg = load_settings()
    seed = cfg["seeds"]["hero"]
    assert cfg["run_counts"]["hero_runs"] == 1
    request = validate_request(load_request(HERO, seed=seed))
    graph = build_graph(request)
    assert len(request.points) == cfg["map_sizes"]["hero_points"]

    sim = BraketSimulator()
    sim.run_tile([(0.0, 0.0), (6.0, 0.0)], 1)  # warm-up on a tiny tile

    t0 = time.perf_counter()
    result = run_competitors(request, sim, names=(HYBRID,))
    elapsed = time.perf_counter() - t0
    res = result.competitors[HYBRID]
    assert isinstance(res, CompetitorResult), res
    return {"seed": seed, "request": request, "graph": graph, "res": res, "elapsed": elapsed}


@pytest.mark.slow
def test_hero_channel_plan_real_simulator(hero_real_run):
    h = hero_real_run
    res, st = h["res"], h["res"].stats
    _check_rounds(res, h["graph"], len(h["request"].points))
    print(
        f"\nHERO Hybrid (real simulator, seed {h['seed']}): {h['elapsed']:.2f}s | "
        f"braket_calls={st.braket_calls} cache_hits={st.cache_hits} "
        f"quantum_share={st.quantum_share:.3f} ({st.quantum_picks}/{st.total_picks}) "
        f"picks_per_round={st.picks_per_round} five_ghz_only={len(res.five_ghz_only or [])} "
        f"splits={st.splits} skipped_tiles={st.skipped_tiles} mismatches={st.mismatches} "
        f"layout_fallbacks={st.layout_fallbacks} timings={st.timings}"
    )
    assert h["elapsed"] <= TIME_LIMIT_S, f"Hybrid took {h['elapsed']:.2f}s, limit {TIME_LIMIT_S}s"


def test_hero_all_four_competitors_fake_simulator():
    seed = load_settings()["seeds"]["hero"]
    request = validate_request(load_request(HERO, seed=seed))
    graph = build_graph(request)
    result = run_competitors(request, FakeSimulator())
    assert set(result.competitors) == set(COMPETITORS)
    for name, res in result.competitors.items():
        assert isinstance(res, CompetitorResult), (name, res)
        assert res.label == "simulation"
    for name in COMPETITORS[1:]:
        _check_rounds(result.competitors[name], graph, len(request.points))


@pytest.mark.slow
def test_sparse_quantum_share_below_half_of_hero(hero_real_run):
    """Requirement 12.9: sparse Hybrid share < 0.5 * hero Hybrid share (real simulator)."""
    cfg = load_settings()
    seed = cfg["seeds"]["sparse"]
    request = validate_request(load_request(SPARSE, seed=seed))
    graph = build_graph(request)
    assert len(request.points) == cfg["map_sizes"]["sparse_points"]

    result = run_competitors(request, BraketSimulator(), names=(HYBRID,))
    res = result.competitors[HYBRID]
    assert isinstance(res, CompetitorResult), res
    _check_rounds(res, graph, len(request.points))
    sp = res.stats
    hs = hero_real_run["res"].stats
    print(
        f"\nHERO   (seed {hero_real_run['seed']}): quantum_share={hs.quantum_share:.4f} "
        f"({hs.quantum_picks}/{hs.total_picks}) simulator_calls={hs.braket_calls} "
        f"picks_per_round={hs.picks_per_round}"
        f"\nSPARSE (seed {seed}): quantum_share={sp.quantum_share:.4f} "
        f"({sp.quantum_picks}/{sp.total_picks}) simulator_calls={sp.braket_calls} "
        f"picks_per_round={sp.picks_per_round}"
    )
    assert sp.quantum_share < 0.5 * hs.quantum_share
