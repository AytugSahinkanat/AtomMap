"""Optional `competitors` field of the request (used by web/smoke.html)."""

from __future__ import annotations

from test_api import go, raw_grid


def test_default_runs_all_four():
    out = go(raw_grid())
    assert len(out["result"]["competitors"]) == 4


def test_can_select_hybrid_only():
    raw = raw_grid()
    raw["competitors"] = ["Hybrid"]
    out = go(raw)
    assert out["ok"] is True
    assert list(out["result"]["competitors"]) == ["Hybrid"]


def test_unknown_name_is_rejected_and_named():
    raw = raw_grid()
    raw["competitors"] = ["Hybrid", "Magic"]
    out = go(raw)
    assert out["ok"] is False
    assert out["error"]["type"] == "ValidationError"
    assert out["error"]["kind"] == "invalid_competitors"
    assert out["error"]["items"] == ["Magic"]
    assert "Magic" in out["error"]["message"]
