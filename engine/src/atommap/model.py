"""Data model and request validation (Requirements 2.1, 2.3 to 2.8)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

MODES = ("channel_plan", "place")
COMPETITOR_NAMES = ("Atoms_Alone", "Hybrid", "Annealing_Rules", "Coin_Flip_Rules")


class ValidationError(ValueError):
    """A request was rejected. `items` names every offending item."""

    def __init__(self, kind: str, message: str, items: list[str]):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.items = items

    def to_dict(self) -> dict:
        return {"error": {"type": self.kind, "message": self.message, "items": self.items}}


@dataclass(frozen=True)
class Point:
    id: str
    x: float  # metres
    y: float  # metres


@dataclass(frozen=True)
class Request:
    points: tuple[Point, ...]
    mode: str
    r: float
    edges: Optional[tuple[tuple[str, str], ...]]  # None means "build from r alone"
    seed: int
    competitors: Optional[tuple[str, ...]] = None  # None means all four


@dataclass
class Entry:
    round: int
    source: str  # rule | atoms | annealing | coin flip
    action: str  # pick | remove | split | skip
    points: list[str]
    rule: Optional[str] = None
    reason: Optional[str] = None
    message: Optional[str] = None

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "round": self.round,
            "source": self.source,
            "action": self.action,
            "points": list(self.points),
        }
        for name in ("rule", "reason", "message"):
            value = getattr(self, name)
            if value is not None:
                d[name] = value
        return d


@dataclass
class Stats:
    picks_per_round: list[int] = field(default_factory=list)
    picks_per_source: dict[str, int] = field(default_factory=dict)
    quantum_share: float = 0.0
    atoms_not_needed: bool = False
    splits: int = 0
    skipped_tiles: int = 0
    mismatches: int = 0
    braket_calls: int = 0
    cache_hits: int = 0
    layout_fallbacks: int = 0
    timings: dict[str, float] = field(default_factory=dict)
    gaps: Optional[list[str]] = None  # only for Atoms_Alone
    quantum_picks: int = 0  # picks made in atom-informed steps
    total_picks: int = 0

    def to_dict(self) -> dict:
        d = {
            "quantum_picks": self.quantum_picks,
            "total_picks": self.total_picks,
            "picks_per_round": list(self.picks_per_round),
            "picks_per_source": dict(self.picks_per_source),
            "quantum_share": self.quantum_share,
            "atoms_not_needed": self.atoms_not_needed,
            "splits": self.splits,
            "skipped_tiles": self.skipped_tiles,
            "mismatches": self.mismatches,
            "braket_calls": self.braket_calls,
            "cache_hits": self.cache_hits,
            "layout_fallbacks": self.layout_fallbacks,
            "timings": dict(self.timings),
        }
        if self.gaps is not None:
            d["gaps"] = list(self.gaps)
        return d


@dataclass
class Round:
    channel: Optional[int]  # 1, 6 or 11 for Channel_Plan; Place uses 1
    picks: list[str]


@dataclass
class CompetitorResult:
    name: str
    rounds: list[Round]
    decision_log: list[Entry]
    stats: Stats
    label: str = "simulation"
    five_ghz_only: Optional[list[str]] = None

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "name": self.name,
            "label": self.label,
            "rounds": [{"channel": r.channel, "picks": list(r.picks)} for r in self.rounds],
            "decision_log": [e.to_dict() for e in self.decision_log],
            "stats": self.stats.to_dict(),
        }
        if self.five_ghz_only is not None:
            d["five_ghz_only"] = list(self.five_ghz_only)
        return d


@dataclass
class Result:
    meta: dict
    competitors: dict[str, Any]  # name -> CompetitorResult | {"error": str}

    def to_dict(self) -> dict:
        return {
            "meta": dict(self.meta),
            "competitors": {
                k: (v.to_dict() if isinstance(v, CompetitorResult) else v)
                for k, v in self.competitors.items()
            },
        }


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _find_missing(raw: dict) -> list[str]:
    missing: list[str] = []
    points = raw.get("points")
    if points is None:
        missing.append("points")
    elif isinstance(points, list):
        for i, p in enumerate(points):
            if not isinstance(p, dict):
                missing.append(f"points[{i}]")
                continue
            for key in ("id", "x", "y"):
                if p.get(key) is None:
                    missing.append(f"points[{i}].{key}")
    if raw.get("mode") is None:
        missing.append("mode")
    graph = raw.get("graph")
    if graph is None:
        missing.append("graph")
    elif not isinstance(graph, dict) or graph.get("r") is None:
        missing.append("graph.r")
    if raw.get("seed") is None:
        missing.append("seed")
    return missing


def _edge_ids(edges: Any) -> list[tuple[Any, Any]]:
    out = []
    for e in edges:
        if isinstance(e, (list, tuple)) and len(e) == 2:
            out.append((e[0], e[1]))
        else:
            raise ValidationError("invalid_edge", f"Edge is not a pair of ids: {e!r}", [repr(e)])
    return out


def validate_request(raw: Any) -> Request:
    """Validate a request dict and return a Request, or raise ValidationError.

    Order of checks: missing fields, Seed type, Mode, duplicate ids,
    unknown edge ids, self edges. Each error names every offending item.
    """
    if not isinstance(raw, dict):
        raise ValidationError("missing_fields", "Request must be an object", ["request"])

    missing = _find_missing(raw)
    if missing:
        raise ValidationError(
            "missing_fields", "Missing required items: " + ", ".join(missing), missing
        )

    seed = raw["seed"]
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise ValidationError("invalid_seed", f"Seed must be an integer, got {seed!r}", [repr(seed)])

    mode = raw["mode"]
    if mode not in MODES:
        raise ValidationError(
            "invalid_mode", f"Mode must be 'channel_plan' or 'place', got {mode!r}", [repr(mode)]
        )

    points = raw["points"]
    seen: set = set()
    dups: list[str] = []
    for p in points:
        pid = p["id"]
        if pid in seen and str(pid) not in dups:
            dups.append(str(pid))
        seen.add(pid)
    if dups:
        raise ValidationError(
            "duplicate_ids", "Duplicate Point ids: " + ", ".join(dups), dups
        )

    graph = raw["graph"]
    r = graph["r"]
    if not _is_number(r):
        raise ValidationError("invalid_r", f"r must be a number, got {r!r}", [repr(r)])

    edges_raw = graph.get("edges")
    edges: Optional[tuple[tuple[str, str], ...]] = None
    if edges_raw is not None:
        pairs = _edge_ids(edges_raw)
        unknown: list[str] = []
        for a, b in pairs:
            for v in (a, b):
                if v not in seen and str(v) not in unknown:
                    unknown.append(str(v))
        if unknown:
            raise ValidationError(
                "unknown_edge_ids", "Edges reference unknown ids: " + ", ".join(unknown), unknown
            )
        selfs: list[str] = []
        for a, b in pairs:
            if a == b and str(a) not in selfs:
                selfs.append(str(a))
        if selfs:
            raise ValidationError(
                "self_edges", "Edges join a Point to itself: " + ", ".join(selfs), selfs
            )
        edges = tuple((str(a), str(b)) for a, b in pairs)

    competitors: Optional[tuple[str, ...]] = None
    names = raw.get("competitors")
    if names is not None:
        if not isinstance(names, list) or not names:
            raise ValidationError(
                "invalid_competitors", "competitors must be a non-empty list of names",
                [repr(names)],
            )
        bad = [str(n) for n in names if n not in COMPETITOR_NAMES]
        if bad:
            raise ValidationError(
                "invalid_competitors", "Unknown competitors: " + ", ".join(bad), bad
            )
        # keep the canonical order, drop duplicates
        competitors = tuple(n for n in COMPETITOR_NAMES if n in names)

    return Request(
        points=tuple(Point(str(p["id"]), float(p["x"]), float(p["y"])) for p in points),
        mode=mode,
        r=float(r),
        edges=edges,
        seed=seed,
        competitors=competitors,
    )
