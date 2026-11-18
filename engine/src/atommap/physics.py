"""Shared physical constants (Requirement 5.1, 6). Not overridable."""

from __future__ import annotations

C6 = 5.42e-24  # rad * m^6 / s
OMEGA = 15.8e6  # rad / s


def blockade_radius_m() -> float:
    """Blockade radius (C6 / omega) ** (1/6) in metres, about 8.37e-6."""
    return (C6 / OMEGA) ** (1.0 / 6.0)
