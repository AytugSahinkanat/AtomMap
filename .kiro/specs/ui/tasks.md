# Implementation Plan: UI

## Overview

The UI is built in `web/` (Vite and TypeScript, pinned versions, static build). Task 1 comes first: it adds three progress event changes to the Engine and updates the engine spec, because the Run_Screen needs them. Engine tests run natively only. The UI holds no MIS algorithm.

Dependency on the user: `scripts/fetch_place.py` is run by hand by the user, for the one place, who commits `fixtures/place_kadikoy.json`:

```
python scripts/fetch_place.py kadikoy 40.982,29.020,40.996,29.040
```

Task 6 writes and tests the script offline (no Overpass calls in tests). There is no sample fixture and no invented data: tests that read a place file are skipped with a message naming the missing file until the user has produced it. Task 16 adds the "what we measured" page with a small example `web/public/results.json` marked as an example.

## Tasks

- [x] 1. Engine progress events (prerequisite)
  - [x] 1.1 Update the engine spec requirements
    - In `.kiro/specs/engine/requirements.md`, extend Requirement 9.9 with three event kinds: a `frequencies` event after each Simulator call with the Tile ids and the frequency of each Point; `removed` neighbour ids on every `pick` event; Classical_Rule picks emitted as `pick` events with source `"rule"`
    - Extend Requirement 10.3 to name the Stats flag `atoms_not_needed`
    - State that the emit switch already exists as `api.run(request_json, emit=None)` and that results are identical with and without `emit`
    - Update the progress docstring at the top of `engine/src/atommap/api.py` to match
    - Run `validate_spec_format` on the edited requirements file
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 1.2 Add `removed` neighbour ids to every pick event
    - In `engine/src/atommap/loop.py` and `engine/src/atommap/atoms_alone.py`, add `removed: [ids]` to each `pick` event (empty list when none)
    - Rule picks keep source `"rule"` and also carry `removed`
    - Events must not change picks, Decision_Log or Stats
    - _Requirements: 10.2, 10.3_

  - [x] 1.3 Add the `frequencies` event
    - In `loop.py` and `atoms_alone.py`, emit `{"kind":"frequencies","round","step","tile":[ids],"frequencies":{id: 0..1}}` after each real Simulator call
    - Not sent for cache hits or single-Point parts, the same as `simulate`
    - _Requirements: 10.1_

  - [x] 1.4 Write unit tests for the new events
    - In `engine/tests/`, with the fake Simulator: a `frequencies` event follows each `simulate` event with the same tile ids and values in 0..1
    - Every `pick` has `removed`; rule picks have source `"rule"`
    - Run natively with `OPENBLAS_NUM_THREADS=1`
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 1.5 Write property test: progress events do not change the result
    - **Property 3: Progress events do not change the result**
    - **Validates: Requirements 10.4**
    - Hypothesis, fake Simulator, at least 100 examples: `api.run(req, emit=None)` text equals `api.run(req, emit=collector)` text
    - Comment `Feature: ui, Property 3: Progress events do not change the result`

- [ ] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Web   project setup
  - [x] 3.1 Create the Vite and TypeScript project in `web/`
    - `package.json` with every version pinned (`vite`, `typescript`, `vitest`, `fast-check`, `playwright`), relative `base: './'`, `server.fs.allow` for the repo root
    - Create `web/src/settings.ts` with the default seed, speed steps, Radio_Model constants (with the comment), the `receivedPowerDbm(d)` formula and a small `signalThresholdDbm(r)` helper (Signal_Threshold is not a constant in `settings.ts`; it is computed from the Hero_Map fixture's r), wall losses (12 dB, 4 dB), accent colour
    - Keep the existing `web/engine` and `web/smoke.html` untouched
    - _Requirements: 5.3, 4.12, 11.7_

  - [x] 3.2 Add the typed Worker client
    - Create `web/src/client.ts`, typed with `worker/src/messages.ts`: start, progress (loading and run), ready, result, error
    - Run events are only appended to a buffer array; no drawing, no state changes
    - _Requirements: 1.1, 3.1, 11.1_

- [x] 4. App shell and loading screen
  - [x] 4.1 Add state, screen switching and the Loading_Screen
    - Create `web/src/state.ts`, `web/src/main.ts` and `web/src/screens/loading.ts`
    - Progress bar from the percent of the Worker progress events; a plain-words sentence per stage (`pyodide`, `engine`, `packages`, `boot`, `warmup`)
    - Replace the Loading_Screen with the Map_Screen on `ready`; show the error in plain words on a loading error
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 4.2 Add `web/index.html`
    - `#app` root, `<title>AtomMap</title>`, a short meta description, and the night lab background colour inline (same value as the palette in `web/src/style.css`) so there is no white flash while loading
    - Load `./src/main.ts` as a module
    - _Requirements: 1.1_
  - [x] 4.3 Make `npm run build` produce one self-contained `dist/` for GitHub Pages under `/AtomMap/`
    - Vite `base: './'`, all paths relative
    - `dist/` includes the compiled `worker.js`, the engine bundle (the build runs `scripts/build_engine_bundle.py` first), `wheels/` with `manifest.json`, and the fixtures the app loads
    - Serving `dist/` alone from any sub path works in a browser; nothing is fetched from outside `dist/` at runtime
    - _Requirements: 1.1_

- [x] 5. Edge builders and walls data
  - [x] 5.1 Add `fixtures/wifi_hall_walls.json`
    - Concrete and drywall wall segments for the 9 m grid hero hall, at least one of each kind, committed as a file
    - Leave `fixtures/wifi_hall_hero.json` unchanged
    - _Requirements: 5.2_

  - [x] 5.2 Implement the wall edge builder
    - Create `web/src/edges/walls.ts` with `buildWallEdges(points, walls, wallsOn, r)` where `r` is the fixture's r in metres
    - Power = 10 - 40 - 30*log10(d) minus crossed wall losses (walls on only); edge when power > Signal_Threshold, computed inside as `receivedPowerDbm(r)` from the fixture's r (about -69.03 dBm for r = 20 m); proper segment intersection; pairs once, sorted by id
    - _Requirements: 5.3, 5.4, 5.5, 5.6_

  - [x] 5.3 Write property test: walls never add an edge
    - **Property 1: Turning walls on never adds an edge**
    - **Validates: Requirements 5.3, 5.4, 5.5**
    - `vitest` with `fast-check`, at least 100 runs, in `web/src/edges/walls.property.test.ts`
    - Comment `Feature: ui, Property 1: Turning walls on never adds an edge`

  - [x] 5.4 Write unit tests for the wall edge builder
    - Concrete and drywall loss, a pair near 19.95 m, walls on and off, the gap between 19.95 m and the Hero_Map_R of 20 m allowed
    - _Requirements: 12.1, 12.2_

  - [x] 5.5 Implement the straight-line edge builder
    - Create `web/src/edges/straight.ts`: all pairs with distance below r, each once, sorted
    - Used only for drawing; the Place request sends `graph:{r:150}` without edges
    - _Requirements: 6.3_

  - [x] 5.6 Write unit tests for the straight-line builder
    - Boundary distance, pair order, no duplicates
    - _Requirements: 12.1_

- [x] 6. Place data
  - [x] 6.1 Write the core of `scripts/fetch_place.py`
    - Standard library only
    - Pure functions: equirectangular projection around the cafe centroid, street graph build, snap of each cafe to the nearest street segment with virtual nodes, bounded Dijkstra, walking edges where offset_i + path + offset_j <= 150, stable ids `cafe000`...
    - _Requirements: 6.2, 6.4_

  - [x] 6.2 Add arguments, fetch and write step to the script
    - `parse_args`: `name` (lowercase letters, digits, underscore) and `bbox` as `south,west,north,east`; check four numbers, south < north, west < east, latitude within ±90, longitude within ±180; exit with a plain message before any network call
    - One Overpass request limited to the bbox for cafes (`nwr`, `out center`) and walkable ways; constants for endpoint, filters, limit 150 and minimum 20 (only catches a broken or empty download, not a quality bar)
    - Store `name`, `bbox`, `source` (attribution, licence, licence_url, endpoint, query, `osm_data_timestamp`, `fetched_at`, script, args) and `counts` including the real cafe count and `max_snap_m`
    - If fewer than 20 cafes for that place, print the place name and the count and exit with an error without writing that place's file; one place failing does not touch the other file
    - Flag `--out`, default `fixtures/place_<name>.json`; compact JSON; no tuning or filtering of the fetched result
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [ ]* 6.3 Write offline tests for the script
    - Create `scripts/test_fetch_place.py` with a tiny hand-made street graph and a hand-made Overpass response; no network
    - Cases: walking edge present and absent around the 150 m limit, snap offsets counted, cafes on one segment chained
    - Args: a valid name and bbox parse; wrong count of numbers, south >= north, west >= east, out-of-range values and a bad name exit with an error before any request
    - Fewer than 20 cafes aborts without writing a file (fetch function replaced by a stub)
    - _Requirements: 6.2, 6.8, 6.9, 12.1_

  - [x] 6.4 Add the PlaceFixture loader with per-place caching
    - Add the `PLACES` constant (Kadıköy only: label `Kadıköy, Istanbul`, name `kadikoy`, file) and a `placeTitle(slug)` helper to `web/src/settings.ts`
    - Create `web/src/data/fixtures.ts`: load and validate the hero and walls fixtures; `loadPlace(name)` fetches `place_<name>.json` from the same origin the first time that place is selected, validates the `PlaceFixture` shape, and caches it per place
    - A missing or malformed file gives an error naming that file; the app stays usable
    - No sample fixture and no fallback data; the app never requests Overpass or any tile server
    - Dependency on the user: the real files come from running `scripts/fetch_place.py` by hand, as in the Overview
    - _Requirements: 6.4, 6.6, 6.7, 2.8_

  - [ ]* 6.5 Write fixture tests
    - For `fixtures/place_kadikoy.json`: at least 20 points, `counts.points` equals the number of points, `fetched_at` present, edge ids exist, each walking edge within 150 m straight, `source` present, `streets` non-empty
    - If a file is absent, its test is skipped with a message naming the file
    - Loader tests with a stubbed fetch: caching per place, switching places, missing file and wrong shape give an error naming the file
    - _Requirements: 6.7, 6.9, 12.1_

  - [x] 6.6 Add the preset selector to the Map_Screen
    - In `web/src/screens/map.ts`, show the single place name "Kadıköy, Istanbul" as plain text in Place mode (no selector; the "Place" label stays for accessibility), taken from `PLACES`; the map label reads "Kadıköy, Istanbul, N cafes" with N from the fixture
    - Selecting a place calls `loadPlace`, shows the cached or newly loaded map and clears the previous result; on a load error show the message naming the file and keep the app usable
    - _Requirements: 6.1, 6.4, 11.3_

  - [x] 6.7 Show attribution, cafe count and fetch date
    - In `web/src/screens/map.ts`, for the selected place show "© OpenStreetMap contributors" with the ODbL link (`source.licence_url`), the real cafe count (`counts.points`) and the fetch date (`source.fetched_at`), all read from that place's file
    - _Requirements: 6.5, 6.7_

- [x] 7. Map screen
  - [x] 7.1 Draw the static canvas layer
    - Create `web/src/render/static-layer.ts`: streets, walls (concrete and drywall distinct) and conflict edges, one batched path per style; redraw only on map, toggle, size or pixel ratio change
    - _Requirements: 2.2, 2.8, 5.2, 6.4_

  - [x] 7.2 Draw the dynamic canvas layer
    - Create `web/src/render/sprites.ts` (8 glow sprites, cached `Path2D` shapes: circle for channel 1, triangle for 6, square for 11, hollow circle for 5 GHz only) and `web/src/render/dynamic-layer.ts`
    - Per-point typed arrays (`glow`, `lockT`, `fadeT`, `status`); colour and shape both carry the channel; rule picks drawn as an outlined lock with a "rule" tag
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 3.3, 3.5, 11.5_

  - [x] 7.3 Add the accessibility layer
    - Create `web/src/render/a11y.ts`: hidden `<ul>` of Points in id order with one roving tabindex, arrow keys move to the nearest Point on screen, focus ring on the dynamic canvas, one `aria-live="polite"` region for Round and run changes, `aria-label` on the map
    - _Requirements: 11.3, 11.4_

  - [x] 7.4 Build the Map_Screen
    - Create `web/src/screens/map.ts`: Hero_Map in Channel_Plan (3 Rounds) with the "walls on / off" toggle, a place map in Place (1 Round) with the "walking / straight line" toggle, and the run button
    - Build the request: Channel_Plan sends points, mode, seed, `graph:{r, edges}` from the wall builder with r from the fixture; Place walking sends the place's `walking_edges` with r 150; Place straight line sends `graph:{r:150}` only
    - Place mode loads its place through `loadPlace` (Task 6.4); the preset selector is added in Task 6.6, attribution and counts in Task 6.7
    - _Requirements: 2.6, 2.7, 5.1, 5.6, 5.7, 6.1, 6.2, 6.3_

- [x] 8. Run screen and playback
  - [x] 8.1 Implement seed parsing
    - Create `web/src/seed.ts`: trim, match `^-?\d+$`, safe integer; "run again" uses the previous seed + 1
    - _Requirements: 4.11, 4.12, 4.13_

  - [ ]* 8.2 Write unit tests for seed parsing
    - Valid, negative, empty, decimal, text, unsafe integer
    - _Requirements: 4.12, 4.13_

  - [x] 8.3 Implement the playback reducer
    - Create `web/src/render/playback.ts` with the pure `apply(state, event)`: only `Hybrid` events change the map; `frequencies` sets glow, `pick` locks and fades `removed`, `simulate` shows the stitch outline; events of other competitors only update the status line
    - _Requirements: 2.9, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 8.4 Write unit tests for the reducer
    - Event order, coalescing, other competitors ignored for the map, skip end state equals full playback end state
    - _Requirements: 3.7_

  - [x] 8.5 Add the buffer and rAF loop
    - In `playback.ts` and `client.ts`: read the buffer in a `requestAnimationFrame` loop, due events from the speed setting, at most one dynamic redraw per frame, loop stops when drained, no tween active and result received
    - Skip jumps to the end of the buffer and applies the final state without tweens
    - _Requirements: 3.2, 3.6, 3.7, 11.1_

  - [x] 8.6 Build the Run_Screen
    - Create `web/src/screens/run.ts`: speed control, skip button, plain-words status line, error message with a back button on a run `error`
    - With `prefers-reduced-motion: reduce`: static steps, one state per Round with a "next round" button, no glow transitions or fades
    - Show the Scoreboard when the run finishes
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 3.9_

- [x] 9. Scoreboard
  - [x] 9.1 Implement the Scoreboard model
    - Create `web/src/scoreboard-model.ts`: four cards (atoms alone, atoms + rules (hybrid), annealing + rules, coin flip + rules) with picks per Round, total, Quantum_Share (also 0%), `atoms_not_needed` text, splits, skipped tiles and mismatches (also 0), gaps for atoms alone, label, "tie" for equal totals, an `{error}` entry as plain words with no numbers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.8_

  - [ ]* 9.2 Write unit tests for the Scoreboard model
    - Four cards, zero counts shown, `atoms_not_needed` text, ties, error entry, no banned words (faster, speed, wins, winner, beats) in rendered text
    - _Requirements: 4.7, 4.9, 12.1_

  - [x] 9.3 Build the Scoreboard screen
    - Create `web/src/screens/scoreboard.ts`: one shared card component with equal visual weight and no winner styling, seed, the note "One run proves nothing.", the citation "Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5", a typed seed input, and the "run again with another seed" button
    - _Requirements: 4.1, 4.6, 4.7, 4.9, 4.10, 4.11, 4.12, 4.13_

- [x] 10. Plan selector
  - [x] 10.1 Add the Plan_Selector
    - No separate row of buttons (the page is exactly 768 px tall at 1366x768): the Scoreboard cards are the Plan_Selector. Card container `role="radiogroup"` labelled "plan on the map", one `role="radio"` per card title with `aria-checked` and a roving tabindex, arrow keys move and select (wrapping), Space and Enter select; the Details toggle stays its own control
    - Works only after `result`; radios are disabled while cards are pending; `Hybrid` is selected at the start of each run
    - The selected card has an accent border and the text tag "on the map" (no winner wording); the tag adds no height
    - Selection redraws the dynamic layer from `result.competitors[selectedPlan]` without a new run or animation; Round colours come from `rounds` and `five_ghz_only`; Atoms alone also marks the Points in `stats.gaps` with a legend entry
    - A competitor entry `{error}` has its radio disabled and the reason stays as text
    - The Tutor strip gets the plan through `setPlan(plan)`: non-Hybrid shows the one sentence of tutor Requirement 3.2, no Steps, no ring, no Why_Answer; Hybrid shows the Steps again
    - _Requirements: 2.3, 2.4, 2.5, 2.10, 2.11_

  - [x]* 10.2 Write unit tests for the Plan_Selector
    - Each of the four plans is drawn from the result; disabled button for an error entry
    - _Requirements: 2.11, 12.1_

- [x] 11. Export
  - [x] 11.1 Implement CSV and GeoJSON export
    - Create `web/src/export.ts` for the selected plan: CSV header `id,x,y,round,result_label,seed` with quoting of commas, quotes and newlines; GeoJSON FeatureCollection with top-level `result_label`, `seed` and `units`, geometry `[lon, lat]` for Kadikoy and `[x, y]` for other maps
    - `round` is the channel, `5 GHz only` for unpicked Points in Channel_Plan, and `1` or `not picked` in Place
    - Files made with `Blob` and `<a download>`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x]* 11.2 Write property test and unit tests for export
    - **Property 2: CSV export round trip**
    - **Validates: Requirements 7.1, 7.3**
    - `fast-check`, at least 100 runs, ids with commas, quotes and newlines; every row carries "simulation" and the seed
    - Unit tests for the GeoJSON shape and that export follows the selected plan
    - Comment `Feature: ui, Property 2: CSV export round trip`

  - [x] 11.3 Wire the export buttons
    - Add CSV and GeoJSON buttons to the finished-run view, reading the Plan_Selector selection
    - _Requirements: 7.1, 7.2_

- [ ] 12. Responsive layout
  - [ ] 12.1 Add the responsive layout
    - The empty Tutor_Panel is moved to the tutor spec (`.kiro/specs/tutor/`) and is no longer built here
    - One column below the CSS breakpoint
    - Visible focus ring (accent `#7f77dd`), visible labels on every control, AA text contrast from the steering palette, English text only
    - _Requirements: 11.2, 11.3, 11.4, 11.6, 11.7_

- [ ] 13. Custom map upload (optional, first to cut)
  - [ ]* 13.1 Implement the Custom_Map parser
    - Create `web/src/data/custom-map.ts`: CSV `id,x,y` in metres and GeoJSON Point features projected with the same equirectangular projection as the Kadikoy script; unreadable files return a plain-words reason
    - _Requirements: 8.1, 8.3_

  - [ ]* 13.2 Wire the upload and r input into the Map_Screen
    - File input, r in metres, run with `graph:{r}` and no edges; on a read error show the reason and keep the current map
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 13.3 Write unit tests for the Custom_Map parser
    - Valid CSV, valid GeoJSON, bad columns, non-point features, empty file
    - _Requirements: 8.3_

- [x] 14. Smoke test
  - [x]* 14.1 Write the Playwright smoke test
    - Load the page, wait for the Map_Screen, run the Hero_Map, press skip, check four Competitor cards
    - Record requests and assert none go to a tile server or Overpass
    - _Requirements: 2.8, 6.6, 12.3_

- [x] 16. What we measured page
  - [x] 16.1 Add the results types, validator and loader
    - Create `web/src/data/results.ts` with `ResultsFile` and `RunRecord` types from the design, the pure `validateResults(json)` returning `{ok:true, value}` or `{ok:false, reason}`, and `loadResults()` that fetches `./results.json`
    - The validator checks all field types, `status` in `ok|failed|bad`, `picks` and `quantum_share` holding the four Competitor names with numbers, counts as non-negative integers; the reason is a plain sentence naming the field, such as "run 3: status must be ok, failed or bad"
    - _Requirements: 13.2, 13.14, 13.15_

  - [x] 16.2 Add the example Results_File
    - Create `web/public/results.json` with `example: true`, protocol text and settings, a few runs, and one run with `status: "failed"` and a `reason`; include a run with a 0 Quantum_Share and `atoms_not_needed` true
    - _Requirements: 13.12, 13.8_

  - [x] 16.3 Render the Results_Page
    - Create `web/src/screens/results.ts`: example notice at the top only when `example` is true ("This is example data, not a measurement."), protocol text and settings, one `<table>` with a `<caption>` and `<th scope="col">` headers, then the citation "Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5"
    - One row per Run_Record in file order with seed, map, picks per Competitor, Quantum_Share per Competitor (0% shown), `atoms_not_needed`, splits, skipped Tiles, status with reason, and the label "simulation"; failed and bad rows use the same row component as ok rows
    - No sorting, filtering, totals, averages, ranking or speed wording; text set with `textContent`
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.13_

  - [x] 16.4 Add the error state to the Results_Page
    - In `web/src/screens/results.ts`, call `loadResults` and `validateResults`; when the fetch fails, the JSON is invalid or validation fails, show the reason in plain words and no table
    - _Requirements: 13.14_

  - [x] 16.5 Add the `#/results` hash route
    - In `web/src/main.ts` read `location.hash` at boot and on `hashchange`; `#/results` shows the Results_Page without waiting for the Worker, anything else shows the map flow
    - Add a link back to `#/` on the Results_Page
    - _Requirements: 13.1, 13.2_

  - [x] 16.6 Link to the Results_Page from the Map_Screen
    - In `web/src/screens/map.ts`, add `<a href="#/results">What we measured</a>` with a visible label and focus ring
    - _Requirements: 13.1, 11.3_

  - [x]* 16.7 Write unit tests for the validator and the example file
    - In `web/src/data/results.test.ts`: `validateResults` accepts the committed `web/public/results.json`; rejects wrong types, a bad `status` and missing fields, each with a reason
    - _Requirements: 13.12, 13.14, 13.15_

  - [x]* 16.8 Write unit tests for the Results_Page render
    - In `web/src/screens/results.test.ts`: rows in file order, notice only when `example` is true, failed rows with the same markup as ok rows, 0% shares shown, caption and column headers present, no banned words (faster, speed, wins, winner, beats), error state shows a reason and no table
    - _Requirements: 13.4, 13.5, 13.7, 13.8, 13.9, 13.11, 13.13, 13.14_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Task 13 (custom map) is the first thing to cut.
- Engine tests run natively only (`OPENBLAS_NUM_THREADS=1`). Do not upgrade Pyodide.
- The real `fixtures/place_kadikoy.json` is produced by the user running `scripts/fetch_place.py` by hand (commands in the Overview). No test or task calls Overpass, and no sample data is used.
- Task 16 is placed after task 15 to keep existing numbering; the final checkpoint is now task 17.
- Pin every dependency version. Nothing is fetched from PyPI at runtime.
- The UI holds no MIS algorithm. Small map helpers (edge builders) are allowed in `web/`.
- No speed claims and no winner styling anywhere in the UI (honesty rules 1, 7).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "5.1", "6.1", "16.1", "16.2"] },
    { "id": 1, "tasks": ["1.2", "3.2", "5.2", "5.5", "6.2", "8.1", "8.3", "9.1", "16.3", "16.7"] },
    { "id": 2, "tasks": ["1.3", "4.1", "5.3", "5.4", "5.6", "6.3", "6.4", "8.2", "8.4", "9.2", "11.1", "16.4"] },
    { "id": 3, "tasks": ["1.4", "1.5", "6.5", "7.1", "7.2", "7.3", "11.2", "13.1", "16.5", "16.8"] },
    { "id": 4, "tasks": ["7.4", "8.5"] },
    { "id": 5, "tasks": ["6.6", "8.6"] },
    { "id": 6, "tasks": ["6.7", "9.3"] },
    { "id": 7, "tasks": ["10.1", "16.6"] },
    { "id": 8, "tasks": ["10.2", "11.3"] },
    { "id": 9, "tasks": ["12.1", "13.2", "13.3"] },
    { "id": 10, "tasks": ["14.1"] }
  ]
}
```
  