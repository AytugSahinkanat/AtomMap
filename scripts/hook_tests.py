"""Hook test runner. Usage: python scripts/hook_tests.py engine|tutor

Reads the Kiro hook event JSON from STDIN (optional, may be empty or invalid),
runs the tests, prints one summary line, appends a line to
.kiro/hooks/hook-runs.log, and exits with the test exit code.
"""
import datetime
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, ".kiro", "hooks", "hook-runs.log")

TARGETS = {
    "engine": {
        "name": "atommap-engine-fast-tests",
        "cwd": os.path.join(ROOT, "engine"),
        "cmd": [sys.executable, "-m", "pytest", "-q", "-m", "not slow"],
        "shell": False,
        "passed": re.compile(r"(\d+ passed)"),
    },
    "tutor": {
        "name": "atommap-tutor-tests",
        "cwd": os.path.join(ROOT, "web"),
        "cmd": "npx vitest run src/tutor",
        "shell": True,
        "passed": re.compile(r"Tests\s+(\d+ passed)"),
    },
}


def find_path(obj):
    """Best-effort search for a saved file path in the event JSON."""
    if isinstance(obj, dict):
        for key in ("path", "file", "filePath", "file_path"):
            v = obj.get(key)
            if isinstance(v, str):
                return v
        for v in obj.values():
            r = find_path(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_path(v)
            if r:
                return r
    return None


def read_event():
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return None
        raw = sys.stdin.read()
        return find_path(json.loads(raw)) if raw.strip() else None
    except Exception:
        return None


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in TARGETS:
        print("usage: hook_tests.py engine|tutor", file=sys.stderr)
        return 2
    t = TARGETS[sys.argv[1]]
    saved = read_event() or "unknown"
    env = dict(os.environ, OPENBLAS_NUM_THREADS="1")
    proc = subprocess.run(
        t["cmd"], cwd=t["cwd"], env=env, shell=t["shell"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    out = proc.stdout or ""
    ok = proc.returncode == 0
    if ok:
        m = t["passed"].search(out)
        summary = f"HOOK {t['name']}: {m.group(1) if m else 'ok'}"
    else:
        tail = "\n".join(out.strip().splitlines()[-40:])
        summary = f"HOOK {t['name']}: FAILED (exit {proc.returncode})\n{tail}"
    print(summary)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        stamp = datetime.datetime.now().isoformat(timespec="seconds")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{stamp} {t['name']} file={saved} {'PASS' if ok else 'FAIL'}\n")
    except OSError:
        pass
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
