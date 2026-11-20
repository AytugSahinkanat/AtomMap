# worker

Thin TypeScript web worker. It loads Pyodide 0.27.7, writes the `atommap` source into Pyodide, installs the pinned wheels through `boot.py`, runs a tiny warm-up simulation and posts `ready`. It has no MIS logic.

Messages are `{type, payload}`: `progress {stage, percent, detail?}`, `ready {elapsedMs, lean}`, `error {type, message, dependency?, stage?}`; Stages: `pyodide`, `engine`, `packages`, `boot`, `warmup`.

**Classic worker, not a module worker.** `pyodide.js` is loaded with `importScripts`, which module workers do not have. So the TS files have no `import`/`export` and compile to plain scripts.

**Lean_Mode** comes from the worker URL: `worker.js?lean=0|1` (default 1). `?root=<url>` overrides the site root (default: two levels above `worker.js`).

Pyodide 0.27.7 and its built-in packages are self-hosted: `scripts/fetch_pyodide.py` downloads them once at build time into `pyodide/` (git-ignored), and the web build copies them to `dist/pyodide/`. Wheels (`wheels/`) and engine files (`dist/engine/`, or `web/engine/` in the repo layout) are self-hosted too. Nothing is fetched from a CDN or PyPI at runtime.

## Message API

Main thread to worker: `start` with payload = the run request `{points: [{id, x, y}], mode, graph: {r, edges?}, seed}` (x, y, r in metres). The worker `JSON.stringify`s it once and passes it to `atommap.api.run`. It does not look inside.

Worker to main thread:

- `progress`, loading: `{stage, percent, detail?}`.
- `progress`, run: the engine event dict, unchanged. It has `type: "run"` (loading events have `stage` instead).
  - `{type:"run", kind:"simulate", competitor, round, step, tile:[ids]}`
  - `{type:"run", kind:"pick", competitor, round, step, tile:null, picked:[id], source}`
- `ready`: `{elapsedMs, lean}`.
- `result`: the `result` object of the engine reply (`{meta, competitors}`), unchanged.
- `error`: `{type, message, ...}`. A failed run sends the engine's error object unchanged (e.g. `ValidationError` with `kind`, `items`). The worker's own errors: `NotReady` (start before `ready`), `Busy` (start during a run), `BadEngineOutput`, `PythonError`.

Python runs synchronously inside the worker thread. Run events are posted from inside that call, so they reach the page while the main thread stays free. After `result` or `error` the worker accepts the next `start`. Messages sent during a run are queued by the browser and handled after it, so `Busy` is a safety check.

## What must exist before testing (repo root = site root)

1. **Wheels**: `engine\.venv\Scripts\python.exe scripts\fetch_wheels.py` (creates `wheels/` and `wheels/manifest.json`).
2. **Engine bundle**: `python scripts/build_engine_bundle.py` (creates `web/engine/`). Re-run after any change in `engine/src/atommap`.
3. **Compile the worker**: in `worker/`, `npm install` once, then `npx tsc -p .` (creates `worker/dist/worker.js`).

## Run

From the repo root: `python -m http.server 8000`, then open
`http://localhost:8000/worker/dev/index.html` (or `...?lean=0`).

## Smoke page

URL: `http://localhost:8000/web/smoke.html` (also `?lean=0`). Serve from the repo root as above.

Prerequisites: `scripts/fetch_wheels.py`, `scripts/build_engine_bundle.py` (re-run after any change in `engine/src/atommap`) and the compiled `worker/dist/worker.js` (`npx tsc -p .` in `worker/`).

The page loads the worker, shows loading progress and the time to READY, then runs the 70-AP hero map in Channel plan mode with `competitors: ["Hybrid"]` and seed 20260101 (`seeds.hero` in `engine/tests/test_settings.json`). Press "Run hero (Hybrid)", then "Run again (warm run)". It shows both run times, the Result_Label ("simulation"), picks per Round, quantum share, `atoms_not_needed`, the 5 GHz-only count, and PASS/FAIL of the warm run against 20 s (Requirement 1.15). READY targets (45 s first visit, 20 s repeat visit) are only shown, not judged.

Not measured by the page, check by hand in DevTools: no request to pypi.org or files.pythonhosted.org (1.8); download at most 60 MB and wasm memory at most 256 MB (1.14).

Send back: the READY time, both run times, the result text block, any red error text, and the Network-tab findings (transferred size, any PyPI request).
