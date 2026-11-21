"""Single entry point: JSON in, JSON out (Requirements 2.1, 4.6, 4.7, 7.6, 9.5, 9.6, 10.4 to 10.6).

`run(request_json, emit, simulator=None)` returns a JSON string and never raises.

  success  {"ok": true,  "result": {"meta": {citation, label}, "competitors": {...}}}
  failure  {"ok": false, "error":  {"type": str, "message": str}}

Progress (Req. 9.9, 9.10): `emit(event)` gets plain dicts (not JSON text), in run
order. The switch is `run(request_json, emit=None)`; with `emit=None` no events
are sent, and the result text is identical with and without `emit`.
Event kinds: `simulate`, `frequencies`, `pick` (rule picks use source "rule").
Every `pick` carries `removed` (neighbour ids removed by it, [] when none), and
a `frequencies` event follows each `simulate` event.

  {"type": "run", "kind": "simulate", "competitor": name, "round": 1|6|11,
   "step": int, "tile": [point ids]}
      right before each real Simulator call; `tile` is the part sent to it.
      Not sent for cache hits, single-Point parts of the loop, or competitors
      that make no Simulator call (Annealing_Rules, Coin_Flip_Rules).
  {"type": "run", "kind": "frequencies", "competitor": name, "round": ...,
   "step": int, "tile": [point ids], "frequencies": {id: 0..1}}
      after each real Simulator call (same conditions as `simulate`).
  {"type": "run", "kind": "pick", "competitor": name, "round": ..., "step": int,
   "tile": null, "picked": [id], "removed": [ids],
   "source": "atoms"|"annealing"|"coin flip"|"rule"}
      after each pick, one event per Point. Loop competitors: `step` is the loop
      step (rule picks carry the last finished step, 0 before the first).
      Atoms_Alone: `step` is the part number in the Round (1-based).

`emit` never changes the result. If it raises, `run` returns an error.

A failure carries no partial result. A rejected request also has `kind` and
`items` in `error` (the offending items). The result text is made with
`json.dumps(..., allow_nan=False)`, so it holds JSON types only.

Method: qReduMIS, Schuetz et al., Phys. Rev. Research 8, 033296 (2026),
doi:10.1103/nh3b-1wv5. This is our own implementation; no code from the
paper's authors is used.
"""

from __future__ import annotations

import json
import math
from typing import Any, Callable, Optional

from .competitors import run_competitors
from .model import ValidationError, validate_request
from .simulator import Simulator

__all__ = ["run"]


def _emit(emit: Optional[Callable[[dict], None]], event: dict) -> None:
    """Call `emit` if there is one. Errors from `emit` are not swallowed."""
    if emit is not None:
        emit(event)


def _error(type_: str, message: str, **extra: Any) -> str:
    err: dict[str, Any] = {"type": type_, "message": message}
    err.update(extra)
    return json.dumps({"ok": False, "error": err}, allow_nan=False)


def _bad_field(value: Any, path: str) -> Optional[str]:
    """Return the path of the first non-JSON value in `value`, or None."""
    if value is None or isinstance(value, (bool, str)):
        return None
    if isinstance(value, int):
        return None
    if isinstance(value, float):
        return None if math.isfinite(value) else path
    if isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            bad = _bad_field(v, f"{path}[{i}]")
            if bad:
                return bad
        return None
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                return f"{path}.{k!r}"
            bad = _bad_field(v, f"{path}.{k}")
            if bad:
                return bad
        return None
    return path


def _parse(request_json: str) -> Any:
    def reject(c: str):
        raise ValueError(f"non-JSON constant {c}")

    return json.loads(request_json, parse_constant=reject)


def run(
    request_json: str,
    emit: Optional[Callable[[dict], None]] = None,
    simulator: Optional[Simulator] = None,
    on_done: Optional[Callable[[dict], None]] = None,
) -> str:
    """Validate the request, run the four Competitors, return the JSON text.

    `on_done(event)` (optional) gets one dict per finished Competitor, as soon
    as it finishes: {"type": "competitor_done", "competitor": name,
    "result": <the entry that is later in result.competitors[name]>}.
    It is a separate callback from `emit`, so `emit` sees only run events.
    The final result text is unchanged by it.
    """
    try:
        try:
            raw = _parse(request_json)
        except (ValueError, TypeError) as exc:
            return _error("ValidationError", f"Request is not valid JSON: {exc}",
                          kind="invalid_json", items=["request"])
        try:
            request = validate_request(raw)
        except ValidationError as exc:
            return _error("ValidationError", exc.message, kind=exc.kind, items=list(exc.items))

        if simulator is None:
            from .simulator import BraketSimulator  # lazy: braket loads on first use

            simulator = BraketSimulator()

        kwargs: dict[str, Any] = {}
        if request.competitors is not None:
            kwargs["names"] = request.competitors
        if emit is not None:
            kwargs["on_event"] = lambda ev: _emit(emit, ev)
        if on_done is not None:
            def _done(name: str, entry: dict) -> None:
                bad_entry = _bad_field(entry, f"result.competitors.{name}")
                if bad_entry:
                    raise ValueError(f"Field {bad_entry} cannot be serialized to JSON")
                on_done({"type": "competitor_done", "competitor": name, "result": entry})

            kwargs["on_done"] = _done
        result = run_competitors(request, simulator, **kwargs).to_dict()
        payload = {"ok": True, "result": result}
        bad = _bad_field(result, "result")
        if bad:
            return _error("SerializationError", f"Field {bad} cannot be serialized to JSON",
                          field=bad)
        try:
            return json.dumps(payload, allow_nan=False)
        except (TypeError, ValueError) as exc:
            return _error("SerializationError", f"Result cannot be serialized to JSON: {exc}")
    except Exception as exc:  # noqa: BLE001 - run() never raises (Req 7.6)
        return _error(type(exc).__name__, str(exc))
