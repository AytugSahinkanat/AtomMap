"""The command line (engine spec, Requirement 13): `python -m atommap` only wraps api.run."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path

from atommap import api
from atommap.__main__ import main

# Three far-apart points: the rules pick all three, so no Simulator call is made.
REQUEST = json.dumps({
    "points": [{"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 100, "y": 0}, {"id": "c", "x": 0, "y": 100}],
    "mode": "place",
    "seed": 7,
    "graph": {"r": 10, "edges": []},
})


def _same(a: str, b: str) -> bool:
    """Equal results, apart from the wall-clock `timings` of the stats (they differ on every run)."""
    def strip(v):
        if isinstance(v, dict):
            return {k: strip(x) for k, x in v.items() if k != "timings"}
        if isinstance(v, list):
            return [strip(x) for x in v]
        return v
    return strip(json.loads(a)) == strip(json.loads(b))


def _run(argv, stdin_text=""):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, stdin=io.StringIO(stdin_text), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_file_prints_exactly_what_api_run_returns(tmp_path: Path):
    req = tmp_path / "request.json"
    req.write_text(REQUEST, encoding="utf-8")
    code, out, err = _run([str(req)])
    assert code == 0 and err == ""
    assert out.endswith("\n") and _same(out, api.run(REQUEST))
    assert json.loads(out)["ok"] is True


def test_stdin_and_out_file(tmp_path: Path):
    code, out, _ = _run(["-"], stdin_text=REQUEST)
    assert code == 0 and _same(out, api.run(REQUEST))
    target = tmp_path / "result.json"
    code, out, err = _run(["-", "--out", str(target)], stdin_text=REQUEST)
    assert code == 0 and out == "" and err == ""
    assert _same(target.read_text(encoding="utf-8"), api.run(REQUEST))


def test_lab_settings_pass_through_unchanged():
    lab = json.loads(REQUEST)
    lab["settings"] = {"shots": 20, "top_share": 1}
    text = json.dumps(lab)
    code, out, _ = _run(["-"], stdin_text=text)
    assert code == 0 and _same(out, api.run(text))


def test_rejected_request_prints_the_plain_error_and_exits_1():
    bad = json.loads(REQUEST)
    bad["settings"] = {"shots": 5}
    code, out, err = _run(["-"], stdin_text=json.dumps(bad))
    assert code == 1 and out == ""
    reply = json.loads(api.run(json.dumps(bad)))
    assert err.strip().startswith(f"ValidationError: {reply['error']['message']}")
    code, out, err = _run(["-"], stdin_text="{not json")
    assert code == 1 and out == "" and err.startswith("ValidationError: Request is not valid JSON")


def test_items_named_in_the_message_are_not_repeated():
    code, out, err = _run(["-"], stdin_text="{}")
    assert code == 1 and out == ""
    line = err.strip()
    assert line.startswith("ValidationError: Missing required items: points")
    assert "(" not in line  # every item is in the message already


def test_missing_file_exits_1(tmp_path: Path):
    code, out, err = _run([str(tmp_path / "nope.json")])
    assert code == 1 and out == "" and err.startswith("Cannot read the request:")


def test_python_dash_m_entry_point(tmp_path: Path):
    req = tmp_path / "request.json"
    req.write_text(REQUEST, encoding="utf-8")
    env = {**os.environ, "OPENBLAS_NUM_THREADS": "1"}
    p = subprocess.run([sys.executable, "-m", "atommap", str(req)], capture_output=True, text=True, env=env,
                       cwd=Path(__file__).resolve().parents[1] / "src", timeout=300)
    assert p.returncode == 0, p.stderr
    assert _same(p.stdout, api.run(REQUEST))
