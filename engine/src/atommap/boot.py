"""Pyodide boot: load built-in packages, check and install pinned wheels.

Tasks 1.1 and 1.2 (Req. 1.1, 1.5 to 1.11). Task 1.2 adds the fake numba
module and the Lean_Mode import hook (Req. 1.9, 1.10); see the bottom of this
file.

Layout
------
* Pure functions (no Pyodide, standard library only): ``parse_manifest``,
  ``select_entries``, ``check_wheel_bytes``, ``verify_all``. They are tested
  natively.
* ``install_packages`` is the thin async part that talks to Pyodide/micropip.
  Nothing is loaded or installed until every wheel passed verification.

Pins
----
``PINNED_LEAN`` and ``PINNED_FULL_ONLY`` are the single source of truth for
pinned versions. ``scripts/fetch_wheels.py`` loads this file by path to build
``wheels/manifest.json``, so this module must stay importable without Pyodide.

Manifest format (``wheels/manifest.json``, UTF-8 JSON)
------------------------------------------------------
::

    {
      "format": 1,
      "wheels": [
        {
          "name": "amazon-braket-sdk",   # PEP 503 normalised distribution name
          "version": "1.127.8",
          "filename": "amazon_braket_sdk-1.127.8-py3-none-any.whl",
          "sha256": "<64 lowercase hex chars>",
          "set": "lean"                   # "lean" = always, "full" = only when
        }                                 # Lean_Mode is off
      ]
    }

No PyPI requests are made. Wheels come only from the self-hosted ``wheels/``.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Iterable, Mapping, Sequence

MANIFEST_FORMAT = 1
MANIFEST_NAME = "manifest.json"

# Req. 1.5: Pyodide 0.27.7 built-in packages (15).
BUILTIN_PACKAGES: tuple[str, ...] = (
    "numpy",
    "scipy",
    "micropip",
    "ssl",
    "pydantic",
    "pydantic_core",
    "annotated-types",
    "typing_extensions",
    "sympy",
    "mpmath",
    "packaging",
    "python-dateutil",
    "six",
    "urllib3",
    "setuptools",
)

# Req. 1.6: always installed from self-hosted wheels.
PINNED_LEAN: Mapping[str, str] = {
    "amazon-braket-sdk": "1.127.8",
    "amazon-braket-default-simulator": "1.43.1",
    "amazon-braket-schemas": "1.33.0",
    "antlr4-python3-runtime": "4.13.2",
    "backoff": "2.2.1",
    "boltons": "26.2.0",
    "cloudpickle": "2.2.1",
    "mypy-extensions": "1.2.0",
    "nest-asyncio": "1.6.0",
    "openpulse": "1.0.1",
    "openqasm3": "1.0.2",
    "opt-einsum": "3.4.0",
    "oqpy": "0.3.11",
}

# Req. 1.11: added when Lean_Mode is off.
# boto3 is read as sharing botocore's pin ("boto3 and botocore 1.44.4").
PINNED_FULL_ONLY: Mapping[str, str] = {
    "boto3": "1.44.4",
    "botocore": "1.44.4",
    "s3transfer": "0.19.3",
    "jmespath": "1.1.0",
}


class BootError(RuntimeError):
    """Initialization failed. ``dependency`` names the offending package."""

    def __init__(self, dependency: str, reason: str):
        self.dependency = dependency
        self.reason = reason
        super().__init__(f"{dependency}: {reason}")


@dataclass(frozen=True)
class WheelEntry:
    name: str
    version: str
    filename: str
    sha256: str
    set: str  # "lean" or "full"


def normalize_name(name: str) -> str:
    """PEP 503 normalisation."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_wheel_filename(filename: str) -> tuple[str, str]:
    """Return (normalised name, version) from a wheel filename."""
    if not filename.endswith(".whl"):
        raise ValueError(f"not a wheel filename: {filename!r}")
    parts = filename[:-4].split("-")
    if len(parts) < 5:
        raise ValueError(f"malformed wheel filename: {filename!r}")
    return normalize_name(parts[0]), parts[1]


def parse_manifest(text: str) -> list[WheelEntry]:
    """Parse manifest JSON text. Raises BootError('manifest', ...) if invalid."""
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise BootError("manifest", f"not valid JSON ({exc})") from exc
    if not isinstance(data, dict) or data.get("format") != MANIFEST_FORMAT:
        raise BootError("manifest", f"unsupported format (expected {MANIFEST_FORMAT})")
    wheels = data.get("wheels")
    if not isinstance(wheels, list):
        raise BootError("manifest", "'wheels' must be a list")
    entries: list[WheelEntry] = []
    for i, raw in enumerate(wheels):
        if not isinstance(raw, dict):
            raise BootError("manifest", f"wheels[{i}] is not an object")
        label = raw.get("name") if isinstance(raw.get("name"), str) else f"wheels[{i}]"
        values = {}
        for key in ("name", "version", "filename", "sha256", "set"):
            value = raw.get(key)
            if not isinstance(value, str) or not value:
                raise BootError(label, f"manifest entry has no valid '{key}'")
            values[key] = value
        if values["set"] not in ("lean", "full"):
            raise BootError(label, "manifest 'set' must be 'lean' or 'full'")
        if not re.fullmatch(r"[0-9a-f]{64}", values["sha256"]):
            raise BootError(label, "manifest sha256 is not 64 lowercase hex chars")
        values["name"] = normalize_name(values["name"])
        entries.append(WheelEntry(**values))
    return entries


def select_entries(entries: Sequence[WheelEntry], lean_mode: bool) -> list[WheelEntry]:
    """Pick the wheels to install and check the manifest against the pins.

    Lean_Mode on: the lean set. Lean_Mode off: lean set plus the full-only set.
    A missing pin or a manifest version different from the pin names that
    dependency in a BootError.
    """
    required = dict(PINNED_LEAN)
    if not lean_mode:
        required.update(PINNED_FULL_ONLY)
    by_name = {e.name: e for e in entries}
    selected: list[WheelEntry] = []
    for name, version in required.items():
        entry = by_name.get(name)
        if entry is None:
            raise BootError(name, "missing from the wheel manifest")
        if entry.version != version:
            raise BootError(
                name, f"manifest version {entry.version} does not match pinned {version}"
            )
        selected.append(entry)
    return selected


def check_wheel_bytes(entry: WheelEntry, data: bytes | None) -> None:
    """Check one wheel's presence, filename version and sha256."""
    if data is None:
        raise BootError(entry.name, f"wheel {entry.filename} is missing")
    try:
        file_name, file_version = parse_wheel_filename(entry.filename)
    except ValueError as exc:
        raise BootError(entry.name, str(exc)) from exc
    if file_name != entry.name or file_version != entry.version:
        raise BootError(
            entry.name,
            f"filename {entry.filename} does not match {entry.name} {entry.version}",
        )
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry.sha256:
        raise BootError(entry.name, f"sha256 mismatch for {entry.filename}")


def verify_all(
    entries: Iterable[WheelEntry], blobs: Mapping[str, bytes | None]
) -> None:
    """Verify every wheel (blobs keyed by filename). Raises on the first failure."""
    for entry in entries:
        check_wheel_bytes(entry, blobs.get(entry.filename))


# ---------------------------------------------------------------------------
# Thin Pyodide part
# ---------------------------------------------------------------------------

ReadBytes = Callable[[str], Awaitable["bytes | None"]]


async def install_packages(
    manifest_text: str,
    read_wheel: ReadBytes,
    lean_mode: bool,
    *,
    wheel_dir: str = "/tmp/atommap_wheels",
    progress: Callable[[str, int], None] | None = None,
) -> None:
    """Verify all wheels, then load built-ins and install the wheels.

    ``read_wheel(filename)`` returns the bytes of a file under the self-hosted
    ``wheels/`` location, or None if it is missing. Nothing is loaded or
    installed before every wheel passed verification (Req. 1.7). The installed
    bytes are the verified bytes (written to Pyodide's FS, installed through
    micropip's ``emfs:`` scheme), so no network request is made (Req. 1.8).
    Wheels are installed one by one so that an install failure names its
    dependency.
    """
    report = progress or (lambda stage, percent: None)

    report("verify", 0)
    selected = select_entries(parse_manifest(manifest_text), lean_mode)
    blobs: dict[str, bytes | None] = {}
    for entry in selected:
        blobs[entry.filename] = await read_wheel(entry.filename)
    verify_all(selected, blobs)
    report("verify", 100)

    import os

    import pyodide_js  # type: ignore[import-not-found]  # Pyodide only

    report("builtins", 0)
    await pyodide_js.loadPackage(list(BUILTIN_PACKAGES))
    report("builtins", 100)

    # micropip is one of the built-in packages, so it can only be imported after loadPackage.
    import micropip  # type: ignore[import-not-found]  # Pyodide only

    os.makedirs(wheel_dir, exist_ok=True)
    for i, entry in enumerate(selected):
        data = blobs[entry.filename]
        assert data is not None
        path = f"{wheel_dir}/{entry.filename}"
        with open(path, "wb") as fh:
            fh.write(data)
        try:
            await micropip.install(f"emfs:{path}", deps=False)
        except Exception as exc:
            raise BootError(entry.name, f"install failed ({exc})") from exc
        report("wheels", round(100 * (i + 1) / len(selected)))


# ---------------------------------------------------------------------------
# Fake numba (Req. 1.9) and Lean_Mode import stubs (Req. 1.10)
# ---------------------------------------------------------------------------
#
# Boot order: ``install_fake_numba()`` always, before any braket import.
# ``install_lean_stubs()`` only when Lean_Mode is on, also before braket.
# Both are idempotent and work natively. If the real module is already
# imported, fake numba leaves it alone. ``install_lean_stubs`` puts its finder
# first in ``sys.meta_path`` so the stubs win even when the real packages are
# installed (used by native tests); it does not replace modules already in
# ``sys.modules``.
#
# What Braket touches at import time (grepped in braket 1.127.8):
#   numba (default_simulator/linalg_utils.py): ``nb.config.<ATTR> = value``,
#     ``nb.njit`` / ``nb.jit`` / ``nb.prange`` / ``nb.int64`` etc.
#   boto3: ``import boto3`` (aws_session, aws_quantum_task, aws_quantum_job,
#     program_set_quantum_task_result); no attribute is used at import time.
#   botocore: ``botocore.exceptions.ClientError``, ``botocore.errorfactory
#     .ClientError``, ``botocore.config.Config``, ``botocore.client`` (module,
#     plus ``BaseClient``), ``botocore.awsrequest`` (module).
#   s3transfer, jmespath: not imported by Braket directly; stubbed so that
#     nothing in the dependency chain pulls the real ones.

import importlib.abc
import importlib.machinery
import sys
import types


class _NumbaConfig:
    """Accepts any attribute assignment (``nb.config.NUMBA_OPT = 3``)."""

    def __getattr__(self, name: str):  # only called for unset attributes
        if name.startswith("__"):
            raise AttributeError(name)
        return None


def _passthrough_jit(*args, **kwargs):
    """Fake ``numba.njit`` / ``numba.jit``.

    ``@njit``, ``@njit()``, ``@njit(cache=True)`` and ``njit(fn)`` all work and
    return the original function unchanged.
    """
    if len(args) == 1 and not kwargs and callable(args[0]):
        return args[0]

    def decorator(fn):
        return fn

    return decorator


class _FakeNumbaType:
    def __init__(self, name: str):
        self.name = name

    def __repr__(self) -> str:
        return f"<fake numba type {self.name}>"

    def __call__(self, *args, **kwargs):
        # numba types are also used as casts; keep it harmless.
        return args[0] if args else None


def install_fake_numba() -> types.ModuleType:
    """Register a fake ``numba`` in ``sys.modules`` (idempotent).

    Provides ``config``, ``njit``, ``jit``, ``prange`` (= ``range``), ``int64``,
    ``int32``, ``float64`` and ``complex128``. A numba module that is already
    in ``sys.modules`` (real or fake) is left untouched.
    """
    existing = sys.modules.get("numba")
    if existing is not None:
        return existing
    mod = types.ModuleType("numba")
    mod.__doc__ = "Fake numba installed by atommap.boot (no JIT)."
    mod.__atommap_fake__ = True  # type: ignore[attr-defined]
    mod.config = _NumbaConfig()  # type: ignore[attr-defined]
    mod.njit = _passthrough_jit  # type: ignore[attr-defined]
    mod.jit = _passthrough_jit  # type: ignore[attr-defined]
    mod.prange = range  # type: ignore[attr-defined]
    for type_name in ("int64", "int32", "float64", "complex128"):
        setattr(mod, type_name, _FakeNumbaType(type_name))
    sys.modules["numba"] = mod
    return mod


LEAN_STUB_ROOTS: tuple[str, ...] = ("boto3", "botocore", "s3transfer", "jmespath")


class _StubClientError(Exception):
    """Stand-in for ``botocore.exceptions.ClientError``."""

    def __init__(self, error_response=None, operation_name: str = ""):
        super().__init__(error_response, operation_name)
        self.response = error_response or {}
        self.operation_name = operation_name


class _StubBaseClient:
    """Stand-in for ``botocore.client.BaseClient`` (Req. 1.10)."""


class _StubConfig:
    """Stand-in for ``botocore.config.Config``."""

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


def _stub_attributes(fullname: str) -> dict:
    """Explicit attributes per stubbed module; other modules are empty."""
    if fullname == "botocore.client":
        return {"BaseClient": _StubBaseClient}
    if fullname == "botocore.exceptions":
        return {"ClientError": _StubClientError}
    if fullname == "botocore.errorfactory":
        return {"ClientError": _StubClientError}
    if fullname == "botocore.config":
        return {"Config": _StubConfig}
    return {}


class _StubLoader(importlib.abc.Loader):
    def create_module(self, spec):
        return None  # default module creation

    def exec_module(self, module: types.ModuleType) -> None:
        module.__atommap_stub__ = True  # type: ignore[attr-defined]
        module.__path__ = []  # type: ignore[attr-defined]  # lets submodules resolve
        for key, value in _stub_attributes(module.__name__).items():
            setattr(module, key, value)


class LeanStubFinder(importlib.abc.MetaPathFinder):
    """Return stub modules for boto3, botocore, s3transfer, jmespath and any
    of their submodules."""

    _loader = _StubLoader()

    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".", 1)[0] not in LEAN_STUB_ROOTS:
            return None
        return importlib.machinery.ModuleSpec(
            fullname, self._loader, is_package=True
        )


def install_lean_stubs() -> LeanStubFinder:
    """Install the Lean_Mode import hook (idempotent).

    The finder goes to the front of ``sys.meta_path``. Returns the installed
    finder.
    """
    for finder in sys.meta_path:
        if isinstance(finder, LeanStubFinder):
            return finder
    finder = LeanStubFinder()
    sys.meta_path.insert(0, finder)
    return finder
