import os

import pytest


def pytest_configure(config):
    """Fail the whole run before any test if OPENBLAS_NUM_THREADS is not 1."""
    value = os.environ.get("OPENBLAS_NUM_THREADS")
    if value != "1":
        shown = "unset" if value is None else repr(value)
        raise pytest.UsageError(
            f"OPENBLAS_NUM_THREADS must be 1 (found {shown}). "
            "Set OPENBLAS_NUM_THREADS=1 and run pytest again."
        )


@pytest.fixture(scope="session")
def settings():
    from atommap.settings import load_settings

    return load_settings()
