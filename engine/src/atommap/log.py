"""Append-only Decision_Log (Requirements 9.2, 9.3, 9.4)."""

from __future__ import annotations

from typing import Iterable, Iterator, Optional

from .model import Entry

SOURCES = ("rule", "atoms", "annealing", "coin flip")
ACTIONS = ("pick", "remove", "split", "skip")
CHANNELS = {"channel_plan": (1, 6, 11), "place": (1,)}


class DecisionLog:
    """Ordered, append-only record of decisions across all Rounds of one Competitor.

    The position of an entry in the log is the order in which it was made.
    """

    def __init__(self, mode: str, point_ids: Optional[Iterable[str]] = None):
        if mode not in CHANNELS:
            raise ValueError(f"Unknown mode {mode!r}")
        self._rounds = CHANNELS[mode]
        self._ids = None if point_ids is None else frozenset(point_ids)
        self._entries: list[Entry] = []

    def add(
        self,
        round: int,
        source: str,
        action: str,
        points: Iterable[str],
        rule: Optional[str] = None,
        reason: Optional[str] = None,
        message: Optional[str] = None,
    ) -> Entry:
        points = list(points)
        if round not in self._rounds:
            raise ValueError(f"Invalid round {round!r}; expected one of {self._rounds}")
        if source not in SOURCES:
            raise ValueError(f"Invalid source {source!r}")
        if action not in ACTIONS:
            raise ValueError(f"Invalid action {action!r}")
        if not points:
            raise ValueError("An entry needs at least one Point id")
        if self._ids is not None:
            unknown = [p for p in points if p not in self._ids]
            if unknown:
                raise ValueError(f"Unknown Point ids: {unknown}")
        if source == "rule":
            if not rule:
                raise ValueError("A 'rule' entry must carry the rule name")
        elif rule is not None:
            raise ValueError("Only 'rule' entries may carry a rule name")
        if action == "split" and not reason:
            raise ValueError("A 'split' entry needs a reason")
        if action == "skip" and message is None:
            raise ValueError("A 'skip' entry needs the exception message")
        entry = Entry(round, source, action, points, rule, reason, message)
        self._entries.append(entry)
        return entry

    def entries(self) -> list[Entry]:
        return list(self._entries)

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self) -> Iterator[Entry]:
        return iter(list(self._entries))

    def to_list(self) -> list[dict]:
        return [e.to_dict() for e in self._entries]
