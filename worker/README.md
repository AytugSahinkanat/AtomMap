# worker

Thin TypeScript web worker. It loads Pyodide 0.27.7, writes the `atommap` source into Pyodide, installs the pinned wheels through `boot.py`, runs a tiny warm-up simulation and posts `ready`. It has no MIS logic.

Messages are `{type, payload}`: `progress {stage, percent, detail?}`, `ready {elapsedMs, lean}`, `error {type, message, dependency?, stage?}`; `start` and `result` are typed but handled in task 10. Stages: `pyodide`, `engine`, `packages`, `boot`, `warmup`.

**Classic worker, not a module worker.** `pyodide.js` is loaded with `importScripts`, which module workers do not have. So the TS files have no `import`/`export` and compile to plain scripts.

**Lean_Mode** comes from the worker URL: `worker.js?lean=0|1` (default 1). `?root=<url>` overrides the site root (default: two levels above `worker.js`).

Pyodide 0.27.7 and its built-in packages are loaded from `https://cdn.jsdelivr.net/pyodide/v0.27.7/full/` (the full release is too big to ship). Our own wheels (`wheels/`) and the engine files (`web/engine/`) are self-hosted. Nothing is fetched from PyPI.

## What must exist before testing (repo root = site root)

1. **Wheels**: `engine\.venv\Scripts\python.exe scripts\fetch_wheels.py` (creates `wheels/` and `wheels/manifest.json`).
2. **Engine bundle**: `python scripts/build_engine_bundle.py` (creates `web/engine/`). Re-run after any change in `engine/src/atommap`.
3. **Compile the worker**: in `worker/`, `npm install` once, then `npx tsc -p .` (creates `worker/dist/worker.js`).

## Run

From the repo root: `python -m http.server 8000`, then open
`http://localhost:8000/worker/dev/index.html` (or `...?lean=0`).
