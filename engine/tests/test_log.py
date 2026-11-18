import pytest

from atommap.log import DecisionLog


def test_order_and_fields():
    log = DecisionLog("channel_plan", ["a", "b", "c"])
    log.add(1, "rule", "pick", ["a"], rule="simplicial")
    log.add(1, "rule", "remove", ["b"], rule="simplicial")
    log.add(6, "atoms", "pick", ["c"])
    d = log.to_list()
    assert [e["action"] for e in d] == ["pick", "remove", "pick"]
    assert [e["round"] for e in d] == [1, 1, 6]
    assert set(d[0]) == {"round", "source", "action", "points", "rule"}
    assert set(d[2]) == {"round", "source", "action", "points"}


def test_rule_entry_needs_rule_name():
    log = DecisionLog("place")
    with pytest.raises(ValueError):
        log.add(1, "rule", "pick", ["a"])
    with pytest.raises(ValueError):
        log.add(1, "atoms", "pick", ["a"], rule="simplicial")


def test_round_validation_per_mode():
    with pytest.raises(ValueError):
        DecisionLog("place").add(6, "atoms", "pick", ["a"])
    with pytest.raises(ValueError):
        DecisionLog("channel_plan").add(2, "atoms", "pick", ["a"])


def test_invalid_source_action_points():
    log = DecisionLog("place", ["a"])
    with pytest.raises(ValueError):
        log.add(1, "magic", "pick", ["a"])
    with pytest.raises(ValueError):
        log.add(1, "atoms", "explode", ["a"])
    with pytest.raises(ValueError):
        log.add(1, "atoms", "pick", [])
    with pytest.raises(ValueError):
        log.add(1, "atoms", "pick", ["zz"])
    assert len(log) == 0


def test_split_and_skip_details():
    log = DecisionLog("place")
    with pytest.raises(ValueError):
        log.add(1, "atoms", "split", ["a", "b"])
    with pytest.raises(ValueError):
        log.add(1, "atoms", "skip", ["a"])
    log.add(1, "atoms", "split", ["a", "b"], reason="no exact layout")
    log.add(1, "atoms", "skip", ["a"], message="boom")
    d = log.to_list()
    assert d[0]["reason"] == "no exact layout"
    assert d[1]["message"] == "boom"


def test_append_only_copy():
    log = DecisionLog("place")
    log.add(1, "coin flip", "pick", ["a"])
    log.entries().clear()
    assert len(log) == 1
