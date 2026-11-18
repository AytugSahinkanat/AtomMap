from atommap.graph import build_graph
from atommap.model import Point, Request


def req(points, edges=None, r=10.0):
    return Request(
        points=tuple(Point(i, x, y) for i, x, y in points),
        mode="place",
        r=r,
        edges=edges,
        seed=0,
    )


def test_r_alone_uses_strict_distance():
    g = build_graph(req([("a", 0, 0), ("b", 9.9, 0), ("c", 20, 0)], r=10.0))
    assert g.edges == {("a", "b")}
    # distance exactly r is not a conflict
    g = build_graph(req([("a", 0, 0), ("b", 10, 0)], r=10.0))
    assert g.edges == frozenset()


def test_edge_list_collapses_duplicates_and_reversed():
    pts = [("a", 0, 0), ("b", 1, 0), ("c", 2, 0)]
    g = build_graph(req(pts, edges=(("b", "a"), ("a", "b"), ("a", "b"), ("c", "b"))))
    assert g.edges == {("a", "b"), ("b", "c")}
    assert g == build_graph(req(pts, edges=(("a", "b"), ("b", "c"))))


def test_edge_list_ignores_distance():
    g = build_graph(req([("a", 0, 0), ("b", 1, 0)], edges=()))
    assert g.edges == frozenset()
    assert g.nodes == ("a", "b")


def test_zero_points():
    g = build_graph(req([]))
    assert g.nodes == ()
    assert g.edges == frozenset()
    assert g.adjacency() == {}


def test_adjacency():
    g = build_graph(req([("a", 0, 0), ("b", 1, 0), ("c", 50, 0)]))
    assert g.adjacency() == {"a": {"b"}, "b": {"a"}, "c": set()}
