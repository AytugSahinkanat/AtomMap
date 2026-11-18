"""Copy the engine source into web/engine/ and write the file list with sha256.

Run from the repo root (standard library only):

    python scripts/build_engine_bundle.py

Output:
    web/engine/atommap/<files>      byte-for-byte copies of engine/src/atommap
    web/engine/engine-files.json    {"format": 1, "files": [{"path", "sha256"}]}

The worker downloads engine-files.json, fetches each file, checks the sha256
and writes it into Pyodide's site-packages/atommap. pytest runs the same
source files, so the hashes here are the hashes of the tested package (Req. 1.3).
Re-run after every change in engine/src/atommap.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "engine" / "src" / "atommap"
OUT = ROOT / "web" / "engine"


def main() -> int:
    if not SRC.is_dir():
        print(f"error: {SRC} not found", file=sys.stderr)
        return 1
    files = sorted(
        p
        for p in SRC.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    )
    if not files:
        print("error: no source files found", file=sys.stderr)
        return 1
    target = OUT / "atommap"
    if target.exists():
        shutil.rmtree(target)
    entries = []
    for p in files:
        rel = p.relative_to(SRC).as_posix()
        data = p.read_bytes()
        dest = target / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        entries.append({"path": rel, "sha256": hashlib.sha256(data).hexdigest()})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "engine-files.json").write_bytes(
        (json.dumps({"format": 1, "files": entries}, indent=2) + "\n").encode("utf-8")
    )
    print(f"wrote {len(entries)} files to {target} and {OUT / 'engine-files.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
