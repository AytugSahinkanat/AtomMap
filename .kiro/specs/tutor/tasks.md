# Implementation Plan: Tutor

## Overview

The Tutor is built in three pure and DOM modules in `web/src/tutor/` (`facts.ts`, `sentences.ts`, `strip.ts`), after four small additions to the Engine's progress events. Engine tests run natively: `engine\.venv\Scripts\python.exe -m pytest` with `OPENBLAS_NUM_THREADS=1`. Web tests use `vitest` and `fast-check`.

Dependency on the user: `scripts/record_tutor_runs.py` is run by hand by the user, who commits the four files in `web/test-data/tutor/`:

```
$env:OPENBLAS_NUM_THREADS=1; engine\.venv\Scripts\python.exe scripts\record_tutor_runs.py
```

Task 2 writes the script. Tests that read a recorded file are skipped with a message naming the missing file until the user has produced it. No recorded data is invented. Required tests: Properties 1, 2, 3 and 5, the unit tests of task 1.5 and the recorded run checks. All other tests are optional.

## Tasks

- [x] 1. Engine event fields (prerequisite)
  - [x] 1.1 Add the new fields to the `pick` events in `loop.py`
    - Rule picks: `remaining = len(replay)` read before the pick is removed; `top_group`, `rank`, `frequency` null
    - Loop picks: `remaining` and `top_group` from the step; for source `atoms` after the fallback check, `rank = ranked.index(pick) + 1` and `frequency = freqs[pick]`; for `annealing` and `coin flip`, `rank` and `frequency` null
    - No random number is drawn for the new fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7_

  - [x] 1.2 Add `shots` to the `frequencies` events and null fields in Atoms_Alone
    - `simulator.py`: `FrequencyCache.last_shots`, set to `len(result)` on a real call only
    - `loop.py`: the `frequencies` event reads `cache.last_shots`
    - `atoms_alone.py`: `frequencies` gets `shots: len(shots)`; each `pick` gets `remaining`, `top_group`, `rank`, `frequency` as null
    - _Requirements: 1.5, 1.6, 1.7_

  - [x] 1.3 Update the engine spec
    - List the new fields in Requirement 9.9 of `.kiro/specs/engine/requirements.md` and in the "Progress" bullet of the engine design
    - Update the progress docstring at the top of `engine/src/atommap/api.py`
    - Run `validate_spec_format` on the edited requirements file
    - _Requirements: 1.8_

  - [x] 1.4 Write property test for the event fields
    - **Property 5: Progress events do not change picks, log or Stats, and carry well-formed fields**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7**
    - Hypothesis in `engine/tests/`, at least 100 examples, fake Simulator returning a random number of shots
    - Comment `Feature: tutor, Property 5: Progress events do not change picks, log or Stats, and carry well-formed fields`

  - [x] 1.5 Write unit tests for the event fields
    - `frequencies` event `shots` equals the fake Simulator's shot count
    - Rank of an atoms pick in a step where other Points are alone in their group (they have frequency 1.0, no frequencies event, and the rank counts them); required, this is the case that was wrong
    - Fields per source: rule, annealing, coin flip, Atoms_Alone
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Record script and recorded runs
  - [x] 2.1 Write `scripts/record_tutor_runs.py`
    - Calls `atommap.api.run` natively with the real Braket simulator and writes `{request, events, result}` to `web/test-data/tutor/<name>.json`
    - Fixed settings in constants at the top, decided before any run: `hero_seed1` (`fixtures/wifi_hall_hero.json`, Channel_Plan, walls off, Seed 1), `sparse_seed1` (`fixtures/wifi_hall_sparse.json`, Seed 1), `rules_only` (hand-made 6 Point tree, Channel_Plan, Seed 1), `place_rules_only` (hand-made 6 Point tree, Place, straight line, Seed 1)
    - The two tree maps are built inside the script from fixed coordinates, so the rules solve them alone
    - Print the four file paths when done; do not run the script
    - _Requirements: 6.6_

  - [x] 2.2 Add the recorded run loader and the checks over the recordings
    - Create `web/src/tutor/recorded.ts` (test helper): `loadRecorded(name)` returns the parsed file or `null` when it is missing
    - Create `web/src/tutor/recorded.test.ts`: a missing file skips its tests with a message naming the file (`it.skipIf`), no invented data
    - Required check for each file: every Point available in a Round ends it picked or removed, disjoint, over the `pick` events (Property 4 on recordings)
    - Required check: `rules_only` and `place_rules_only` have `atoms_not_needed` true and no `simulate` event; `hero_seed1` has at least one `simulate` event
    - _Requirements: 5.5, 6.6_

  - [ ]* 2.3 Write property test for Round coverage in the Engine
    - **Property 4: Every available Point ends its Round picked or removed**
    - **Validates: Requirements 5.3, 5.5**
    - Hypothesis in `engine/tests/`, fake Simulator, `pick` events of every Competitor except Atoms_Alone
    - Comment `Feature: tutor, Property 4: Every available Point ends its Round picked or removed`

- [x] 3. Facts (`facts.ts`)
  - [x] 3.1 Add the types and the Hybrid run Facts
    - Create `web/src/tutor/facts.ts` with `FactsInput` and `Facts` from the design, and `deriveFacts(input)`
    - Derive `rulesFirst`, `groups`, `group`, `atomPick` and `opened` from the Hybrid events in arrival order (`allClash` from `edges`, `hits = round(frequency * shots)`)
    - Fields with a missing source are left out, never defaulted; empty buffer or `{error}` entry gives only `label` (when present), `mode`, `seed`
    - No import from `sentences.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 4.12, 4.14, 6.4_

  - [x] 3.2 Add Rounds, result and comparison Facts
    - In `facts.ts`: `rounds` (available, picks, byRule, byAtoms, byClassic, ring; one entry without channel in Place), `result` (quantumShare from `scoreboard-model.ts`, fiveGhzOnly, splits, skippedTiles, atomsNotNeeded), `compare` (totals of the four Competitors, `tie`)
    - Facts stay plain JSON
    - _Requirements: 4.9, 4.10, 4.11, 4.13, 6.4_

  - [x] 3.3 Write tests of the Facts on the recorded runs
    - In `web/src/tutor/facts.test.ts`, skipped per missing file
    - Required checks: `hero_seed1` and `sparse_seed1` assert every constant listed below; `rules_only` and `place_rules_only` have no `groups`, `group`, `atomPick`, `opened` and `atomsNotNeeded` true; `place_rules_only` has one Round; `Facts` round trips through `JSON.stringify`
    - Hand-checked constants, taken by the user from their own native run before any tutor code existed. Write them in the test exactly as given. If a recording gives something else, the implementer must STOP and tell the user, and must NOT change the numbers. Picks per channel are written as picks (by rule, with help from the atoms, classical).
    - `hero_seed1`: rules first 1 (ap09, 4 neighbours left). Groups: channel 1, 65 points left, 15 groups, 4 to 8 points, 100 tries. Biggest group 8 points, ap24 97, ap02 53, 3 never lit. Atoms pick ap60, 34 of 100, rank 5, top group 26, 65 left. Opened 0. Channel 1: 70 to choose from, 11 picks (8 rule, 3 atoms, 0 classic). Channel 6: 59, 11 (9, 1, 1). Channel 11: 48, 9 (7, 2, 0). Total 31, atoms 6, 39 on 5 GHz, 13 splits, 0 skipped. Totals: atoms alone 25, hybrid 31, annealing 35, coin flip 33.
    - `sparse_seed1`: rules first 20 (ap00, 3 neighbours left). Groups: channel 6, 50 points left, 8 groups, 6 to 7 points, 100 tries. Biggest group 7 points, ap34 100, ap64 100, 3 never lit. Atoms pick ap17, 98 of 100, rank 9, top group 20, 50 left. Opened 3. Channel 1: 70, 20 (20, 0, 0). Channel 6: 50, 17 (15, 2, 0). Channel 11: 33, 14 (14, 0, 0). Total 51, atoms 2, 19 on 5 GHz, 0 splits, 0 skipped. Totals: atoms alone 45, hybrid 51, annealing 52, coin flip 52 (a tie).
    - _Requirements: 4.1, 4.3, 4.12, 4.13, 6.6_

  - [ ]* 3.4 Write unit tests for edge cases of the Facts
    - First rule pick with 0, 1 and 2 or more neighbours left; all-clash group; no `atomPick` while atoms ran; event without `rank`, `frequency` or `shots`
    - `facts.ts` imports nothing from `sentences.ts` (grep style check)
    - _Requirements: 4.1, 4.4, 4.8, 4.14_

- [x] 4. Sentences (`sentences.ts`)
  - [x] 4.1 Build the sentence table for Steps 1 to 5
    - Create `web/src/tutor/sentences.ts` with `SentenceDef`, `Step`, `buildSteps(facts, plan)`; each def lists its `needs` paths and runs only when all are defined
    - Step 1 wording for 0, 1 and 2 or more neighbours left, and the "no safe pick" wording for 0; Steps 2 and 3 with the "no clear favourite" case; Step 4 ("does not take the top Point", never "the atoms chose" or "decided"); Step 5
    - No arithmetic: every number is a `Facts` field. No DOM import
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.14_

  - [x] 4.2 Add Steps 6 to 8, the idle text and the non-Hybrid sentence
    - Step 6 one per Round (no channel in Place), Step 7 with the Result_Label, Step 8 with plain totals, "One run proves nothing." and "tie"; `atomsNotNeeded` sentence that skips Steps 2 to 5
    - Steps with no sentence are removed
    - `buildIdle(mode)` with two sentences (hall or place text, then "Press Run to see how the atoms and the rules build the plan, step by step."); the non-Hybrid plan returns only "This explanation covers the atoms + rules (hybrid) plan only."
    - _Requirements: 2.2, 2.6, 3.1, 3.2, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 6.2_

  - [x] 4.3 Write the `Facts` generator and property test for numbers
    - Create `web/src/tutor/generators.ts`: `fast-check` arbitrary for `Facts`, every field optional, ids with prefixes `ap` and `cafe`, worst case numbers included
    - **Property 1: Every number in a sentence is a fact of the run**
    - **Validates: Requirements 6.1, 6.5**
    - At least 100 runs; point ids and the fixed "5 GHz" removed before the numbers are read
    - Comment `Feature: tutor, Property 1: Every number in a sentence is a fact of the run`

  - [x] 4.4 Write property test for banned words
    - **Property 2: Banned words never appear**
    - **Validates: Requirements 4.6, 6.3, 6.7**
    - At least 100 runs, lower case compare against "faster", "speed", "wins", "winner", "beats", "best", "the atoms chose", "the atoms decided"
    - Comment `Feature: tutor, Property 2: Banned words never appear`

  - [x] 4.5 Write property test for missing facts
    - **Property 3: A missing fact drops its sentence and nothing else**
    - **Validates: Requirements 2.6, 4.14, 6.8**
    - Remove one field, compare with the full build minus the sentences that list it in `needs`; no "undefined", "NaN" or "null"; Steps numbered 1 to M
    - At least 100 runs. Comment `Feature: tutor, Property 3: A missing fact drops its sentence and nothing else`

  - [x] 4.6 Write the recorded run checks for the sentences
    - In `web/src/tutor/sentences.recorded.test.ts`, skipped per missing file
    - Required: no banned word in any sentence of any recorded run; every Step at most 260 characters; `hero_seed1` shows Steps 1 to 8; `rules_only` and `place_rules_only` show no Steps 2 to 5 and say the atoms weren't needed; `sparse_seed1` shows its Quantum_Share
    - _Requirements: 4.8, 4.12, 6.3, 6.5, 6.7_

  - [ ]* 4.7 Write snapshot and wording unit tests
    - Steps of each recorded file match a snapshot; Step 8 shows "tie" for equal totals; Place wording has no channels; `sentences.ts` imports no DOM (grep style check)
    - _Requirements: 4.11, 4.13, 6.4_

- [x] 5. Strip, hit test, ring and wiring
  - [x] 5.1 Add `web/src/render/hit.ts`
    - `nearestPoint(xy, x, y, maxPx = 12): number`, -1 when none; pure
    - _Requirements: 5.1_

  - [ ]* 5.2 Write unit tests for `nearestPoint`
    - Hit at 12 px, miss at 13 px, nearest of two, empty list
    - _Requirements: 5.1_

  - [x] 5.3 Add `setRing(indices)` to the dynamic layer
    - In `web/src/render/dynamic-layer.ts`: ring in the accent colour, no animation, empty list clears it, one redraw
    - _Requirements: 2.10_

  - [x] 5.4 Create `web/src/tutor/strip.ts`
    - `createStrip(deps)` with `showIdle`, `showFinished`, `hide`; markup as in the design (`<section aria-label="Tutor">`, text left, Back, Next and "step N of M" right, hidden `aria-live="polite"` region, text set with `textContent`)
    - Back and Next change the Step, the counter and the live region; focus stays on the button; `deps.onRing(ids)` called per Step
    - The first line is the finished line with `tabindex="-1"` and takes focus when the old bar held it
    - Non-Hybrid plan: the first line and one sentence, no Steps, no ring
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.10, 2.11, 2.12, 3.2_

  - [x] 5.5 Add `onActivate(id)` to the keyboard list in `a11y.ts`
    - Enter or Space on the focused item calls it; arrow keys still only move focus
    - _Requirements: 5.1, 2.11_

  - [x] 5.6 Wire the strip into `map.ts`, `run.ts` and `style.css`
    - `map.ts`: place the strip above `.map-row`, full width, where the label line was (the label becomes its first line); `onRing` maps ids to indices and calls `setRing`; leaving the Tutor clears the ring
    - `run.ts`: no longer shows the finished line, calls `showFinished` and `hide` during a run; the Result_Label and "Results are a simulation" stay as they are
    - Build `Facts` from the buffered events and the request; strip styles in `style.css` (focus ring, weights as in the steering design)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.10, 3.1_

  - [ ]* 5.7 Write jsdom tests for the strip
    - Back and Next change text and counter, live region equals the Step text, focus stays on the button, finished line takes focus, non-Hybrid plan shows the one sentence
    - _Requirements: 2.6, 2.11, 3.2_

- [x] 6. Why this point
  - [x] 6.1 Add `whyFacts(facts, id)` to `facts.ts`
    - Returns `{ id, clashes, rounds: [{ channel?, outcome, by? }], ring }`: `clashes` is the degree in `edges`; outcomes `rule`, `atoms`, `classic`, `neighbour` (with the picked neighbour id), `fiveGhz`; a picked Point has no entry for later Rounds
    - Place: no channels, outcomes picked or neighbour only
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 6.2 Add `buildWhy(why)` to `sentences.ts`
    - Wording: "picked by a rule", "picked with help from the atoms", "picked classically, without atoms", "not possible, its neighbour <id> was picked", "no channel was left, so it uses 5 GHz only"; Place: "not picked, its neighbour <id> was picked"
    - Same `needs` mechanism as the Steps; ring is the Point and its picked neighbours
    - _Requirements: 5.2, 5.3, 5.4, 6.1_

  - [x] 6.3 Add `showWhy(id)` and `leaveWhy()` to `strip.ts`
    - The Why_Answer replaces the Step; Back and Next are replaced by one button "back to step N" and the counter reads "about <id>"
    - `leaveWhy()` (button, Escape, click on empty map) restores the Step and its ring
    - _Requirements: 2.6, 5.1, 5.6_

  - [x] 6.4 Wire clicks, taps and the keyboard list in `map.ts`
    - Pointer events on the dynamic canvas call `nearestPoint(..., 12)` and `showWhy`; a miss while a Why_Answer is shown calls `leaveWhy`; `a11y.onActivate` calls `showWhy`; Escape calls `leaveWhy`
    - Not active for a non-Hybrid plan
    - _Requirements: 5.1, 5.6, 3.2_

  - [x] 6.5 Extend the generators and run the checks over Why_Answers
    - Add a `WhyFacts` arbitrary to `generators.ts` and include `buildWhy` in the Property 1 to 3 test files (no new property numbers)
    - Required recorded run check in `web/src/tutor/why.recorded.test.ts`, skipped per missing file: for every Point of every recorded run the Why_Answer has no banned word, at most 260 characters, only numbers that are Facts; `place_rules_only` uses "picked by a rule" or "not picked, its neighbour <id> was picked"
    - _Requirements: 5.3, 5.4, 6.1, 6.3, 6.5, 6.7_

  - [ ]* 6.6 Write jsdom tests for the Why_Answer
    - One button "back to step N" instead of Back and Next; the button and Escape restore the Step and its ring; a click on no Point leaves the Why_Answer
    - _Requirements: 2.6, 5.6_

- [x] 7. Layout and 1366x768 fit
  - [x] 7.1 Make `layout()` react to height
    - In `map.ts` the resize handler compares both `innerWidth` and `innerHeight` with the last values; call `layout()` after `showFinished`, `hide` and `showIdle`
    - _Requirements: 2.9_

  - [x] 7.2 Fix the strip height and shrink the card gaps
    - In `style.css`: strip `height: calc(3 * 1.4 * 0.9rem + 1rem)` for every Step, Why_Answer and idle text, grid `1fr auto`, `overflow-y: auto` on the text; Scoreboard card gaps shrink so the finished page fits 768 px inner height
    - Narrow screens (max 40 rem): one column, `min-height`, buttons under the text
    - Below about 650 px inner height the page may scroll, with the Tutor, map and four cards visible
    - _Requirements: 2.7, 2.8, 2.9_

  - [ ]* 7.3 Write a unit test for the height resize
    - A height-only resize changes the map size
    - _Requirements: 2.9_

  - [ ]* 7.4 Write the Playwright smoke check at 1366x768
    - Viewport 1366 x 768 (inner size); run the Hero_Map, skip, then check `document.scrollingElement.scrollHeight <= innerHeight`, the strip box has the same height on every Step and on a Why_Answer, no request outside the same origin
    - At a phone width the strip may grow
    - _Requirements: 2.7, 2.8, 2.9_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional. Required tests: Properties 1, 2, 3 and 5 and the recorded run checks (tasks 1.4, 1.5, 2.2, 3.3, 4.3 to 4.6, 6.5).
- Recorded run tests are skipped with a message naming the missing file until the user has run `scripts/record_tutor_runs.py` and committed the files.
- Engine tests run natively only, with `OPENBLAS_NUM_THREADS=1`. Do not upgrade Pyodide.
- `facts.ts` imports nothing from `sentences.ts`, `sentences.ts` imports no DOM, and `web/` holds no MIS algorithm.
- No speed claims, no winner wording, numbers only from the run shown (honesty rules 1, 3, 7, 8).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "5.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "5.2", "5.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "2.2", "2.3", "3.2"] },
    { "id": 3, "tasks": ["3.3", "3.4", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "5.4", "5.5", "6.1"] },
    { "id": 6, "tasks": ["5.6", "5.7", "6.2"] },
    { "id": 7, "tasks": ["6.3", "6.5"] },
    { "id": 8, "tasks": ["6.4", "6.6"] },
    { "id": 9, "tasks": ["7.1", "7.2"] },
    { "id": 10, "tasks": ["7.3", "7.4"] }
  ]
}
```
