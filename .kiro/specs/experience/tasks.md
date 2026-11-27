# Implementation Plan: Experience

## Overview

The order follows the deadline (December 4, 2026). Task 1 (the map data fixes) is done first so that the owner can rerun both fetches. The Engine additions (Tasks 2 and 3) come before the UI that needs them. The Scenes, the run animation, the Hand_Pick, the Daily_Map and the US_Maps follow. The Lab (Task 14) comes after the main flow and before the optional UI property tests (Task 15). The Lab stays in. If time runs short, the cuts happen inside it: first "Download run log", then the experiment cards.

Hand-run steps (the owner runs them, they take long or touch the network):

```
python scripts/fetch_place.py sf_bus_stops 37.755,-122.425,37.770,-122.405 --kind bus_stop --out fixtures/place_sf_bus_stops.json
python scripts/fetch_place.py nyc_bike_share 40.720,-74.005,40.735,-73.985 --kind bike_share --out fixtures/place_nyc_bike_share.json
npm run record-results -- --check   # in web/, right after Task 3 (Task 4), and again at the end: the 30 measured runs, compared, nothing written
npm run check-maps                  # in web/, after Task 11.2 and after every new US fetch: US Map_Checks and the Daily_Check (2026-12-01 to 2026-12-10)
```

## Tasks

- [x] 1. Map data fixes
  - [x] 1.1 Remove operator and brand prefixes from bike-share station names
    - In `scripts/fetch_place.py`, `strip_brand_prefixes`: a prefix before " - ", an en or em dash or a colon is removed when it is the station's `brand`, `operator` or `network` tag, or starts at least half of the named stations; the script stops without a file when such a word is left in a name; the fixture gets `names` (rule and `names_changed`); the tags are not stored
    - _Requirements: 14.1, 13.3_
  - [x] 1.2 Merge bus stops whose names are the same crossing in the other order
    - `stop_name_key` splits at "&", trims and sorts the streets; all stops of a group still within 40 m of each other; the merged point keeps the name written most often (tie: smallest OSM id); `merge.rule` text updated
    - _Requirements: 14.2_
  - [x] 1.3 Offline tests and CI
    - `scripts/test_fetch_place.py`: the swapped-name merge (both orders, 40 m, four corners, name choice, input order), the prefix removal (tag, shared prefix, case and separators, a dash inside a name stays, leftover brand stops the script, no brand anywhere in the fixture), and a check that the committed US fixtures contain no brand name
    - The CI engine job runs `pytest scripts/test_fetch_place.py -q`
    - _Requirements: 14.3, 22.1_

- [x] 2. Engine: Shots_Event
  - [x] 2.1 Update the engine spec and the progress docstring
    - In `.kiro/specs/engine/requirements.md`, add the `shots` event kind to Requirement 9.9; update the docstring at the top of `engine/src/atommap/api.py`
    - _Requirements: 6.1_
  - [x] 2.2 Return the kept shots from the frequency computation
    - `simulator.part_shots` returns the frequencies and the kept index lists from the same repair loop; `part_frequencies` calls it and returns the frequencies only; `FrequencyCache` keeps `last_kept`
    - No new rng call; `part_frequencies` results unchanged
    - _Requirements: 6.2, 6.3_
  - [x] 2.3 Emit the `shots` event in the loop and in atoms alone
    - `loop.py`: right after each `frequencies` event; `atoms_alone.py`: from the kept lists of `_shot_frequencies`; not for cache hits or single-Point parts
    - _Requirements: 6.1, 6.4_
  - [x] 2.4 Write property test: the shots match the frequencies
    - **Property 1: The shots match the frequencies**
    - **Validates: Requirements 6.1, 6.2, 6.4**
    - Hypothesis, fake Simulator, at least 100 examples
  - [x] 2.5 Extend the emit property to the `shots` event
    - **Property 2: Progress events do not change the result (extended)**
    - **Validates: Requirements 6.3, 6.5**
    - Extend `engine/tests/test_prop_emit_neutral.py`; check that `shots` events are collected
  - [x] 2.6 Pass the `shots` event through the worker types
    - `worker/src/messages.ts` and `web/src/render/playback.ts` event types get the `shots` kind; the client buffers it like the others
    - _Requirements: 6.1_

- [x] 3. Engine: Lab_Settings
  - [x] 3.1 Validate the optional `settings` object
    - `model.py`: `Settings(shots=100, top_share=0.4)`, ValidationError kind `invalid_settings` with plain messages naming the key and the allowed values; a boolean is not an integer
    - _Requirements: 17.1, 17.2_
  - [x] 3.2 Pass shots and top_share through the run
    - `Simulator.run_tile(..., shots=SHOTS)` in the Braket simulator and the fake; `run_competitors` passes `shots` to every Simulator call and `top_share` to `run_round` of the three loop-based Competitors; the result does not echo `settings`
    - _Requirements: 17.3, 17.5_
  - [x] 3.3 Write property test: default settings change nothing
    - **Property 3: Default settings change nothing**
    - **Validates: Requirements 17.3, 17.4**
    - Hypothesis, fake Simulator, emit off and on
  - [x] 3.4 Write property test: bad settings are refused with a reason
    - **Property 4: Bad settings are refused with a reason**
    - **Validates: Requirements 17.1, 17.2**
  - [x] 3.5 Write unit tests for settings and the recorded runs
    - One message per key and bound; the recorded Tutor runs in `web/test-data/tutor` reproduce exactly from the native Engine without `settings`
    - _Requirements: 17.2, 17.7, 22.2_
  - [x] 3.6 Keep the measurements on the defaults
    - `buildRequest(choice, seed, settings?)` adds `settings` only when given; `record-results.mjs` and `measure-limit.mjs` stop with a message for a request with `settings`; `record-results.mjs --check` makes the 30 runs and compares with `results.json` without writing
    - _Requirements: 17.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Engine tests with `OPENBLAS_NUM_THREADS=1`, `npm test`, `npm run check`, `npm run build`, `npm run smoke -- --no-build`
  - The owner runs `npm run record-results -- --check` now, so a moved number shows up before any UI work; ask the user if questions arise.

- [x] 5. Steering update
  - In `.kiro/steering/design.md`: motion may be rich when it shows real data, never decoration or made-up data, reduced motion always works; the new transition timings; the lab look (darker background, faint grid); the Lab may use the system monospace stack
  - _Requirements: 20.1, 20.2_

- [x] 6. Scenes, routes and transitions
  - [x] 6.1 Implement the router
    - `scenes/router.ts`: `parseRoute`, `formatRoute`, the slugs; `#/results` stays the Results_Page
    - _Requirements: 1.2, 1.4, 1.6_
  - [x] 6.3 Implement the stage and the transitions
    - `scenes/stage.ts` and `scenes/transitions.ts`: exit (260 ms, scale 0.98, blur), staggered enter (460 ms, 60 ms apart, 14 px), the input lock with the 1.2 s guard, reduced motion switches at once; focus to the Scene heading and a polite announcement
    - _Requirements: 1.1, 1.3, 1.8, 4.1, 4.2, 4.4, 4.5, 4.6_
  - [x] 6.4 Split the map screen into the shared map view and Scene panels
    - Done in `screens/map.ts` itself (see the design, Components): the map element is made once and the panels of Scenes 2 to 4 sit around it; the toolbar became the Map_Scene side panel; the Scene_Steps on Scenes 2 to 4 only; back during a run stops it (the client drops the stopped run's messages and holds the next run until the worker has finished the dropped one)
    - _Requirements: 1.5, 1.7, 3.1, 8.1_
  - [x] 6.5 Wire the routes into `main.ts` and load the simulator in the background
    - Show the Choose_Scene at once and start the Worker at the same moment; no Loading_Screen in the normal flow; `state.ready`; the run button shows the percent and the stage sentence and stays disabled until ready; the hint "Try it by hand while the simulator gets ready."; the plain-words error on a loading failure with cards and Hand_Pick still working; one polite announcement when ready
    - Stale run or results routes, and a run route before ready, go to the Map_Scene
    - _Requirements: 1.3, 1.4, 23.1, 23.2, 23.3, 23.4, 23.5, 23.6_

- [x] 7. Choose a map and read the map
  - [x] 7.1 Build the map list and the Card_Previews
    - `scenes/maps.ts` and `scenes/card-preview.ts`: edges and Points only, fixtures cached, "Loading the map…" until loaded
    - Listed now: the wifi hall, Kadıköy cafés and Your map. The two US maps are listed with their Map_Check (task 11.2) and "Today's map" with the Daily_Map (task 10.2); unknown or not yet listed slugs go to the Choose_Scene
    - _Requirements: 2.2, 2.3_
  - [x] 7.2 Build the Choose_Scene and the Map_Cards
    - Title, question line, the card grid (3 × 2 at 1366 px, one column at 375 px), Card_Chips that redraw the preview and carry over, one button per card body, labels with the point count
    - _Requirements: 2.1, 2.4, 2.5, 2.6_
  - [x] 7.3 Add the Container_Transform from the card to the map box
    - FLIP copy of the preview, 520 ms, then the real map; reduced motion switches at once
    - _Requirements: 4.3, 4.5_
  - [x] 7.4 Build the Map_Scene panel
    - Label line, distance toggle, the three How_To_Read items with inline icons, no Tutor idle text, attribution and source for place maps
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 8. Try it yourself
  - [x] 8.1 Implement the Hand_Pick stats
    - `hand-pick.ts`: `handPickStats(ids, edges, picked)`
    - _Requirements: 9.3, 9.7_
    - Done, with the Property 5 test in `hand-pick.test.ts` (brute force, up to 12 Points) and the banned-word check of Requirement 10.3
  - [x] 8.3 Wire the Hand_Pick into the Map_Scene
    - Change `LOADING_HINT` in `screens/map.ts` to "Try it by hand while the simulator gets ready." (Requirement 23.3); until hand-picking exists it says "Look around while the simulator gets ready."
    - Click and Enter or Space pick and unpick; picked and clash marks with shape as well as colour; the readout and the hint; "Clear my picks"; one Hand_Pick per map and distance setting; the "Edit points / Pick points" toggle on Your_Map
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 21.4_
  - [x] 8.4 Show the You_Line on the Results_Scene
    - "You: N" and "(K clashes not counted)" under the cards, not styled as a card; the Tutor does not mention it
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 9. The run, shown from real data
  - [x] 9.1 Implement the shot replay
    - `render/shot-replay.ts`: expand a `shots` event into replay steps, `foldShots`; the reducer takes the glow from the fold during a replay; a Group without `shots` takes its frequencies at once with the "reused" status line
    - _Requirements: 7.3, 7.4, 7.9_
  - [x] 9.3 Draw Atoms, Blockade_Halos, the Laser_Sweep and the flashes
    - `render/atoms-layer.ts`: current Group only, halo radius r/2 in map units, dashed halos, sweep at most 600 ms, one-frame flash; the collapse pulse for atom picks; rule picks as now
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 21.4_
  - [x] 9.4 Add the Shot_Histogram
    - `render/histogram.ts`: one bar per Atom with "k of n", `role="img"` with an updated label
    - _Requirements: 7.3_
  - [x] 9.5 Keep speed, skip and reduced motion working
    - Replay steps per frame from the speed control; skip applies all steps; reduced motion shows each step's final state
    - _Requirements: 7.7, 7.8_
    - Deviations: see design.md, "Notes from tasks 8 and 9"

- [x] 10. Run numbers, results scene and map of the day
  - [x] 10.1 Replace the seed input with Run_Numbers
    - `run-number.ts`; "Run #N", "Repeat this run" and "Run again" on the Results_Scene; no seed input outside the Lab; exports keep the Seed
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 8.1, 8.2_
  - [x] 10.2 Build the Daily_Map
    - `daily/daily-map.ts`: area 120 × 80 m, r 10 m, slots, chains, rings, squares and singles, plus one Tangled_Cluster of 8 to 12 Points in two neighbouring slots; 30 to 40 Points; no edge between parts; the Daily_Seed as the fixed Run_Number
    - `reachableCounts` (the Rule_Pick_Process on at most 12 Points, memo on the mask); a cluster draw is kept only when it is connected and has two or more reachable counts; up to 400 draws, then the fixed fallback cluster
    - No text promises that the plans differ
    - _Requirements: 11.1, 11.2, 11.3, 11.6, 11.7, 11.8, 5.5_
  - [x] 10.3 Write example tests for the Daily_Map
    - The 366 days of 2028: every map meets Requirements 11.3 and 11.7, at most one equal pair (Requirement 11.4); the ten Daily_Check dates; the fallback cluster passes `reachableCounts`; a ring alone and a chain alone each have one reachable count (the reason for the cluster)
    - _Requirements: 11.3, 11.4, 11.7, 22.4_
  - [x] 10.4 Keep the Local_Progress
    - `daily/progress.ts`: load, record, streak, save, try/catch around every access, the last 60 dates; the "Today's map" card shows the best and the streak
    - _Requirements: 11.5, 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x] 10.5 Write example tests for Local_Progress
    - A storage that throws on access, on read and on write; a missing storage; wrong JSON and wrong shapes; the 60-date cap; the streak across a missed day
    - _Requirements: 12.3, 12.5, 22.5_
    - Deviations: see design.md, "Notes from task 10"

- [x] 11. The two US maps and the answer box
  - [x] 11.1 Load the US fixtures
    - `PLACES` with the two names; the loader reads r, `kind`, `story` and `names` or `merge`; `buildRequest` uses the fixture's r; export slugs `sf-bus` and `nyc-bike`; story line and source on the Map_Scene
    - _Requirements: 13.1, 13.2, 3.5_
  - [x] 11.2 Add the Map_Check script and gate the maps on it
    - `web/scripts/check-maps.mjs` (`npm run check-maps`) writes `web/src/data/map-checks.json`: the US Map_Checks (seeds 1 to 3) and the Daily_Check (2026-12-01 to 2026-12-10, fixed in the script now), every run reported, none rerun; a Daily_Check run over 60 s is written with `over_limit` and changes nothing
    - A US_Map is listed only with a matching, fast, ok Map_Check; the "atoms not needed" note only with 0% in all three seeds
    - _Requirements: 2.7, 11.9, 13.4, 13.5, 13.6_
    - Script and gate done; `map-checks.json` holds no runs until the owner runs `npm run check-maps` (`--dry-run` makes one US and one daily run and writes nothing)
  - [x] 11.3 Add the protocol sentence to the Results_Page
    - _Requirements: 13.7_
  - [x] 11.4 Write tests for the US maps
    - Loader accepts both fixtures; the gate (missing, stale, slow, nonzero share); no brand name in any app text, file name or export
    - _Requirements: 13.3, 13.5, 13.6, 22.8_

  - [x] 11.5 Build the answer from the run
    - `answer.ts`: `buildAnswer` and `whichLine`; check every plan's sets against the request edges; N from the passing plans or a larger Hand_Pick (not on the channel plan); the maximality check; the words of each map
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.11_
  - [x] 11.6 Show the Answer_Box on the Results_Scene
    - Under the map, above "One run proves nothing."; "Show them on the map" through the Plan_Selector; "Show the list" folded; the which line on click and Enter; the Lab_Label when there is one; fits 1366 x 768 and 375 px
    - _Requirements: 24.6, 24.8, 24.9, 24.10, 24.12_
  - [x] 11.7 Write tests for the answer
    - The set check (a clash, a Point in two Rounds, a wrong total), the Hand_Pick rule, the maximality line only when true, the hall headline, no banned word in any text
    - _Requirements: 24.3, 24.4, 24.5, 24.6_
- [x] 12. Layout and smoke
  - [x] 12.1 Extend the layout check to every Scene
    - `web/scripts/layout-check.mjs`: every Scene and state at 1366 × 768 and 375 px
    - _Requirements: 21.1, 21.2, 21.3, 22.7_
  - [x] 12.2 Update the smoke test to the Scene flow
    - The Choose_Scene shows before the Worker is ready; wifi hall card, wait for the enabled run button, Run, skip, Results_Scene, four cards, no request off the origin; also with `reducedMotion: "reduce"`
    - _Requirements: 4.5, 22.1, 23.1, 23.3_
  - [x] 12.3 Write the word tests
    - You_Line, How_To_Read, US notes, the Answer_Box texts and Lab texts: no banned word, no brand name
    - _Requirements: 10.3, 13.3, 22.8, 24.5_

- [x] 13. Checkpoint - Ensure all tests pass
  - All tests, `npm run build`, `npm run smoke -- --no-build`, `npm run layout-check -- --no-build`; ask the user if questions arise.

- [ ] 14. The lab (after the main flow, stays in; cuts only inside it)
  - [x] 14.1 Draw the icons and the lab entrance
    - `lab/icons.ts` (flask, sliders, test tubes, gauge, hand drawn inline SVG); `lab/entrance.ts` (about 1 s, no bounce); reduced motion switches at once
    - _Requirements: 15.2, 15.4, 15.7, 15.8_
  - [x] 14.2 Build the lab layout and routes
    - `#/map/<map>/lab`, the "Open the lab" button, top bar, faint grid, monospace labels, three columns entering in order, "Leave the lab" and Escape, focus in and back
    - _Requirements: 15.1, 15.3, 15.5, 15.6_
  - [x] 14.3 Build the lab controls and readouts
    - Seed, r (read-only on walking maps), shots, top group, with instructions and range messages; "Run again" with `buildRequest(..., settings)`; readouts from the shown run
    - _Requirements: 16.1, 16.2, 16.3, 16.8_
  - [ ] 14.4 Add the history, experiments, export and the developer box
    - `lab/history.ts`, `lab/experiments.ts` (five cards that set the controls), "Copy request", "Download run log", "For developers"
    - _Requirements: 16.4, 16.5, 16.6, 16.7_
  - [x] 14.5 Label every lab result
    - Lab_Label on the Scoreboard, the Tutor's first line and both exports; kept on the Results_Scene after leaving the Lab
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - [ ]* 14.6 Write tests for the lab
    - Range messages, the walking r note, the history rows, the experiment cards do not start a run, the Lab_Label in the strip, the Scoreboard and the exports
    - _Requirements: 16.2, 16.5, 18.1, 22.8_

- [ ] 15. Optional UI property tests
  - [ ]* 15.1 Write property test: routes round-trip
    - **Property 9: Routes round-trip**
    - **Validates: Requirements 1.2, 1.4**
  - [ ]* 15.2 Write property test: Hand_Pick numbers equal a brute-force count
    - **Property 5: Hand_Pick numbers equal a brute-force count**
    - **Validates: Requirements 9.3, 9.7, 22.3**
  - [ ]* 15.3 Write property test: the shot replay ends at the real frequencies
    - **Property 7: The shot replay ends at the real frequencies**
    - **Validates: Requirements 7.3, 7.4, 7.7, 22.6**
  - [ ]* 15.4 Write property test: the Daily_Map is fixed by its date and has all three kinds of parts
    - **Property 6: The Daily_Map is fixed by its date and has all three kinds of parts**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.7, 22.4**
  - [ ]* 15.5 Write property test: the reachable counts are right
    - **Property 10: The reachable counts are right**
    - **Validates: Requirements 11.7**
  - [ ]* 15.6 Write property test: Local_Progress never breaks the app
    - **Property 8: Local_Progress never breaks the app**
    - **Validates: Requirements 12.3, 12.5, 22.5**

- [ ] 16. README
  - "Build on AtomMap" (request and result format, a Python example of about 10 lines, run once before it is written down) and "Add your city" (one `fetch_place.py` command per `--kind`)
  - _Requirements: 19.1, 19.2, 19.3_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - All tests, the layout check and the smoke test; the owner runs `npm run record-results -- --check` to confirm the 30 measured runs reproduce; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The UI property tests are collected in Task 15, after the Lab. The Engine properties (Tasks 2.4, 2.5, 3.3, 3.4) are not optional, because the Engine changes must not move the measured results. The example tests in Tasks 10.3 and 10.5 are not optional either.
- The Lab (Task 14) stays in. If time runs short, cut inside it: first "Download run log" (part of Task 14.4), then the experiment cards (Task 14.4).
- Engine tests run natively with `OPENBLAS_NUM_THREADS=1`. Do not upgrade Pyodide. Pin every new dependency (none is planned).
- No speed claims, no winner styling, the quantum share always shown (honesty rules).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "2.2", "3.1", "5", "6.1", "8.1", "10.2"] },
    { "id": 1, "tasks": ["2.3", "3.2", "6.3", "10.3", "10.4"] },
    { "id": 2, "tasks": ["2.4", "2.5", "2.6", "3.3", "3.4", "3.5", "3.6", "10.5"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["6.4", "9.1"] },
    { "id": 5, "tasks": ["6.5", "7.1", "9.3"] },
    { "id": 6, "tasks": ["7.2", "7.4", "9.4", "9.5", "11.1"] },
    { "id": 7, "tasks": ["7.3", "8.3", "10.1", "11.2", "11.3"] },
    { "id": 8, "tasks": ["8.4", "11.4", "12.3"] },
    { "id": 9, "tasks": ["12.1", "12.2"] },
    { "id": 10, "tasks": ["13"] },
    { "id": 11, "tasks": ["14.1", "14.2"] },
    { "id": 12, "tasks": ["14.3", "14.4"] },
    { "id": 13, "tasks": ["14.5", "14.6"] },
    { "id": 14, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "16"] },
    { "id": 15, "tasks": ["17"] }
  ]
}
```