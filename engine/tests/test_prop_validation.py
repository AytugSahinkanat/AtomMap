"""Property 9: invalid requests are rejected with named items.

Feature: engine, Property 9: Invalid requests are rejected with named items

**Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**
"""

import copy

import pytest
from hypothesis import given, settings, strategies as st

from atommap.model import MODES, ValidationError, validate_request

SETTINGS = settings(max_examples=150, deadline=None)

_coord = st.floats(min_value=-500, max_value=500, allow_nan=False, allow_infinity=False)


@st.composite
def valid_requests(draw):
    """A valid request. Edges are an arbitrary pair list (not from distance)."""
    n = draw(st.integers(min_value=2, max_value=10))
    ids = [f"p{i}" for i in range(n)]
    points = [{"id": i, "x": draw(_coord), "y": draw(_coord)} for i in ids]
    graph = {"r": draw(st.floats(min_value=0.5, max_value=100, allow_nan=False))}
    if draw(st.booleans()):
        pair = st.tuples(st.sampled_from(ids), st.sampled_from(ids)).filter(lambda t: t[0] != t[1])
        graph["edges"] = [list(e) for e in draw(st.lists(pair, max_size=15))]
    return {
        "points": points,
        "mode": draw(st.sampled_from(MODES)),
        "graph": graph,
        "seed": draw(st.integers(min_value=-(2**31), max_value=2**31)),
    }


def _reject(req):
    with pytest.raises(ValidationError) as info:
        validate_request(req)
    return info.value


@SETTINGS
@given(valid_requests())
def test_valid_requests_are_accepted(req):
    validate_request(req)


@SETTINGS
@given(valid_requests(), st.data())
def test_missing_items_are_all_named(req, data):
    top = ["points", "mode", "graph", "seed"]
    drop = data.draw(st.lists(st.sampled_from(top + ["graph.r", "point.x", "point.id"]), min_size=1, unique=True))
    bad = copy.deepcopy(req)
    expected = set()
    for key in drop:
        if key in top:
            bad.pop(key, None)
            expected.add(key)
    if "graph" not in drop and "graph.r" in drop:
        del bad["graph"]["r"]
        expected.add("graph.r")
    if "points" not in drop:
        if "point.x" in drop:
            del bad["points"][0]["x"]
            expected.add("points[0].x")
        if "point.id" in drop:
            del bad["points"][-1]["id"]
            expected.add(f"points[{len(bad['points']) - 1}].id")
    err = _reject(bad)
    assert err.kind == "missing_fields"
    assert set(err.items) == expected
    assert len(err.items) == len(expected)
    for item in expected:
        assert item in err.message


@SETTINGS
@given(
    valid_requests(),
    st.one_of(
        st.floats(allow_nan=False, allow_infinity=False),
        st.text(max_size=8),
        st.booleans(),
        st.lists(st.integers(), max_size=3),
    ),
)
def test_non_integer_seed_names_value(req, seed):
    req["seed"] = seed
    err = _reject(req)
    assert err.kind == "invalid_seed"
    assert err.items == [repr(seed)]
    assert repr(seed) in err.message


@SETTINGS
@given(valid_requests(), st.text(max_size=10).filter(lambda s: s not in MODES))
def test_unknown_mode_names_value(req, mode):
    req["mode"] = mode
    err = _reject(req)
    assert err.kind == "invalid_mode"
    assert err.items == [repr(mode)]
    assert repr(mode) in err.message


@SETTINGS
@given(valid_requests(), st.data())
def test_duplicate_ids_all_named(req, data):
    ids = [p["id"] for p in req["points"]]
    dup = data.draw(st.lists(st.sampled_from(ids), min_size=1, max_size=len(ids), unique=True))
    for d in dup:
        for _ in range(data.draw(st.integers(1, 2))):
            req["points"].append({"id": d, "x": 1.0, "y": 2.0})
    err = _reject(req)
    assert err.kind == "duplicate_ids"
    assert set(err.items) == set(dup)
    assert len(err.items) == len(set(err.items))
    for d in dup:
        assert d in err.message


@SETTINGS
@given(valid_requests(), st.lists(st.text(alphabet="xyz", min_size=1, max_size=4).map(lambda s: "u_" + s), min_size=1, max_size=4, unique=True), st.data())
def test_unknown_edge_ids_all_named(req, unknown, data):
    ids = [p["id"] for p in req["points"]]
    edges = req["graph"].setdefault("edges", [])
    for u in unknown:
        known = data.draw(st.sampled_from(ids))
        edges.append([u, known] if data.draw(st.booleans()) else [known, u])
    err = _reject(req)
    assert err.kind == "unknown_edge_ids"
    assert set(err.items) == set(unknown)
    assert len(err.items) == len(set(err.items))
    for u in unknown:
        assert u in err.message


@SETTINGS
@given(valid_requests(), st.data())
def test_self_edges_all_named(req, data):
    ids = [p["id"] for p in req["points"]]
    selfs = data.draw(st.lists(st.sampled_from(ids), min_size=1, max_size=len(ids), unique=True))
    edges = req["graph"].setdefault("edges", [])
    for s in selfs:
        edges.append([s, s])
    err = _reject(req)
    assert err.kind == "self_edges"
    assert set(err.items) == set(selfs)
    assert len(err.items) == len(set(err.items))
    for s in selfs:
        assert s in err.message


@SETTINGS
@given(
    valid_requests(),
    st.sets(st.sampled_from(["missing", "seed", "mode", "dup", "r", "unknown", "self"]), min_size=2),
)
def test_check_order_when_several_problems(req, problems):
    """The first failing check in the documented order decides the error kind."""
    order = [
        ("missing", "missing_fields"),
        ("seed", "invalid_seed"),
        ("mode", "invalid_mode"),
        ("dup", "duplicate_ids"),
        ("r", "invalid_r"),
        ("unknown", "unknown_edge_ids"),
        ("self", "self_edges"),
    ]
    ids = [p["id"] for p in req["points"]]
    edges = req["graph"].setdefault("edges", [])
    if "seed" in problems:
        req["seed"] = "abc"
    if "mode" in problems:
        req["mode"] = "bogus"
    if "dup" in problems:
        req["points"].append({"id": ids[0], "x": 0.0, "y": 0.0})
    if "r" in problems:
        req["graph"]["r"] = "far"
    if "unknown" in problems:
        edges.append(["nope", ids[0]])
    if "self" in problems:
        edges.append([ids[0], ids[0]])
    if "missing" in problems:
        req.pop("mode", None)  # applied last so it is not re-added above
    expected = next(kind for name, kind in order if name in problems)
    assert _reject(req).kind == expected
