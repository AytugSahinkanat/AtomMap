"""Scaled atom layout for one Tile (Requirements 6.1 to 6.4, 6.7, 6.8).

Steps: shift the Tile to the origin, scale so that r becomes the blockade
radius, push apart pairs closer than 4.15 µm, round to 0.1 µm, then check the
4.0 µm spacing, the 100 µm box and the exact edge match. If that fails, an
scipy optimiser layout gets the same checks (Requirements 6.5, 6.6). If that
fails too, the Tile is split in two and each half is tried again (6.9 to 6.11).
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence, Union

import numpy as np
from scipy.optimize import minimize

from .log import DecisionLog
from .model import Point
from .physics import blockade_radius_m
from .tiles import bisect

MAX_ATOMS = 10
MIN_SPACING_UM = 4.0
PUSH_TARGET_UM = 4.15
PUSH_EXTRA_UM = 0.01
MAX_PUSH_ROUNDS = 200
BOX_UM = 100.0
GRID_UM = 0.1


@dataclass(frozen=True)
class ScaledLayout:
    """An accepted Layout. `ids` and `positions_um` are in Tile order.

    A single-Point Tile has no atoms: `positions_um` is empty and
    `fixed_frequency` is 1.0. Otherwise `fixed_frequency` is None.
    """

    ids: tuple[str, ...]
    positions_um: tuple[tuple[float, float], ...]
    fixed_frequency: Union[float, None] = None


@dataclass(frozen=True)
class LayoutRejected:
    reason: str


LayoutResult = Union[ScaledLayout, LayoutRejected]


def _push_apart(pos: list[list[float]]) -> None:
    """Push the closest pair apart, up to 200 times, until all pairs are >= 4.15 µm."""
    n = len(pos)
    for _ in range(MAX_PUSH_ROUNDS):
        best = None  # (distance, i, j); ties go to the lowest (i, j)
        for i in range(n):
            for j in range(i + 1, n):
                d = math.hypot(pos[j][0] - pos[i][0], pos[j][1] - pos[i][1])
                if best is None or d < best[0]:
                    best = (d, i, j)
        if best is None or best[0] >= PUSH_TARGET_UM:
            return
        d, i, j = best
        if d > 0.0:
            ux = (pos[j][0] - pos[i][0]) / d
            uy = (pos[j][1] - pos[i][1]) / d
        else:
            ux, uy = 1.0, 0.0  # coincident: the earlier Point moves left, the later right
        shift = (PUSH_TARGET_UM - d) / 2.0 + PUSH_EXTRA_UM
        pos[i][0] -= ux * shift
        pos[i][1] -= uy * shift
        pos[j][0] += ux * shift
        pos[j][1] += uy * shift


def scaled_layout(
    points: Sequence[Point], edges: Iterable[tuple[str, str]], r: float
) -> LayoutResult:
    """Lay out one Tile by scaling its coordinates. Points are in Tile order.

    `edges` are the Tile's Conflict_Graph edges (sorted id pairs). Accepted
    only if the pairs strictly closer than the blockade radius equal `edges`.
    """
    ids = tuple(p.id for p in points)
    if len(points) == 0:
        return LayoutRejected("empty tile")
    if len(points) == 1:
        return ScaledLayout(ids, (), 1.0)
    if len(points) > MAX_ATOMS:
        return LayoutRejected(f"tile has {len(points)} points, at most {MAX_ATOMS} atoms allowed")
    if not (r > 0.0) or not math.isfinite(r):
        return LayoutRejected(f"r must be positive, got {r!r}")

    rb_um = blockade_radius_m() * 1e6
    scale_um_per_m = rb_um / r  # metres to µm, with r mapped to the blockade radius
    min_x = min(p.x for p in points)
    min_y = min(p.y for p in points)
    pos = [[(p.x - min_x) * scale_um_per_m, (p.y - min_y) * scale_um_per_m] for p in points]

    _push_apart(pos)
    return check_positions(ids, pos, edges)


def check_positions(
    ids: Sequence[str], pos: Sequence[Sequence[float]], edges: Iterable[tuple[str, str]]
) -> LayoutResult:
    """The exact checks shared by the scaled and the optimiser layout.

    Shifts to the origin, rounds to 0.1 µm (integer tenths), then checks the
    100 µm box, the 4.0 µm spacing and that the pairs strictly closer than the
    blockade radius equal `edges`.
    """
    rb_um = blockade_radius_m() * 1e6
    ids = tuple(ids)
    sx = min(p[0] for p in pos)
    sy = min(p[1] for p in pos)
    tenths = [
        (round((p[0] - sx) / GRID_UM), round((p[1] - sy) / GRID_UM)) for p in pos
    ]

    box = round(BOX_UM / GRID_UM)
    width = max(t[0] for t in tenths)
    height = max(t[1] for t in tenths)
    if width > box or height > box:
        return LayoutRejected(
            f"layout needs {width * GRID_UM:.1f} x {height * GRID_UM:.1f} µm, "
            f"more than the {BOX_UM:.0f} µm box"
        )

    min_sq = round(MIN_SPACING_UM / GRID_UM) ** 2
    rb_tenths = rb_um / GRID_UM
    close: set[tuple[str, str]] = set()
    n = len(tenths)
    for i in range(n):
        for j in range(i + 1, n):
            dx = tenths[j][0] - tenths[i][0]
            dy = tenths[j][1] - tenths[i][1]
            sq = dx * dx + dy * dy
            if sq < min_sq:
                return LayoutRejected(
                    f"atoms {ids[i]} and {ids[j]} are closer than {MIN_SPACING_UM} µm "
                    "after rounding"
                )
            if math.sqrt(sq) < rb_tenths:
                a, b = ids[i], ids[j]
                close.add((a, b) if a < b else (b, a))

    wanted = {(a, b) if a < b else (b, a) for a, b in edges}
    if close != wanted:
        missing = sorted(wanted - close)
        extra = sorted(close - wanted)
        return LayoutRejected(f"edges do not match: missing {missing}, extra {extra}")

    positions = tuple((t[0] * GRID_UM, t[1] * GRID_UM) for t in tenths)
    return ScaledLayout(ids, tuple((round(x, 1), round(y, 1)) for x, y in positions))


# --- Optimiser fallback and split (Requirements 6.5, 6.6, 6.9, 6.10, 6.11) ---

RESTARTS = 6
START_SIDE_FACTOR = 2.5
EDGE_NEAR = 0.85
NONEDGE_FAR = 1.15
SPACING_WEIGHT = 10.0


def _stable_hash(ids: Iterable[str]) -> int:
    digest = hashlib.sha256("\x1f".join(sorted(ids)).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _loss_and_grad(flat, ii, jj, is_edge, rb):
    n = flat.size // 2
    pos = flat.reshape(n, 2)
    diff = pos[ii] - pos[jj]
    d = np.sqrt((diff**2).sum(axis=1))
    safe = np.maximum(d, 1e-12)
    a = np.where(is_edge, np.maximum(0.0, d - EDGE_NEAR * rb), 0.0)
    b = np.where(~is_edge, np.maximum(0.0, NONEDGE_FAR * rb - d), 0.0)
    c = np.maximum(0.0, PUSH_TARGET_UM - d)
    loss = float((a**2 + b**2 + SPACING_WEIGHT * c**2).sum())
    dd = 2.0 * a - 2.0 * b - 2.0 * SPACING_WEIGHT * c
    g = (dd / safe)[:, None] * diff
    grad = np.zeros_like(pos)
    np.add.at(grad, ii, g)
    np.add.at(grad, jj, -g)
    return loss, grad.ravel()


def optimiser_layout(
    points: Sequence[Point], edges: Iterable[tuple[str, str]], seed: int = 0
) -> LayoutResult:
    """Lay out one Tile with scipy L-BFGS-B from 6 seeded random starts.

    The restart with the lowest loss goes through the same exact checks as the
    scaled layout. Starts are seeded from `seed` and a stable hash of the
    Tile's sorted ids, so results repeat.
    """
    ids = tuple(p.id for p in points)
    n = len(ids)
    if n < 2:
        return LayoutRejected("optimiser needs at least 2 points")
    if n > MAX_ATOMS:
        return LayoutRejected(f"tile has {n} points, at most {MAX_ATOMS} atoms allowed")

    rb = blockade_radius_m() * 1e6
    wanted = {(a, b) if a < b else (b, a) for a, b in edges}
    ii, jj = np.triu_indices(n, k=1)
    is_edge = np.array(
        [((ids[i], ids[j]) if ids[i] < ids[j] else (ids[j], ids[i])) in wanted for i, j in zip(ii, jj)],
        dtype=bool,
    )
    rng = np.random.default_rng([seed % (1 << 64), _stable_hash(ids)])
    best = None
    for _ in range(RESTARTS):
        x0 = rng.uniform(0.0, START_SIDE_FACTOR * rb, size=2 * n)
        res = minimize(
            _loss_and_grad, x0, args=(ii, jj, is_edge, rb), jac=True, method="L-BFGS-B"
        )
        if best is None or res.fun < best.fun:
            best = res
    pos = best.x.reshape(n, 2)
    return check_positions(ids, [(float(x), float(y)) for x, y in pos], wanted)


@dataclass(frozen=True)
class TileLayouts:
    """Result of laying out one Tile: the laid-out parts and the counts.

    `parts` holds one ScaledLayout per part, in order. Every vertex of the Tile
    is in exactly one part. `splits` counts the splits made, `fallbacks` counts
    the parts whose accepted Layout came from the optimiser.
    """

    parts: tuple[ScaledLayout, ...]
    splits: int = 0
    fallbacks: int = 0


def layout_tile(
    points: Sequence[Point],
    edges: Iterable[tuple[str, str]],
    r: float,
    seed: int = 0,
    log: Optional[DecisionLog] = None,
    round: int = 1,
) -> TileLayouts:
    """Lay out a Tile: scaled layout, then optimiser, then split and repeat.

    Never skips a Tile and never invents a value. A single Point always
    succeeds (no atoms, frequency 1.0). Each split adds one `split` entry to
    `log` (if given) for the given Round and counts 1.
    """
    order = {p.id: i for i, p in enumerate(points)}
    edge_list = [(a, b) if a < b else (b, a) for a, b in edges]
    parts: list[ScaledLayout] = []
    counts = {"splits": 0, "fallbacks": 0}

    def rec(group: list[Point]) -> None:
        gids = {p.id for p in group}
        sub = [e for e in edge_list if e[0] in gids and e[1] in gids]
        first = scaled_layout(group, sub, r)
        if isinstance(first, ScaledLayout):
            parts.append(first)
            return
        second = optimiser_layout(group, sub, seed)
        if isinstance(second, ScaledLayout):
            counts["fallbacks"] += 1
            parts.append(second)
            return
        a, b = bisect(list(group), order)
        a = sorted(a, key=lambda p: order[p.id])
        b = sorted(b, key=lambda p: order[p.id])
        counts["splits"] += 1
        if log is not None:
            log.add(
                round,
                "atoms",
                "split",
                [p.id for p in group],
                reason=(
                    f"no layout matched the graph (scaled: {first.reason}; "
                    f"optimiser: {second.reason}); split into "
                    f"{[p.id for p in a]} and {[p.id for p in b]}"
                ),
            )
        rec(a)
        rec(b)

    if points:
        rec(list(points))
    return TileLayouts(tuple(parts), counts["splits"], counts["fallbacks"])
