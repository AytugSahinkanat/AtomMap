import pytest

from atommap.fixtures import HERO, SPARSE, load_fixture, load_request
from atommap.graph import build_graph
from atommap.model import validate_request


@pytest.mark.parametrize("name,spacing,jitter", [(HERO, 9.0, 2.0), (SPARSE, 11.0, 1.5)])
def test_wifi_hall_fixture(name, spacing, jitter):
    data = load_fixture(name)
    assert len(data["points"]) == 70
    assert data["graph"]["r"] == 20.0
    for i, p in enumerate(data["points"]):
        row, col = divmod(i, 10)
        assert abs(p["x"] - col * spacing) <= jitter + 1e-3
        assert abs(p["y"] - row * spacing) <= jitter + 1e-3

    req = validate_request(load_request(name))
    assert req.r == 20.0 and req.mode == "channel_plan"
    g = build_graph(req)
    assert len(g.nodes) == 70 and g.edges


def test_sparse_has_fewer_conflicts_than_hero():
    hero = build_graph(validate_request(load_request(HERO)))
    sparse = build_graph(validate_request(load_request(SPARSE)))
    assert len(sparse.edges) < len(hero.edges)
