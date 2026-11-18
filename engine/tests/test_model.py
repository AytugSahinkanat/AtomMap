import copy

import pytest

from atommap.model import Entry, Stats, ValidationError, validate_request

GOOD = {
    "points": [{"id": "a", "x": 0.0, "y": 0.0}, {"id": "b", "x": 5.0, "y": 0.0}],
    "mode": "channel_plan",
    "graph": {"r": 20.0, "edges": [["a", "b"], ["b", "a"]]},
    "seed": 7,
}


def make(**changes):
    raw = copy.deepcopy(GOOD)
    raw.update(changes)
    return raw


def rejects(raw, kind):
    with pytest.raises(ValidationError) as e:
        validate_request(raw)
    assert e.value.kind == kind
    return e.value


def test_valid_request():
    req = validate_request(GOOD)
    assert [p.id for p in req.points] == ["a", "b"]
    assert req.mode == "channel_plan" and req.r == 20.0 and req.seed == 7
    assert req.edges == (("a", "b"), ("b", "a"))  # duplicates kept; graph.py collapses them


def test_r_alone_and_zero_points_accepted():
    req = validate_request({"points": [], "mode": "place", "graph": {"r": 1}, "seed": 0})
    assert req.edges is None and req.points == ()


def test_missing_fields_all_named():
    raw = make()
    del raw["mode"], raw["seed"]
    raw["graph"] = {"edges": []}
    raw["points"][1] = {"id": "b", "x": 1.0}
    err = rejects(raw, "missing_fields")
    assert set(err.items) == {"points[1].y", "mode", "graph.r", "seed"}


def test_missing_points_list():
    raw = make()
    del raw["points"]
    assert rejects(raw, "missing_fields").items == ["points"]


def test_seed_type():
    for bad in ("7", 1.5, True):
        err = rejects(make(seed=bad), "invalid_seed")
        assert repr(bad) in err.message


def test_mode():
    err = rejects(make(mode="plan"), "invalid_mode")
    assert "'plan'" in err.message


def test_duplicate_ids_all_named():
    pts = [{"id": i, "x": 0, "y": 0} for i in ("a", "b", "a", "b", "a", "c")]
    err = rejects(make(points=pts, graph={"r": 1}), "duplicate_ids")
    assert err.items == ["a", "b"]


def test_unknown_edge_ids_all_named():
    err = rejects(make(graph={"r": 1, "edges": [["a", "x"], ["y", "b"], ["x", "y"]]}), "unknown_edge_ids")
    assert err.items == ["x", "y"]


def test_self_edges_all_named():
    err = rejects(make(graph={"r": 1, "edges": [["a", "a"], ["b", "b"]]}), "self_edges")
    assert err.items == ["a", "b"]


def test_check_order():
    # Seed is checked before mode, mode before duplicates, duplicates before edges.
    assert rejects(make(seed="x", mode="bad"), "invalid_seed")
    dup = [{"id": "a", "x": 0, "y": 0}] * 2
    assert rejects(make(mode="bad", points=dup), "invalid_mode")
    assert rejects(make(points=dup, graph={"r": 1, "edges": [["a", "zz"]]}), "duplicate_ids")
    assert rejects(make(graph={"r": 1, "edges": [["a", "a"], ["q", "b"]]}), "unknown_edge_ids")


def test_to_dict_shapes():
    e = Entry(1, "rule", "pick", ["a"], rule="simplicial").to_dict()
    assert e == {"round": 1, "source": "rule", "action": "pick", "points": ["a"], "rule": "simplicial"}
    assert "gaps" not in Stats().to_dict()
    assert Stats(gaps=["a"]).to_dict()["gaps"] == ["a"]
