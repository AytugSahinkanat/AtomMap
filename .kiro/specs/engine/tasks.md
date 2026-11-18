# Implementation Plan: Engine

## Overview

The Engine is built in Python (package `atommap` in `engine/src/atommap/`, tests in `engine/tests/`) with a thin TypeScript Worker in `worker/`. Tasks follow the build order: Worker bootstrap, model and fixtures, rule, tiles, layout, simulator, cache, loop, rounds and stats, message API, cross-cutting property tests, then the performance test and smoke page. Each property test sits right after the part it checks. Properties 1, 2, 3, 5 and 11 need the full run and are in task 11.

## Tasks

- [x] 1. Worker bootstrap
  - [x] 1.1 Write `boot.py` for package loading and wheel checks
    - Load the 16 Pyodide built-in packages, then install the pinned wheels from `wheels/` with micropip `deps=False` after checking sha256 and version against a manifest
    - Add boto3, botocore, s3transfer and jmespath wheels when Lean_Mode is off
    - On a missing, wrong-hash or wrong-version wheel, abort and raise an error naming the dependency, leaving no partial Engine state
    - Make no PyPI requests
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 1.8, 1.11_

  - [x] 1.2 Add the fake numba module and the Lean_Mode import hook to `boot.py`
    - Register fake numba before Braket is imported (config, njit, jit, prange, int64, int32, float64, complex128)
    - Install stub modules for boto3, botocore, s3transfer and jmespath, with `botocore.client.BaseClient`
    - _Requirements: 1.9, 1.10_

  - [x]* 1.3 Write unit tests for fake numba and the Lean_Mode stubs
    - Test njit with and without arguments, `prange is range`, attribute assignment on config, stub imports
    - _Requirements: 1.9, 1.10_

  - [x] 1.4 Write the Worker loader in `worker/src/worker.ts`
    - Load Pyodide 0.27.7, run `boot.py`, run a tiny warm-up simulation, and send `progress` events with a stage and a percent
    - Send `ready` when done, or `error` with the dependency name on failure
    - _Requirements: 1.2, 1.3, 1.12, 1.13_

- [x] 2. Problem model, Conflict_Graph and fixtures
  - [x] 2.1 Set up the engine project and test settings
    - Create `engine/pyproject.toml`, the `atommap` package, `tests/conftest.py` that fails the run unless `OPENBLAS_NUM_THREADS` is 1, and a committed test settings file (seeds, map sizes, run counts) with a loader that aborts when a value is missing
    - _Requirements: 1.1, 1.3, 11.2, 11.3, 12.1, 12.6, 12.7_

  - [x] 2.2 Write `model.py` with the dataclasses and request validation
    - Define `Point`, `Request`, `Entry`, `Stats`, `Result`
    - Validate in this order: missing fields, Seed type, Mode, duplicate ids, unknown edge ids, self edges, each error naming every offending item
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 2.3 Build the Conflict_Graph in `graph.py`
    - Build from r alone (distance below r) or from an edge list with r, storing edges as sorted pairs so duplicates and reversed pairs collapse
    - Handle zero Points
    - _Requirements: 2.2, 2.9, 2.10_

  - [x]* 2.4 Write property test for request validation
    - **Property 9: Invalid requests are rejected with named items**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

  - [x] 2.5 Add the hero and sparse fixtures
    - Generate the hero map (70 APs, 10 x 7 grid, 9 m spacing, ±2 m jitter, r = 20 m) and the sparse control (11 m spacing, ±1.5 m jitter, r = 20 m) as committed files in `fixtures/`, plus a loader
    - _Requirements: 12.8, 12.9_

  - [x]* 2.6 Write property test for duplicate edges
    - **Property 10: Duplicate edges do not change the result**
    - Compare the Conflict_Graph built from a request with repeated and reversed edges to the one with each edge once
    - **Validates: Requirements 2.10**

- [x] 3. Simplicial rule and Decision_Log
  - [x] 3.1 Write `log.py` with the Decision_Log
    - Append-only entries with exactly the fields round, source, action, points, plus rule name, reason or message where needed
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 3.2 Write `rules.py` with the simplicial rule
    - Pick a Point whose neighbours form a clique (including isolated Points), remove its neighbours, log one entry per action with the rule name `simplicial`, and repeat until nothing changes
    - _Requirements: 4.1, 4.2, 4.4_

  - [x]* 3.3 Write property test for the simplicial rule
    - **Property 13: The simplicial rule is safe**
    - **Validates: Requirements 4.1, 4.2, 12.2**

- [x] 4. Spatial Tiles
  - [x] 4.1 Write `tiles.py`
    - Split the remaining Points into Tiles of at most 10 by recursive bisection on the longer axis, built once after the first reduction of a Round, and let Tiles only shrink afterwards
    - _Requirements: 4.5, 6.1_

  - [x]* 4.2 Write unit tests for Tiles
    - Test the size limit, one Tile per Point, the longer-axis split and shrinking after removals
    - _Requirements: 4.5_

- [x] 5. Atom layout
  - [x] 5.1 Write the scaled layout in `layout.py`
    - Scale coordinates so that r equals the blockade radius, push apart pairs closer than 4.15 µm, round to 0.1 µm, then check the 4.0 µm spacing, the 100 µm box and the exact edge match
    - Use no atoms and frequency 1.0 for a single Point
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 6.8_

  - [x] 5.2 Add the optimiser fallback and the split to `layout.py`
    - Try a scipy optimiser Layout with the same checks, then split the Tile in two and repeat on each part
    - Log a `split` entry, count it, never skip a Tile and never use a placeholder value
    - _Requirements: 6.5, 6.6, 6.9, 6.10, 6.11_

  - [x]* 5.3 Write property test for accepted Layouts
    - **Property 6: Accepted Layouts are valid**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.8, 12.5**

  - [x]* 5.4 Write property test for Tiles and splits
    - **Property 7: Tiles and splits partition the Points**
    - **Validates: Requirements 4.5, 6.9**

- [x] 6. Braket program, seeded run and frequencies
  - [x] 6.1 Write `simulator.py` with the program and the seeded run
    - Fix C6 = 5.42e-24 and omega = 15.8e6 with no overrides, add `blockade_radius_m()`, build the 4 µs pulse (amplitude and detuning as in the design, phase 0), 400 time steps and 100 shots
    - Seed numpy from the Seed and a stable hash of the Tile's sorted ids right before each call, and run the Braket local AHS simulator behind the `Simulator` protocol
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.2 Add shot repair and frequencies to `simulator.py`
    - Read post sequence 0 as picked, repair each shot in a seeded random order, and compute the share of repaired shots that contain each Point
    - _Requirements: 5.7_

  - [x] 6.3 Write the fake Simulator for tests
    - Add `tests/fake_sim.py`: a seeded function returning random shots, with an option to raise for chosen Tiles
    - _Requirements: 12.2, 12.3, 12.4_

  - [x]* 6.4 Write property test for repaired shots
    - **Property 8: Repaired shots are independent sets**
    - **Validates: Requirements 5.7**

  - [x]* 6.5 Write unit tests for the pulse and constants
    - Test 400 steps, 100 shots, pulse timings, constants and the blockade radius value
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 7. Frequency cache
  - [x] 7.1 Add the Tile frequency cache to `simulator.py`
    - Key by the frozenset of the Tile's Point ids, reuse until one of those Points is removed, and count cache hits
    - _Requirements: 5.4, 5.8_

  - [x]* 7.2 Write unit tests for the cache
    - Test that the same Tile twice makes one Simulator call, that removing a Point invalidates its Tile, and that results are identical with and without the cache
    - _Requirements: 5.4, 5.8_

- [x] 8. The loop, three frequency providers and Atoms_Alone
  - [x] 8.1 Write `anneal.py`
    - Per Tile, 100 samples of 40 sweeps with the temperature and energy from the design, Metropolis flips in seeded random order, repaired like atom shots
    - _Requirements: 7.4, 8.4_

  - [x] 8.2 Write `loop.py` for one Round
    - Repeat until no Point remains: apply rules, get frequencies from the provider (atoms, annealing or none), rank by frequency with ties broken by Point id, pick one at random (seeded) from the top 40% (any Point for none), remove its neighbours and log it
    - On a Simulator exception, discard partial output, log `skip` with the Round, Point ids and message, count it, use annealing frequencies with source `annealing`, and rethrow any other error
    - _Requirements: 4.1, 4.3, 4.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.4_

  - [x] 8.3 Write Atoms_Alone in `atoms_alone.py`
    - Make Tiles with the layout rule, keep the biggest repaired shot per Tile, merge, drop Points that conflict with a kept Point, report the gaps, and set the label "atoms alone (in pieces of 10 or less in simulation)"
    - _Requirements: 8.2, 8.3_

- [x] 9. Rounds, Competitors and Stats
  - [x] 9.1 Write `stats.py`
    - Compute from the Decision_Log and run counters only: picks per Round and per source, Quantum_Share, `atoms_not_needed`, splits, skipped Tiles, mismatches (always 0), Braket calls, cache hits, layout fallbacks, timings, and gaps for Atoms_Alone
    - _Requirements: 10.1, 10.2, 10.3, 10.7, 10.8, 10.9_

  - [x] 9.2 Write the Round driver and the Competitors in `rounds.py` and `competitors.py`
    - Run 3 Rounds (channels 1, 6, 11) for Channel_Plan or 1 for Place on the Points not yet picked, list `five_ghz_only`, and handle empty Rounds
    - Run the four Competitors on copies of the same input with separate logs and Stats, and return an error entry for a failing Competitor while keeping the others
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 3.9, 8.1, 8.5, 8.6, 8.7, 8.8, 9.1_

  - [x]* 9.3 Write property test for Stats
    - **Property 4: Stats agree with the Decision_Log**
    - **Validates: Requirements 6.11, 7.3, 10.1, 10.2, 10.3, 10.7, 10.9**

  - [x]* 9.4 Write property test for Atoms_Alone
    - **Property 12: Atoms_Alone is independent and reports its gaps exactly**
    - **Validates: Requirements 8.2, 8.3**

  - [x]* 9.5 Write unit tests for Rounds
    - Test zero Points in both Modes, Round count and channels, Quantum_Share 0 with the flag, and separate logs per Competitor
    - _Requirements: 2.9, 3.1, 3.2, 3.9, 8.7, 10.2, 10.3_

- [x] 10. Worker message API and progress events
  - [x] 10.1 Write `api.py` with `run(request_json, emit)`
    - Parse and validate, run the Competitors, serialize with `json.dumps` using JSON types only, name the field when serialization fails, return an error with type and message for other failures and no partial result
    - Add the citation and the Result_Label "simulation" to every result, and no speed claims
    - _Requirements: 2.1, 4.6, 4.7, 7.6, 9.5, 9.6, 10.4, 10.5, 10.6_

  - [x] 10.2 Emit run progress events
    - Call `emit` with `{competitor, round, step, tile}` before each Simulator call and after each pick
    - _Requirements: 9.9_

  - [x] 10.3 Add the message API to `worker/src/worker.ts`
    - Handle `start`, forward `progress`, `result` and `error` messages without changing payloads and with no MIS logic
    - _Requirements: 1.4, 9.9_

- [x] 11. Property tests and save hook
  - [x]* 11.1 Write property test for Rounds
    - **Property 1: Rounds are disjoint independent sets that partition the Points**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6**

  - [x]* 11.2 Write property test for maximal Rounds
    - **Property 2: Rounds are maximal**
    - Include runs where the fake Simulator fails for some or all Tiles
    - **Validates: Requirements 3.7, 7.4, 7.5**

  - [x]* 11.3 Write property test for Decision_Log replay
    - **Property 3: Decision_Log replay equals the picks**
    - **Validates: Requirements 4.2, 4.3, 4.4, 9.2, 9.3, 9.4, 9.8**

  - [x]* 11.4 Write property test for determinism
    - **Property 5: Same input and Seed give identical results**
    - **Validates: Requirements 5.4, 8.1, 8.5, 11.1, 12.4**

  - [x]* 11.5 Write property test for the JSON round trip
    - **Property 11: Result JSON round trip**
    - **Validates: Requirements 9.5, 9.7**

  - [x] 11.6 Add a hook that runs the fast tests on save
    - Create `.kiro/hooks/run-fast-tests.json` with a PostFileSave hook on `engine/.*\.py$` that runs `pytest -m "not slow"` in `engine/` with `OPENBLAS_NUM_THREADS=1`
    - _Requirements: 11.2, 12.1, 12.10_

- [x] 12. Hero performance test and browser smoke page
  - [x]* 12.1 Write the hero and sparse tests
    - Run a full Channel_Plan on the hero fixture natively, tagged `slow`, asserting no error and a Hybrid run within 20 seconds
    - Run the Hybrid on the sparse and the hero fixtures with the real simulator (slow) and assert the sparse Quantum_Share is below half of the hero's, reporting both numbers
    - _Requirements: 1.15, 12.8, 12.9, 12.10_

  - [x] 12.2 Add a small browser smoke page in `web/smoke.html`
    - Load the Worker, show progress, run the hero map in Hybrid mode, and show the elapsed time, the Result_Label and the number of picks per Round
    - _Requirements: 1.2, 1.8, 1.14, 1.15_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use hypothesis with at least 100 examples and the fake Simulator; tests with the real Braket Simulator are marked `slow` with at most 20 examples
- Run tests with `OPENBLAS_NUM_THREADS=1`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.3", "2.4", "4.1", "6.1"] },
    { "id": 3, "tasks": ["2.5", "2.6", "3.2", "4.2", "5.1", "6.2", "6.5"] },
    { "id": 4, "tasks": ["3.3", "5.2", "6.3", "7.1"] },
    { "id": 5, "tasks": ["5.3", "5.4", "6.4", "7.2", "8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4", "9.5", "10.1"] },
    { "id": 9, "tasks": ["10.2", "10.3"] },
    { "id": 10, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "12.1", "12.2"] }
  ]
}
```
