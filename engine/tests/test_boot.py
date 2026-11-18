"""Native tests for the pure parts of boot.py and scripts/fetch_wheels.py."""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from atommap import boot
from atommap.boot import BootError

ROOT = Path(__file__).resolve().parents[2]


def _make(tmp_path: Path, data: dict[str, bytes] | None = None):
    """Write fake wheels for every pin; return (manifest_text, wheel dir)."""
    wheels = []
    for which, pins in (("lean", boot.PINNED_LEAN), ("full", boot.PINNED_FULL_ONLY)):
        for name, version in pins.items():
            fname = f"{name.replace('-', '_')}-{version}-py3-none-any.whl"
            content = (data or {}).get(name, f"{name}{version}".encode())
            (tmp_path / fname).write_bytes(content)
            wheels.append(
                {
                    "name": name,
                    "version": version,
                    "filename": fname,
                    "sha256": hashlib.sha256(f"{name}{version}".encode()).hexdigest(),
                    "set": which,
                }
            )
    return json.dumps({"format": 1, "wheels": wheels}), tmp_path


def _blobs(entries, d: Path):
    return {e.filename: (d / e.filename).read_bytes() if (d / e.filename).exists() else None for e in entries}


def test_builtin_count():
    assert len(boot.BUILTIN_PACKAGES) == 16


def test_lean_vs_full_selection(tmp_path):
    text, _ = _make(tmp_path)
    entries = boot.parse_manifest(text)
    lean = {e.name for e in boot.select_entries(entries, lean_mode=True)}
    full = {e.name for e in boot.select_entries(entries, lean_mode=False)}
    assert lean == set(boot.PINNED_LEAN)
    assert full == set(boot.PINNED_LEAN) | set(boot.PINNED_FULL_ONLY)
    assert "boto3" not in lean and "botocore" in full


def test_all_good(tmp_path):
    text, d = _make(tmp_path)
    sel = boot.select_entries(boot.parse_manifest(text), lean_mode=False)
    boot.verify_all(sel, _blobs(sel, d))


def test_wrong_hash_names_dependency(tmp_path):
    text, d = _make(tmp_path, {"backoff": b"tampered"})
    sel = boot.select_entries(boot.parse_manifest(text), lean_mode=True)
    with pytest.raises(BootError) as ei:
        boot.verify_all(sel, _blobs(sel, d))
    assert ei.value.dependency == "backoff"
    assert "backoff" in str(ei.value)


def test_missing_file_names_dependency(tmp_path):
    text, d = _make(tmp_path)
    (d / "oqpy-0.3.11-py3-none-any.whl").unlink()
    sel = boot.select_entries(boot.parse_manifest(text), lean_mode=True)
    with pytest.raises(BootError) as ei:
        boot.verify_all(sel, _blobs(sel, d))
    assert ei.value.dependency == "oqpy"


def test_missing_file_only_matters_for_selected_set(tmp_path):
    text, d = _make(tmp_path)
    (d / "boto3-1.44.4-py3-none-any.whl").unlink()
    sel = boot.select_entries(boot.parse_manifest(text), lean_mode=True)
    boot.verify_all(sel, _blobs(sel, d))
    sel = boot.select_entries(boot.parse_manifest(text), lean_mode=False)
    with pytest.raises(BootError) as ei:
        boot.verify_all(sel, _blobs(sel, d))
    assert ei.value.dependency == "boto3"


def test_wrong_version_in_manifest(tmp_path):
    text, _ = _make(tmp_path)
    doc = json.loads(text)
    for w in doc["wheels"]:
        if w["name"] == "boltons":
            w["version"] = "26.2.1"
    with pytest.raises(BootError) as ei:
        boot.select_entries(boot.parse_manifest(json.dumps(doc)), lean_mode=True)
    assert ei.value.dependency == "boltons"


def test_wrong_version_in_filename(tmp_path):
    text, d = _make(tmp_path)
    doc = json.loads(text)
    for w in doc["wheels"]:
        if w["name"] == "cloudpickle":
            w["filename"] = "cloudpickle-2.2.0-py3-none-any.whl"
    entries = boot.parse_manifest(json.dumps(doc))
    sel = boot.select_entries(entries, lean_mode=True)
    blobs = _blobs(sel, d)
    blobs["cloudpickle-2.2.0-py3-none-any.whl"] = b"cloudpickle2.2.1"
    with pytest.raises(BootError) as ei:
        boot.verify_all(sel, blobs)
    assert ei.value.dependency == "cloudpickle"


def test_pin_missing_from_manifest(tmp_path):
    text, _ = _make(tmp_path)
    doc = json.loads(text)
    doc["wheels"] = [w for w in doc["wheels"] if w["name"] != "openqasm3"]
    with pytest.raises(BootError) as ei:
        boot.select_entries(boot.parse_manifest(json.dumps(doc)), lean_mode=True)
    assert ei.value.dependency == "openqasm3"


@pytest.mark.parametrize(
    "text",
    ["not json", "[]", '{"format": 2, "wheels": []}', '{"format": 1, "wheels": [{"name": "x"}]}'],
)
def test_bad_manifest(text):
    with pytest.raises(BootError):
        boot.parse_manifest(text)


def test_install_aborts_before_touching_pyodide():
    """Verification fails first, so micropip/pyodide_js are never imported."""
    entries = [
        {
            "name": n,
            "version": v,
            "filename": f"{n.replace('-', '_')}-{v}-py3-none-any.whl",
            "sha256": "0" * 64,
            "set": "lean",
        }
        for n, v in boot.PINNED_LEAN.items()
    ]
    text = json.dumps({"format": 1, "wheels": entries})

    async def read(_name):
        return b"wrong"

    with pytest.raises(BootError) as ei:
        asyncio.run(boot.install_packages(text, read, lean_mode=True))
    assert ei.value.dependency in boot.PINNED_LEAN


# --- scripts/fetch_wheels.py helpers ---------------------------------------


def _load_fetch():
    spec = importlib.util.spec_from_file_location("fetch_wheels", ROOT / "scripts" / "fetch_wheels.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_fetch_helpers():
    f = _load_fetch()
    assert f.normalize_name("Amazon_Braket.SDK") == "amazon-braket-sdk"
    assert f.parse_wheel_filename("opt_einsum-3.4.0-py3-none-any.whl")[:2] == ("opt-einsum", "3.4.0")
    assert f.is_pure_python("six-1.0-py2.py3-none-any.whl")
    assert f.is_pure_python("x-1-py3-none-any.whl")
    assert not f.is_pure_python("numpy-2.0-cp312-cp312-win_amd64.whl")
    assert not f.is_pure_python("x-1-py3-none-manylinux1_x86_64.whl")


def test_fetch_pins_match_boot():
    f = _load_fetch()
    lean, full = f.load_pins()
    assert lean == dict(boot.PINNED_LEAN) and full == dict(boot.PINNED_FULL_ONLY)
