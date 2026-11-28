# AtomMap

**Pick as many points as you can on a real map, and watch simulated atoms help with the hard part.**

AtomMap asks one question on every map: how many points can you pick when no two that are too close may both be picked? You can try it by hand, then watch simulated Rydberg atoms help with the tangled parts while simple rules do the rest. Four methods run on the same map, side by side, and every result is explained with the numbers of that run. Everything runs in your browser tab.

**Live app:** https://aytugsahinkanat.github.io/AtomMap/
**What we measured:** https://aytugsahinkanat.github.io/AtomMap/#/results

All results are a simulation (Amazon Braket's local simulator for neutral-atom analog Hamiltonian simulation, running in Pyodide). No quantum hardware is used.

## Try it

Pick a map on the first page. Each card shows a preview and its distance setting.

| Map | Points | Too close means |
|---|---|---|
| Wifi hall | 70 access points | closer than 20 m (walls on: still hearing each other through the walls). Three rounds, one per 2.4 GHz channel (1, 6, 11); the rest use 5 GHz only |
| Kadıköy cafés | 323 real cafés from OpenStreetMap | within a 150 m walk on the streets (or in a straight line) |
| San Francisco bus stops (Mission) | 57 stops | within a 244 m walk (800 ft) |
| New York bike-share stations (Greenwich Village) | 56 stations | within a 305 m walk (1,000 ft) |
| Your map | up to 100 points you draw, paste or upload (CSV or GeoJSON) | closer than the r you choose |
| Today's map | 30 to 40 points, a new map every day, the same for everyone | closer than 10 m |

On the two US maps the rules made every pick in our runs, so the app says the atoms were not needed there: the stops and stations line up along the streets, and the rules solve such chains on their own. The hall and Kadıköy are where the atoms get work.

A visit goes through four steps:

1. **Choose a map.**
2. **Read the map.** A dot is a place you could pick, a line joins two that are too close. While the simulator loads you can **try it by hand**: click points to pick them, and the app counts your picks and shows clashes in red. On Today's map your best count and your streak stay in this browser.
3. **Run.** The atoms appear for each group the simulator works on. You see the real shots replayed (an atom lights up when a shot kept it) and a bar chart of how often each atom was kept. Change the speed or skip to the end.
4. **Results.**
   - **The answer** in plain words, for example "Answer: you can pick 74 of these 323 cafés, with no two within a 150 m walk", with the plans that found it and the others' counts. "Show them on the map" draws that plan, "Show the list" names the points. This is the most found in that run. It is not proven to be the most possible.
   - **Scoreboard.** Four plans for the same map: atoms alone, atoms + rules (hybrid), annealing + rules and coin flip + rules, each with its quantum share (the percent of picks that came from the atoms). Click a card title to see that plan on the map.
   - **Explanation.** It walks through the run step by step, using only that run's numbers. Click any point to see why it was or wasn't picked.
   - **Run numbers.** Each run has a number, for example "Run #4821". "Repeat this run" gives the same result, "Run again" tries a new number. One run proves nothing.
   - **Export** the plan on the map as CSV or GeoJSON.

**The lab** ("Open the lab" on the results): change the run number, r, the shots per group and the share of top points the next atom pick is drawn from, then run again. Five short experiments set the controls for you, a history table keeps your lab runs, and "Copy request" gives you the exact request the engine got. Every lab result is labelled "Lab settings, not the measured defaults."

## How it works

The method is qReduMIS (Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5), applied to the maximum independent set problem. This is our own implementation.

1. A simple rule picks points that are always safe to pick.
2. The rest is cut into groups of at most 10 points.
3. Each group is laid out as atoms and simulated 100 times. Two atoms that are close can't both be excited (the Rydberg blockade), which is the map's own rule.
4. Points that light up often fit their group well. One of the top 40% is picked, the rules continue, and the loop repeats.

## Honest by design

These rules live in [`.kiro/steering/honesty.md`](.kiro/steering/honesty.md) and apply to the app, the docs and the explanation:

- No speed claims. The classical results are always shown next to the quantum-assisted one.
- Every result is labelled as a simulation.
- The quantum share is always shown, including 0% ("the atoms weren't needed on this map").
- The explanation only uses numbers from the run. The answer says "This is the most found in this run. It is not proven to be the most possible."
- Measurements follow a protocol fixed before the first run, and every run is published.

## What we measured

30 runs in the browser build: 3 maps × seeds 1 to 10, with the protocol fixed in advance. All 30 runs finished and passed the checks. The full table is on the [results page](https://aytugsahinkanat.github.io/AtomMap/#/results) and in [`web/public/results.json`](web/public/results.json). The measured protocol covers the wifi hall, the sparse wifi hall and Kadıköy only.

| Map | Quantum share of the hybrid | Hybrid compared with annealing + rules |
|---|---|---|
| Wifi hall | 8.6% to 20.6% (median about 15%) | more in 1 of 10 seeds, the same in 4, fewer in 5 |
| Wifi hall, sparse control | 3.8% to 6.1% | more in 4, the same in 2, fewer in 4 |
| Kadıköy, Istanbul | 4.0% to 9.7% | more in 1, the same in 4, fewer in 5 |

Atoms + rules picked more points than atoms alone in all 30 runs. A desktop Python run of the same 30 requests matched the browser in 17 of 30 runs. In the others, the hybrid's numbers differed slightly because of floating-point details in the simulation and in the atom layout.

The two US maps and Today's map have their own check, [`web/src/data/map-checks.json`](web/src/data/map-checks.json): every run with all four plans, timed in the built site. A US map is shown only when seeds 1 to 3 each finished within 60 seconds on the same version of its data.

## Build on AtomMap

The engine is one Python package, [`engine/`](engine), and the web app runs the same code in the browser. You send it a request as JSON and get the four plans back as JSON.

### Use the engine with your own data

Install it from a copy of this repository (Python 3.12):

```bash
pip install ./engine
python -m atommap request.json                    # prints the result JSON
python -m atommap request.json --out result.json  # writes it to a file instead
python -m atommap - < request.json                # reads the request from standard input
```

In PowerShell, use `Get-Content request.json | python -m atommap -` for the last line. A request the engine rejects prints its plain error, for example `ValidationError: Missing required items: graph`, and exits with code 1.

The easy way to get a request: open the lab in the app, run a map, press **Copy request** and save it as `request.json`. The command then runs the same request on your computer. Native and browser results can differ a little, because of floating-point details in the simulation and in the atom layout.

**The request**

```json
{
  "mode": "place",
  "seed": 1,
  "graph": {"r": 40, "edges": [["p0", "p1"]]},
  "points": [{"id": "p0", "x": 30, "y": 0}, {"id": "p1", "x": 9.3, "y": 28.5}]
}
```

- `mode`: `"place"` (one round) or `"channel_plan"` (three rounds, channels 1, 6 and 11).
- `seed`: any whole number. The same request with the same seed gives the same result on the same machine.
- `points`: ids and local coordinates in metres.
- `graph.r`: the distance in metres. Without `edges`, two points closer than r are joined. With `edges`, exactly those pairs are joined (walking distances, walls).
- `settings` (optional, only for experiments): `{"shots": 10 to 200, "top_share": 0.1 to 1.0}`. Without it the engine uses the measured defaults, 100 shots and 40%.

**The result**

`{"ok": true, "result": {"meta": {"citation": ..., "label": "simulation"}, "competitors": {...}}}`, with one entry per plan (`Atoms_Alone`, `Hybrid`, `Annealing_Rules`, `Coin_Flip_Rules`). Each has `rounds` (a list of `{"channel", "picks"}`), a `decision_log` of every pick and its source, `five_ghz_only` (channel plans only), and `stats` (`total_picks`, `quantum_share`, `quantum_picks`, `picks_per_round`, splits, skipped groups and more). A rejected request gives `{"ok": false, "error": {"type": ..., "message": ...}}`.

**From Python**

```python
import json
from atommap import api

# Five points on a ring, 35 m apart: no point is a safe pick for the rules, so the atoms go first.
ring = [(30, 0), (9.3, 28.5), (-24.3, 17.6), (-24.3, -17.6), (9.3, -28.5)]
request = {
    "mode": "place",                # one round ("channel_plan" gives three wifi channels)
    "seed": 1,                      # same seed, same result
    "graph": {"r": 40},             # two points closer than 40 m can't both be picked
    "points": [{"id": f"p{i}", "x": x, "y": y} for i, (x, y) in enumerate(ring)],
}
reply = json.loads(api.run(json.dumps(request)))
for name, plan in reply["result"]["competitors"].items():
    print(name, plan["rounds"][0]["picks"], "quantum share", plan["stats"]["quantum_share"])
```

On our machine this printed two picks for each plan, with a quantum share of 0.5 for the hybrid and 1.0 for atoms alone. `api.run(request_json, emit)` also takes a function that gets every progress event of the run (the groups on the atoms, their shots and every pick), which is what the web app animates.

### Add your city

[`scripts/fetch_place.py`](scripts/fetch_place.py) fetches points and streets from OpenStreetMap (Overpass) once and writes a map file with the walking distances. There is one command per kind of point:

```bash
python scripts/fetch_place.py lisbon_baixa 38.707,-9.142,38.714,-9.132 --kind cafe --out my_maps/place_lisbon_baixa.json
python scripts/fetch_place.py sf_bus_stops 37.755,-122.425,37.770,-122.405 --kind bus_stop --out my_maps/place_sf_bus_stops.json
python scripts/fetch_place.py nyc_bike_share 40.720,-74.005,40.735,-73.985 --kind bike_share --out my_maps/place_nyc_bike_share.json
```

The box is `south,west,north,east`. The rule is 150 m for cafés, 244 m for bus stops and 305 m for bike-share stations, and it is stored in the file as `r`. Without `--out` the file goes to `fixtures/place_<name>.json`, where the app's own maps live. Keep a small box: Overpass is a shared free service, and a fetch takes from half a minute to a few minutes.

To run your map with the engine, turn the file into a request:

```python
import json, sys

fixture = json.load(open(sys.argv[1], encoding="utf-8"))
request = {
    "mode": "place",
    "seed": 1,
    "graph": {"r": fixture["r"], "edges": fixture["walking_edges"]},  # walking distance, as in the app
    "points": [{"id": p["id"], "x": p["x"], "y": p["y"]} for p in fixture["points"]],
}
json.dump(request, open("request.json", "w"))
```

Save it as `to_request.py`, then run `python to_request.py my_maps/place_lisbon_baixa.json` and `python -m atommap request.json --out result.json`. The Lisbon box above has 76 cafés. Our run of it took about 15 seconds, and the hybrid found 33, all of them picked by the rules (a quantum share of 0%).

Every command and example in this section was run once in this repository before it was written down.

## Built with Kiro

AtomMap was built spec first with [Kiro](https://kiro.dev):

- **Four specs** in [`.kiro/specs`](.kiro/specs), each with requirements, design and tasks: the engine, the UI, the explanation (tutor), and the experience (the scenes, the shot replay, trying it by hand, the daily map, the US maps, the answer and the lab).
- **Six steering files** in [`.kiro/steering`](.kiro/steering): honesty, product, structure, tech, design and physics. `honesty.md` is always included.
- **Two hooks** in [`.kiro/hooks`](.kiro/hooks): saving an engine file runs the fast engine tests, saving an explanation file runs its tests. Each run is logged.
- **Property-based tests** with Hypothesis (engine) and fast-check (UI), plus checks on recorded real simulator runs.
- **CI before every deploy** ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)): the web tests, a Playwright smoke test of the built site (it runs the wifi hall with normal and with reduced motion and checks that no request leaves the site), the fast engine tests and the map script tests. The site is deployed only when all of them pass.

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
npm run smoke -- --no-build          # loads web/dist in Chromium and runs the wifi hall
npm run layout-check -- --no-build   # every scene and the lab at 1366 x 768 and 375 px
```

The engine tests take a few minutes. `-m "not slow"` skips the tests that call the real Braket simulator. The web build needs `py -3`, `python3` or `python` on the path and uses only the Python standard library, so it needs no virtual environment. `npm run smoke` on its own builds first. If Chromium is missing, the smoke test prints `SMOKE SKIPPED` and exits 0, which means it tested nothing.

Serve `web/dist` with any static file server, for example `python -m http.server 8000 --directory web/dist` from the repository root, then open http://localhost:8000/.

## Repository layout

```
engine/            Python package (the whole engine): src/atommap, tests/
worker/            TypeScript web worker, a thin wrapper around the engine
web/               the UI: src/ (scenes, map, scoreboard, explanation, lab), scripts/, public/results.json
fixtures/          map data as committed files: wifi hall, Kadıköy cafés, the two US maps, with their streets
wheels/            self-hosted pinned Python wheels, served to Pyodide
scripts/           build-time scripts, run by hand (fetch_place.py, fetch_pyodide.py, ...)
.github/workflows/ the GitHub Pages deploy workflow
.kiro/             steering/, specs/ (engine, ui, tutor, experience) and hooks/
```

All logic lives in `engine/`. `worker/` and `web/` hold no MIS algorithm. `pyodide/` is created by `npm run build` and is not committed.

## Data and licence

- Code: MIT, see [LICENSE](LICENSE).
- Café, stop, station and street data: © OpenStreetMap contributors, ODbL 1.0, fetched once with [`scripts/fetch_place.py`](scripts/fetch_place.py). The source and date are stored in each fixture.
- Method: Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5.
