# AtomMap

**See what a quantum computer actually does, on a real map.**

AtomMap picks as many points as it can on a map, never two that are too close, and lets you watch simulated Rydberg atoms help with the hardest part. Every result is explained step by step and scored against classical methods. Everything runs in your browser tab.

**Live app:** https://aytugsahinkanat.github.io/AtomMap/

**What we measured:** https://aytugsahinkanat.github.io/AtomMap/#/results

All results are a simulation (Amazon Braket's local simulator for neutral-atom analog Hamiltonian simulation, running in Pyodide). No quantum hardware is used.

## Try it

1. **Wi-Fi hall.** 70 access points. Two access points closer than 20 m can't share a channel. Press **Run** and watch the atoms work on the tangled core while simple rules handle the rest.

2. **Kadıköy, Istanbul.** 323 real cafés from OpenStreetMap. Two cafés within a 150 m walk can't both be on the list.

3. **Your map.** Draw points, paste a CSV or upload a CSV or GeoJSON file (up to 100 points), choose the distance r, and run. It starts with a ring of 8 points, where the rules find no safe pick and the atoms go first.

After a run:

- **Scoreboard.** Four plans for the same map: atoms alone, atoms + rules (hybrid), annealing + rules and coin flip + rules, each with its quantum share (the percent of picks that came from the atoms). Click a card title to see that plan on the map.

- **Explanation strip.** It walks through the run using only that run's numbers. Click any point to see why it was or wasn't picked.

- **Export.** Download the selected plan as CSV or GeoJSON.

## How it works

The method is qReduMIS (Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5), applied to the maximum independent set problem.

1. A simple rule picks points that are always safe to pick.

2. The rest is cut into groups of at most 10 points.

3. Each group is laid out as atoms and simulated 100 times. Two atoms that are close can't both be excited (the Rydberg blockade), which is the map's own rule.

4. Points that light up often fit their group well. One of the top 40% is picked, the rules continue, and the loop repeats.

## Honest by design

These rules live in [`.kiro/steering/honesty.md`](.kiro/steering/honesty.md) and apply to the app, the docs and the explanation strip:

- No speed claims. The classical results are always shown next to the quantum-assisted one.

- Every result is labelled as a simulation.

- The quantum share is always shown, including 0% ("the atoms weren't needed on this map").

- The explanation strip only uses numbers from the run.

- Measurements follow a protocol fixed before the first run, and every run is published.

## What we measured

30 runs in the browser build: 3 maps × seeds 1 to 10, with the protocol fixed in advance. All 30 runs finished and passed the checks. The full table is on the [results page](https://aytugsahinkanat.github.io/AtomMap/#/results) and in [`web/public/results.json`](web/public/results.json).

| Map | Quantum share of the hybrid | Hybrid compared with annealing + rules |
|---|---|---|
| Wi-Fi hall | 8.6% to 20.6% (median about 15%) | more in 1 of 10 seeds, the same in 4, fewer in 5 |
| Wi-Fi hall, sparse control | 3.8% to 6.1% | more in 4, the same in 2, fewer in 4 |
| Kadıköy, Istanbul | 4.0% to 9.7% | more in 1, the same in 4, fewer in 5 |

Atoms + rules picked more points than atoms alone in all 30 runs. A desktop Python run of the same 30 requests matched the browser in 17 of 30 runs. In the others, the hybrid's numbers differed slightly because of floating-point details in the simulation and in the atom layout.

## Built with Kiro

AtomMap was built spec first with [Kiro](https://kiro.dev):

- **Three specs** in [`.kiro/specs`](.kiro/specs): the engine, the UI and the explanation strip, each with requirements, design and tasks.

- **Six steering files** in [`.kiro/steering`](.kiro/steering). `honesty.md` is always included.

- **Property-based tests** with Hypothesis (engine) and fast-check (UI), plus checks on recorded real simulator runs.

- **A Playwright smoke test** that runs in CI before every deploy, runs the Wi-Fi hall and checks that no request leaves the site.

- **Two test hooks** in [`.kiro/hooks`](.kiro/hooks), registered in Kiro.

## Run it locally

Requirements: Python 3.12, Node 22.12 or newer (vitest 5.1.1 lists 22.12+, 24 and 26+, so skip Node 23 and 25).

```bash
# engine tests
cd engine
python -m venv .venv
source .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[test]"
OPENBLAS_NUM_THREADS=1 pytest -m "not slow"   # PowerShell: $env:OPENBLAS_NUM_THREADS = "1"; pytest -m "not slow"

# web app
cd ../worker && npm ci
cd ../web && npm ci
npm run build                        # builds web/dist (downloads Pyodide once and checks its packages against the hashes in its lock file)
npm test                             # vitest
npx playwright install chromium      # once, for the smoke test
npm run smoke -- --no-build          # loads web/dist in Chromium and runs the Wi-Fi hall
```

The engine tests take a few minutes. `-m "not slow"` skips the 3 tests that call the real Braket simulator. The web build needs `py -3`, `python3` or `python` on the path and uses only the Python standard library, so it needs no virtual environment. `npm run smoke` on its own builds first. If Chromium is missing, the smoke test prints `SMOKE SKIPPED` and exits 0, which means it tested nothing.

Serve `web/dist` with any static file server, for example `python -m http.server 8000 --directory web/dist` from the repository root, then open http://localhost:8000/.

## Repository layout

```
engine/            Python package (the whole engine): src/atommap, tests/
worker/            TypeScript web worker, a thin wrapper around the engine
web/               the UI: src/ (map, scoreboard, explanation strip), scripts/, public/results.json
fixtures/          map data as committed files: Wi-Fi hall, Kadıköy cafés and streets
wheels/            self-hosted pinned Python wheels, served to Pyodide
scripts/           build-time scripts, run by hand (fetch_place.py, fetch_pyodide.py, ...)
.github/workflows/ the GitHub Pages deploy workflow
.kiro/             steering/, specs/ (engine, ui, tutor) and hooks/
```

All logic lives in `engine/`. `worker/` and `web/` hold no MIS algorithm. `pyodide/` is created by `npm run build` and is not committed.

## Data and licence

- Code: MIT, see [LICENSE](LICENSE).

- Café and street data: © OpenStreetMap contributors, ODbL 1.0, fetched once with [`scripts/fetch_place.py`](scripts/fetch_place.py). The source and date are stored in the fixture.

- Method: Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5.
