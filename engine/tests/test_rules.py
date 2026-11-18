from atommap.graph import ConflictGraph
from atommap.log import DecisionLog
from atommap.rules import apply_rules


def _run(nodes, edges, mode="place", round=1):
    g = ConflictGraph(tuple(nodes), frozenset((min(a, b), max(a, b)) for a, b in edges))
    log = DecisionLog(mode, nodes)
    avail = set(nodes)
    picked = apply_rules(g, avail, log, round)
    return picked, avail, log


def test_isolated_point_is_picked_without_remove_entry():
    picked, avail, log = _run(["a"], [])
    assert picked == ["a"] and avail == set()
    assert [(e.action, e.points, e.rule) for e in log] == [("pick", ["a"], "simplicial")]


def test_path_of_three_picks_both_ends():
    picked, avail, log = _run(["a", "b", "c"], [("a", "b"), ("b", "c")])
    assert picked == ["a", "c"] and avail == set()
    assert all(e.source == "rule" and e.rule == "simplicial" for e in log)
    assert [(e.action, e.points) for e in log] == [
        ("pick", ["a"]), ("remove", ["b"]), ("pick", ["c"]),
    ]


def test_triangle_picks_one_and_removes_two():
    picked, avail, log = _run(["a", "b", "c"], [("a", "b"), ("b", "c"), ("a", "c")], "channel_plan", 6)
    assert picked == ["a"] and avail == set()
    assert [(e.round, e.action, e.points) for e in log] == [
        (6, "pick", ["a"]), (6, "remove", ["b", "c"]),
    ]


def test_four_cycle_does_nothing():
    nodes = ["a", "b", "c", "d"]
    picked, avail, log = _run(nodes, [("a", "b"), ("b", "c"), ("c", "d"), ("a", "d")])
    assert picked == [] and avail == set(nodes) and len(log) == 0


def test_only_available_points_are_considered():
    g = ConflictGraph(("a", "b", "c"), frozenset({("a", "b"), ("b", "c")}))
    log = DecisionLog("place")
    avail = {"b", "c"}
    assert apply_rules(g, avail, log, 1) == ["b"]
    assert avail == set()
