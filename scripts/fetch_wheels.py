"""Download the pinned wheels into wheels/ and write wheels/manifest.json.

Run by the user (not by the app), with the engine venv python, from the repo root:

    engine\\.venv\\Scripts\\python.exe scripts\\fetch_wheels.py

Pins come from engine/src/atommap/boot.py (loaded by path), so they are defined
once. Each wheel is fetched with ``pip download --no-deps --only-binary=:all:``.
Every file must be a pure-Python wheel (py3-none-any or py2.py3-none-any) whose
name and version match the pin. Exit code is non-zero on any problem.

Manifest format (wheels/manifest.json, UTF-8 JSON):

    {"format": 1,
     "wheels": [{"name": "<PEP 503 name>", "version": "<pinned>",
                 "filename": "<file>.whl", "sha256": "<hex>",
                 "set": "lean" | "full"}]}

"lean" wheels are always installed. "full" wheels only when Lean_Mode is off.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOT_PATH = ROOT / "engine" / "src" / "atommap" / "boot.py"
PURE_TAGS = {("none", "any")}


def normalize_name(name: str) -> str:
    """PEP 503 normalisation."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_wheel_filename(filename: str) -> tuple[str, str, str, str, str]:
    """Return (name, version, python tag, abi tag, platform tag).

    The name is PEP 503 normalised. Build tags are skipped.
    """
    if not filename.endswith(".whl"):
        raise ValueError(f"not a wheel: {filename}")
    parts = filename[:-4].split("-")
    if len(parts) not in (5, 6):
        raise ValueError(f"malformed wheel filename: {filename}")
    name, version = parts[0], parts[1]
    py, abi, plat = parts[-3], parts[-2], parts[-1]
    return normalize_name(name), version, py, abi, plat


def is_pure_python(filename: str) -> bool:
    """True for py3-none-any and py2.py3-none-any (any python tag mix of py2/py3)."""
    _, _, py, abi, plat = parse_wheel_filename(filename)
    pythons = set(py.split("."))
    return (abi, plat) == ("none", "any") and pythons <= {"py2", "py3"} and "py3" in pythons


def load_pins() -> tuple[dict[str, str], dict[str, str]]:
    spec = importlib.util.spec_from_file_location("atommap_boot_pins", BOOT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses need the module registered
    spec.loader.exec_module(module)
    return dict(module.PINNED_LEAN), dict(module.PINNED_FULL_ONLY)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_wheel(wheels_dir: Path, name: str, version: str) -> Path:
    """Find the single downloaded file for name==version."""
    matches = []
    for path in sorted(wheels_dir.glob("*.whl")):
        try:
            n, v, *_ = parse_wheel_filename(path.name)
        except ValueError:
            continue
        if n == name and v == version:
            matches.append(path)
    if len(matches) != 1:
        raise RuntimeError(f"{name} {version}: expected 1 wheel in {wheels_dir}, found {len(matches)}")
    return matches[0]


def build_entry(path: Path, name: str, version: str, which: str) -> dict:
    if not is_pure_python(path.name):
        raise RuntimeError(f"{name}: {path.name} is not a py3-none-any wheel")
    n, v, *_ = parse_wheel_filename(path.name)
    if n != name or v != version:
        raise RuntimeError(f"{name}: {path.name} does not match pin {version}")
    return {
        "name": name,
        "version": version,
        "filename": path.name,
        "sha256": sha256_of(path),
        "set": which,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Download pinned wheels into wheels/ and write wheels/manifest.json.")
    ap.add_argument("--out", type=Path, default=ROOT / "wheels", help="output dir (default: <repo>/wheels)")
    args = ap.parse_args(argv)

    lean, full_only = load_pins()
    pins = [(n, v, "lean") for n, v in lean.items()] + [(n, v, "full") for n, v in full_only.items()]
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    cmd = [sys.executable, "-m", "pip", "download", "--no-deps", "--only-binary=:all:", "-d", str(out)]
    cmd += [f"{n}=={v}" for n, v, _ in pins]
    print(f"Downloading {len(pins)} wheels into {out} ...")
    if subprocess.run(cmd).returncode != 0:
        print("ERROR: pip download failed (see output above). Manifest not written.", file=sys.stderr)
        return 1

    entries, errors = [], []
    for name, version, which in pins:
        try:
            entries.append(build_entry(find_wheel(out, name, version), name, version, which))
        except RuntimeError as exc:
            errors.append(str(exc))
    if errors:
        print("ERROR: wheel check failed:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print("Manifest not written.", file=sys.stderr)
        return 1

    manifest = {"format": 1, "wheels": entries}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    n_lean = sum(e["set"] == "lean" for e in entries)
    print(f"OK: {len(entries)} wheels ({n_lean} lean, {len(entries) - n_lean} full-only).")
    print(f"Manifest: {out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
