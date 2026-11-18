"""Round driver (Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 3.9).

Channel_Plan runs 3 Rounds (channels 1, 6, 11), Place runs 1 Round. Each Round
works on the Points not picked in an earlier Round, so Rounds are disjoint.
After Channel_Plan, every Point that no Round picked goes in `five_ghz_only`.
A Round with no Points left still appears, with no picks. Zero Points give
empty Rounds.
"""

from __future__ import annotations

from typing import Callable, Optional, Sequence

from .log import CHANNELS
from .model import Round

__all__ = ["channels_for", "drive_rounds"]

# run_one(channel, available) -> (picks in order, per-Round output kept by the caller)
RunOne = Callable[[int, set], "tuple[list[str], object]"]


def channels_for(mode: str) -> tuple[int, ...]:
    if mode not in CHANNELS:
        raise ValueError(f"Unknown mode {mode!r}")
    return CHANNELS[mode]


def drive_rounds(
    mode: str, point_ids: Sequence[str], run_one: RunOne
) -> tuple[list[Round], Optional[list[str]], list[object]]:
    """Run every Round of `mode`.

    `run_one` gets the channel and a fresh set of the Points still available
    (possibly empty) and returns the picks and any per-Round output. Returns
    (rounds, five_ghz_only, outputs). `five_ghz_only` is None for Place.
    """
    ids = list(point_ids)
    remaining = set(ids)
    rounds: list[Round] = []
    outputs: list[object] = []
    for channel in channels_for(mode):
        picks, out = run_one(channel, set(remaining))
        picks = list(picks)
        stray = [p for p in picks if p not in remaining]
        if stray or len(set(picks)) != len(picks):
            raise RuntimeError(f"Round {channel} picked unavailable or repeated Points: {stray}")
        remaining.difference_update(picks)
        rounds.append(Round(channel, picks))
        outputs.append(out)
    five = [i for i in ids if i in remaining] if mode == "channel_plan" else None
    return rounds, five, outputs
