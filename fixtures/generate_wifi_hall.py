"""Generate the wifi hall fixtures (hero map and sparse control).

The committed JSON files are the source of truth. This script only documents
how they were made. Run: python fixtures/generate_wifi_hall.py
Jitter is uniform in [-jitter, +jitter] on each axis, from a fixed seed.
"""
import json
import random
from pathlib import Path

COLS, ROWS = 10, 7
R = 20.0

SPECS = {
    "wifi_hall_hero": {"spacing": 9.0, "jitter": 2.0, "jitter_seed": 20260001},
    "wifi_hall_sparse": {"spacing": 11.0, "jitter": 1.5, "jitter_seed": 20260002},
}


def build(name: str, spacing: float, jitter: float, jitter_seed: int) -> dict:
    rng = random.Random(jitter_seed)
    points = []
    for row in range(ROWS):
        for col in range(COLS):
            x = col * spacing + rng.uniform(-jitter, jitter)
            y = row * spacing + rng.uniform(-jitter, jitter)
            points.append({"id": f"ap{row * COLS + col:02d}", "x": round(x, 3), "y": round(y, 3)})
    return {
        "name": name,
        "grid": {"cols": COLS, "rows": ROWS, "spacing": spacing, "jitter": jitter},
        "jitter_seed": jitter_seed,
        "points": points,
        "graph": {"r": R},
    }


if __name__ == "__main__":
    out = Path(__file__).parent
    for name, spec in SPECS.items():
        data = build(name, **spec)
        (out / f"{name}.json").write_text(
            json.dumps(data, indent=1) + "\n", encoding="utf-8", newline="\n"
        )
