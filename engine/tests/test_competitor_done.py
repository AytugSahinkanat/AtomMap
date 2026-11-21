"""Per-competitor delivery: `on_done` gets each Competitor as soon as it finishes.

The final result text is unchanged by it (incremental Scoreboard).
"""

from __future__ import annotations

import json

import atommap.api as api
from atommap.competitors import COMPETITORS
from fake_sim import FakeSimulator
from test_api import raw_grid


def _run(on_done=None, emit=None):
    return api.run(json.dumps(raw_grid(4)), emit, simulator=FakeSimulator(), on_done=on_done)


def test_each_competitor_is_delivered_once_in_order_and_equals_final_entry():
    done: list = []
    text = _run(on_done=done.append)
    final = json.loads(text)["result"]["competitors"]
    assert [d["competitor"] for d in done] == list(COMPETITORS)
    for d in done:
        assert d["type"] == "competitor_done"
        assert d["result"] == final[d["competitor"]]


def test_done_arrives_before_the_run_returns_and_before_later_competitors_finish():
    order: list = []

    def emit(ev):
        order.append(("event", ev["competitor"]))

    def done(ev):
        order.append(("done", ev["competitor"]))

    _run(on_done=done, emit=emit)
    # Hybrid is delivered before any event of the second Competitor.
    first_done = order.index(("done", COMPETITORS[0]))
    second = COMPETITORS[1]
    assert all(i > first_done for i, o in enumerate(order) if o == ("event", second))


def test_result_text_is_identical_with_and_without_on_done():
    def strip(t):
        d = json.loads(t)
        for c in d["result"]["competitors"].values():
            c.get("stats", {}).pop("timings", None)
        return d

    assert strip(_run()) == strip(_run(on_done=lambda ev: None))


def test_emit_still_sees_only_run_events():
    events: list = []
    _run(on_done=lambda ev: None, emit=events.append)
    assert events and all(e["type"] == "run" for e in events)
