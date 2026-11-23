"""Record the four Tutor runs from the native Engine (tutor spec, task 2.1).

Run by hand from the repo root, with the engine venv:

    $env:OPENBLAS_NUM_THREADS=1; engine\\.venv\\Scripts\\python.exe scripts\\record_tutor_runs.py

Each run calls `atommap.api.run` with the real Braket simulator and writes
`web/test-data/tutor/<name>.json` as {"request", "events", "result"}.
`events` are all progress events in arrival order. `result` is the `result`
object of a successful run.

The settings below are fixed before any run (honesty rule 8). Do not tune them
after looking at results. Fixtures are read from files; nothing is fetched.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Must be set before numpy loads (steering: tests and runs use one BLAS thread).
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine" / "src"))

OUT_DIR = ROOT / "web" / "test-data" / "tutor"
FIXTURES = ROOT / "fixtures"

SEED = 1

# Hand-made tree of 6 Points. Neighbours are 8 m apart, every other pair is
# more than 10 m apart, so with r = 10 the graph is a tree (a path
# t0-t1-t2-t3-t5 with t4 hanging off t2). The simplicial rule solves a tree
# alone, so the atoms are not needed.
TREE_R = 10.0
TREE_POINTS = [
    {"id": "t0", "x": 0.0, "y": 0.0},
    {"id": "t1", "x": 8.0, "y": 0.0},
    {"id": "t2", "x": 16.0, "y": 0.0},
    {"id": "t3", "x": 24.0, "y": 0.0},
    {"id": "t4", "x": 16.0, "y": 8.0},
    {"id": "t5", "x": 32.0, "y": 0.0},
]

# name -> (fixture file or None for the tree, mode)
# Channel_Plan on the hall fixtures uses walls off: no `edges`, only `graph.r`.
RUNS = {
    "hero_seed1": ("wifi_hall_hero.json", "channel_plan"),
    "sparse_seed1": ("wifi_hall_sparse.json", "channel_plan"),
    "rules_only": (None, "channel_plan"),
    "place_rules_only": (None, "place"),  # straight line: no `edges`
}


def build_request(fixture: str | None, mode: str) -> dict:
    if fixture is None:
        points = [dict(p) for p in TREE_POINTS]
        r = TREE_R
    else:
        data = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))
        points = [{"id": p["id"], "x": p["x"], "y": p["y"]} for p in data["points"]]
        r = data["graph"]["r"]
    return {"points": points, "mode": mode, "graph": {"r": r}, "seed": SEED}


def record(name: str, fixture: str | None, mode: str) -> Path:
    from atommap.api import run

    request = build_request(fixture, mode)
    events: list[dict] = []
    text = run(json.dumps(request), emit=events.append)
    response = json.loads(text)
    if not response.get("ok"):
        raise RuntimeError(f"{name}: run failed: {response.get('error')}")
    path = OUT_DIR / f"{name}.json"
    payload = {"request": request, "events": events, "result": response["result"]}
    path.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    return path


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, (fixture, mode) in RUNS.items():
        print(f"recording {name} ...", flush=True)
        paths.append(record(name, fixture, mode))
    print("Done. Written:")
    for p in paths:
        print(f"  {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
