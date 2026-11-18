"""Unit tests for the fake numba and the Lean_Mode import stubs (Req. 1.9, 1.10).

Both installers mutate global interpreter state, so:
* pure-Python behaviour is tested in-process behind a fixture that restores
  ``sys.modules`` and ``sys.meta_path``;
* checks that install the stubs for real run in a fresh subprocess.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SRC = str(Path(__file__).resolve().parents[1] / "src")


@pytest.fixture
def clean_state():
    """Run with no numba in sys.modules; restore modules and meta_path after."""
    saved_modules = dict(sys.modules)
    saved_path = list(sys.meta_path)
    sys.modules.pop("numba", None)
    try:
        yield
    finally:
        sys.meta_path[:] = saved_path
        sys.modules.clear()
        sys.modules.update(saved_modules)


def _run(code: str, timeout: int = 120) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["OPENBLAS_NUM_THREADS"] = "1"
    env["PYTHONPATH"] = SRC + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)],
        capture_output=True,
        text=True,
        env=env,
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Fake numba (in-process)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["njit", "jit"])
def test_jit_forms_return_working_function(clean_state, name):
    from atommap.boot import install_fake_numba

    deco = getattr(install_fake_numba(), name)

    @deco
    def bare(x):
        return x * 2 + 1

    @deco()
    def empty_call(x):
        return x * 2 + 1

    @deco(cache=True, nopython=True)
    def with_kwargs(x):
        return x * 2 + 1

    def plain(x):
        return x * 2 + 1

    wrapped = deco(plain)

    assert wrapped is plain
    for fn in (bare, empty_call, with_kwargs, wrapped):
        assert fn(5) == 11


def test_prange_is_range_and_types_exist(clean_state):
    from atommap.boot import install_fake_numba

    nb = install_fake_numba()
    assert nb.prange is range
    for type_name in ("int64", "int32", "float64", "complex128"):
        assert hasattr(nb, type_name)


def test_config_accepts_attribute_assignment(clean_state):
    from atommap.boot import install_fake_numba

    nb = install_fake_numba()
    nb.config.NUMBA_OPT = 3
    nb.config.SOMETHING_ELSE = "x"
    assert nb.config.NUMBA_OPT == 3
    assert nb.config.SOMETHING_ELSE == "x"


def test_fake_numba_is_idempotent_and_registered(clean_state):
    from atommap.boot import install_fake_numba

    first = install_fake_numba()
    assert sys.modules["numba"] is first
    assert install_fake_numba() is first


def test_existing_numba_is_left_alone(clean_state):
    import types

    from atommap.boot import install_fake_numba

    sentinel = types.ModuleType("numba")
    sys.modules["numba"] = sentinel
    assert install_fake_numba() is sentinel
    assert sys.modules["numba"] is sentinel


# ---------------------------------------------------------------------------
# Lean stubs
# ---------------------------------------------------------------------------


def test_install_lean_stubs_is_idempotent(clean_state):
    from atommap.boot import LeanStubFinder, install_lean_stubs

    first = install_lean_stubs()
    second = install_lean_stubs()
    assert first is second
    assert sys.meta_path[0] is first
    assert sum(isinstance(f, LeanStubFinder) for f in sys.meta_path) == 1


def test_stub_imports_resolve_to_stubs():
    proc = _run(
        """
        import json
        from atommap.boot import install_lean_stubs
        install_lean_stubs()
        install_lean_stubs()
        import boto3, botocore, s3transfer, jmespath
        import botocore.awsrequest
        from botocore.client import BaseClient
        from botocore.exceptions import ClientError
        import botocore.errorfactory as ef
        from botocore.config import Config
        mods = [boto3, botocore, s3transfer, jmespath, botocore.awsrequest]
        print(json.dumps({
            "stub": [getattr(m, "__atommap_stub__", False) for m in mods],
            "no_file": [getattr(m, "__file__", None) is None for m in mods],
            "base_client": BaseClient.__module__,
            "client_error": issubclass(ClientError, Exception),
            "same_error": ef.ClientError is ClientError,
            "config": Config(a=1).kwargs,
        }))
        """
    )
    assert proc.returncode == 0, proc.stderr
    result = json.loads(proc.stdout.strip().splitlines()[-1])
    assert all(result["stub"])
    assert all(result["no_file"])
    assert result["base_client"] == "atommap.boot"
    assert result["client_error"] is True
    assert result["same_error"] is True
    assert result["config"] == {"a": 1}


def test_braket_local_simulator_imports_with_both_installs():
    proc = _run(
        """
        from atommap.boot import install_fake_numba, install_lean_stubs
        install_fake_numba()
        install_lean_stubs()
        from braket.devices import LocalSimulator
        print("OK", LocalSimulator.__name__)
        """
    )
    assert proc.returncode == 0, proc.stderr
    assert "OK LocalSimulator" in proc.stdout
