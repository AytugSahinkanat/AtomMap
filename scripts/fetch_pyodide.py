"""Download the pinned Pyodide runtime and its built-in packages into pyodide/.

Standard library only. Run from the repo root (the web build runs it for you):

    py -3 scripts/fetch_pyodide.py

This is a build-time download. At runtime the app fetches nothing outside dist/.
The version is pinned to 0.27.7 and must not be upgraded (Braket breaks on newer
versions). Packages are the ones in BUILTIN_PACKAGES of engine/src/atommap/boot.py
plus everything they depend on, resolved through pyodide-lock.json. Each package
file is checked against the sha256 in the lock file. Files already present and
correct are skipped. Files not needed any more are removed.

Output: pyodide/ (git-ignored), copied to dist/pyodide/ by the web build.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import urllib.request
from pathlib import Path

VERSION = "0.27.7"
BASE = f"https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pyodide"
BOOT_PATH = ROOT / "engine" / "src" / "atommap" / "boot.py"
CORE = [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
]


def builtin_packages() -> tuple[str, ...]:
    spec = importlib.util.spec_from_file_location("atommap_boot_pins", BOOT_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules["atommap_boot_pins"] = mod  # dataclasses need the module registered
    spec.loader.exec_module(mod)
    return tuple(mod.BUILTIN_PACKAGES)


def download(name: str, expect_sha: str | None) -> None:
    dest = OUT / name
    if dest.is_file() and (
        expect_sha is None or hashlib.sha256(dest.read_bytes()).hexdigest() == expect_sha
    ):
        return
    print(f"fetch {name}")
    with urllib.request.urlopen(BASE + name, timeout=120) as r:
        data = r.read()
    if expect_sha is not None and hashlib.sha256(data).hexdigest() != expect_sha:
        raise SystemExit(f"error: sha256 mismatch for {name}")
    dest.write_bytes(data)


def main() -> int:
    OUT.mkdir(exist_ok=True)
    download("pyodide-lock.json", None)
    lock = json.loads((OUT / "pyodide-lock.json").read_text(encoding="utf-8"))
    if lock["info"]["version"] != VERSION:
        raise SystemExit(f"error: lock file is for {lock['info']['version']}, not {VERSION}")
    pkgs = lock["packages"]
    seen: dict[str, dict] = {}

    def add(name: str) -> None:
        key = name.lower().replace("_", "-")
        key = key if key in pkgs else name
        if key in seen:
            return
        if key not in pkgs:
            raise SystemExit(f"error: package {name} is not in the Pyodide lock file")
        seen[key] = pkgs[key]
        for dep in pkgs[key]["depends"]:
            add(dep)

    for p in builtin_packages():
        add(p)
    for name in CORE[:-1]:
        download(name, None)
    for key, info in sorted(seen.items()):
        download(info["file_name"], info["sha256"])
    # Drop files left over from an earlier, larger package list.
    keep = set(CORE) | {info["file_name"] for info in seen.values()}
    for stale in sorted(OUT.iterdir()):
        if stale.is_file() and stale.name not in keep:
            print(f"remove {stale.name}")
            stale.unlink()
    print(f"pyodide {VERSION}: {len(CORE)} core files, {len(seen)} packages in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
