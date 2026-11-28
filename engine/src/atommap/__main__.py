"""Command line (engine spec, Requirement 13): run one request with the Engine.

    python -m atommap request.json            print the result JSON
    python -m atommap - < request.json        read the request from standard input
    python -m atommap request.json --out result.json

It only wraps `atommap.api.run`: the request text goes in unchanged and the JSON text
that `run` returns comes out unchanged. A rejected request or a failed run prints the
Engine's plain error to standard error and exits with 1.

A request copied with "Copy request" in the web app's lab gives the result of
`api.run` on this machine. Native and browser results can differ a little, because
of floating-point details in the simulation and in the atom layout.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional, Sequence, TextIO

from . import api


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m atommap",
        description="Run one AtomMap request (JSON) and print the result JSON.",
    )
    p.add_argument("request", help="the request file, or - to read it from standard input")
    p.add_argument("--out", metavar="FILE", help="write the result to this file instead of standard output")
    return p


def _plain_error(text: str) -> Optional[str]:
    """The plain error line of a failed run, or None when the run succeeded."""
    try:
        reply = json.loads(text)
    except ValueError:
        return "The Engine returned text that is not JSON."
    if reply.get("ok") is True:
        return None
    err = reply.get("error") or {}
    line = f"{err.get('type', 'Error')}: {err.get('message', 'the run failed')}"
    items = [str(i) for i in (err.get("items") or [])]
    # The items in brackets, but only those the message does not name already.
    extra = [i for i in items if i not in line]
    if extra:
        line += " (" + ", ".join(extra) + ")"
    return line


def main(argv: Optional[Sequence[str]] = None, stdin: TextIO = sys.stdin,
         stdout: TextIO = sys.stdout, stderr: TextIO = sys.stderr) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.request == "-":
            request = stdin.read()
        else:
            with open(args.request, encoding="utf-8") as f:
                request = f.read()
    except OSError as exc:
        print(f"Cannot read the request: {exc.strerror or exc} ({args.request})", file=stderr)
        return 1

    text = api.run(request)

    problem = _plain_error(text)
    if problem is not None:
        print(problem, file=stderr)
        return 1
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8", newline="\n") as f:
                f.write(text + "\n")
        except OSError as exc:
            print(f"Cannot write the result: {exc.strerror or exc} ({args.out})", file=stderr)
            return 1
    else:
        stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
