# Requirements Document

## Introduction

The Engine is the Python package behind AtomMap. It receives points on a map, builds a conflict graph from a distance rule, and picks as many points as possible so that no two picked points conflict (Maximum Independent Set, MIS). It works round by round: a Channel_Plan run has 3 rounds (one per 2.4 GHz channel 1, 6 and 11), and a Place run has 1 round. Each round uses the qReduMIS loop (Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5), with the Amazon Braket local Rydberg atom (AHS) simulator as the quantum step. The Engine runs in a web worker through Pyodide and returns a Decision_Log and Stats so the UI can animate and explain each run.

Out of scope: the UI, map drawing, the AI tutor, real quantum hardware, and identical results across different devices (cross-device reproducibility).

## Glossary

- **Engine**: The single Python package that computes the picks. It runs in the browser through Pyodide and natively for tests.
- **Worker**: The thin TypeScript web worker that loads Pyodide and passes messages between the UI and the Engine. It contains no logic.
- **Point**: A location on the map, such as an access point, cafe or street corner, with a unique identifier and coordinates x and y in metres.
- **Conflict_Graph**: A graph with one node per Point and an edge between two Points that are too close to both be picked. A graph built from an edge list (for example walls or walking distance) is not necessarily a disk graph.
- **Conflict_Radius**: The distance r in metres. Two Points conflict if their distance is less than r.
- **Lean_Mode**: Loading mode in which stub modules replace boto3, botocore, s3transfer and jmespath, saving about 17 MB.
- **Mode**: Either Channel_Plan or Place.
- **Channel_Plan**: Mode with 3 rounds, one per 2.4 GHz channel (1, 6, 11). Points not picked in any round are 5 GHz only.
- **Place**: Mode with 1 round.
- **Round**: One MIS computation on the Points that remain available. Each Round picks an independent set.
- **Independent_Set**: A set of Points with no edge of the Conflict_Graph between any two of them.
- **qReduMIS**: The hybrid loop of the paper above: classical reduction rules, then atoms for the hard remaining part, repeated until no Points remain.
- **Classical_Rules**: The reduction rules of qReduMIS that pick or remove Points without atoms.
- **Tile**: A fixed spatial part of at most 10 Points of the remaining graph, sent to the Simulator in one call.
- **Simulator**: The Amazon Braket local AHS (Rydberg atom) simulator, running in Pyodide 0.27.7.
- **Layout**: The atom positions for one Tile.
- **Competitor**: One of four methods run on the same map: Atoms_Alone, Hybrid, Annealing_Rules, Coin_Flip_Rules.
- **Atoms_Alone**: Competitor using only atoms, with no Classical_Rules.
- **Hybrid**: Competitor using Classical_Rules and atoms (qReduMIS).
- **Annealing_Rules**: Competitor using Classical_Rules and annealing.
- **Coin_Flip_Rules**: Competitor using Classical_Rules and random choices.
- **Decision_Log**: The ordered record of every decision in a run, with its source (rule, atoms, annealing, coin flip), the Round it belongs to, and the Points it affects.
- **Stats**: The numbers computed for a run: picks per Round, picks per source, quantum share, skipped Tiles, split Tiles and similar counts.
- **Quantum_Share**: The number of picks made in atom-informed steps, divided by all picks. A pick is atom-informed only if its frequency came from a real Simulator run.
- **Result_Label**: The text "simulation" or "real hardware" attached to a result.
- **Seed**: The integer of a run, from which numpy is seeded (together with the Tile) before each Simulator call.

## Requirements

### Requirement 1: Run in the browser and natively

**User Story:** As a developer, I want the same Engine code to run in a web worker and natively, so that tests cover what users run.

#### Acceptance Criteria

1. THE Engine SHALL be distributed as a single Python package that is imported under one top-level package name in both the Worker and native environments.
2. WHEN the Worker initializes the Engine, THE Worker SHALL load the Engine through Pyodide 0.27.7 (Python 3.12) and send the UI a ready message within 45 seconds on a first visit and within 20 seconds on a repeat visit.
3. WHEN pytest runs the Engine test suite natively, THE Engine SHALL execute from the same source files as in the Worker, with zero source differences between the two environments (verified by comparing the package file hashes).
4. WHEN the Worker receives a message from the UI or from the Engine, THE Worker SHALL forward it to the other party without modifying the payload and without performing any MIS computation.
5. WHEN the Engine initializes, THE Engine SHALL load these Pyodide 0.27.7 built-in packages: numpy, scipy, micropip, ssl, pydantic, pydantic_core, annotated-types, typing_extensions, sympy, mpmath, packaging, python-dateutil, six, urllib3 and setuptools.
6. WHEN the Engine initializes, THE Engine SHALL install every other dependency from a self-hosted wheel, checked by sha256, with micropip deps=False, at these pinned versions: amazon-braket-sdk 1.127.8, amazon-braket-default-simulator 1.43.1, amazon-braket-schemas 1.33.0, antlr4-python3-runtime 4.13.2, backoff 2.2.1, boltons 26.2.0, cloudpickle 2.2.1, mypy_extensions 1.2.0, nest-asyncio 1.6.0, openpulse 1.0.1, openqasm3 1.0.2, opt_einsum 3.4.0 and oqpy 0.3.11.
7. IF a dependency wheel is missing from the self-hosted location, its sha256 does not match or its version does not match the pinned version, THEN THE Engine SHALL abort initialization, send the UI an error message naming the dependency, and leave no partially loaded Engine state.
8. WHILE the Engine runs, THE Engine SHALL make zero network requests to PyPI.
9. WHEN the Engine initializes, THE Engine SHALL register a fake numba module before Braket is imported, with config (an object that accepts attribute assignment), njit and jit (pass-through, usable with or without arguments), prange equal to range, and int64, int32, float64 and complex128.
10. WHERE Lean_Mode is enabled, THE Engine SHALL install an import hook that returns stub modules for boto3, botocore, s3transfer and jmespath, with botocore.client.BaseClient available.
11. WHERE Lean_Mode is disabled, THE Engine SHALL also install boto3 and botocore 1.44.4, s3transfer 0.19.3 and jmespath 1.1.0 from self-hosted wheels.
12. WHILE the Worker loads the Engine, THE Worker SHALL send progress events, each with a stage and a percent.
13. WHILE the Worker loads the Engine, THE Engine SHALL run a tiny warm-up simulation.
14. THE Engine SHALL download at most 60 MB and use at most 256 MB of wasm memory.
15. WHEN the Hero map is run warm in the browser (3 Rounds, Hybrid), THE Engine SHALL finish within 20 seconds.

### Requirement 2: Accept input

**User Story:** As a UI developer, I want to send points and run settings to the Engine, so that it can compute picks for any map.

#### Acceptance Criteria

1. WHEN a run request is received, THE Engine SHALL read a list of Points (each with an identifier, x and y in metres), the Mode, the Conflict_Graph definition, the Conflict_Radius r, and the Seed.
2. THE Engine SHALL accept a Conflict_Graph definition as either r alone, or a list of edges (each an unordered pair of two Point identifiers) together with r, where r scales the Layout.
3. IF a run request omits the list of Points, the x or y of any Point, the Mode, the Conflict_Graph definition, r, or the Seed, THEN THE Engine SHALL reject the request with an error that names each missing item and SHALL return no picks.
4. IF the Seed is not an integer, THEN THE Engine SHALL reject the request with an error that names the received Seed value and SHALL return no picks.
5. IF a run request contains duplicate Point identifiers, THEN THE Engine SHALL reject the request with an error that names every duplicated identifier and SHALL return no picks.
6. IF a run request contains an edge that references an unknown Point identifier, THEN THE Engine SHALL reject the request with an error that names every unknown identifier and SHALL return no picks.
7. IF a run request contains an edge whose two endpoints are the same Point identifier, THEN THE Engine SHALL reject the request with an error that names that identifier and SHALL return no picks.
8. IF the Mode is neither Channel_Plan nor Place, THEN THE Engine SHALL reject the request with an error that names the received Mode and SHALL return no picks.
9. WHEN a run request contains zero Points, THE Engine SHALL return an empty result with zero picks in every Round, with 3 Rounds when the Mode is Channel_Plan and 1 Round when the Mode is Place.
10. WHEN a run request contains the same edge more than once, including the same pair in reverse order, THE Engine SHALL treat the duplicates as a single edge and SHALL NOT reject the request.

### Requirement 3: Round-by-round picking

**User Story:** As a user, I want the Engine to pick as many points as possible round by round, so that I get a usable plan.

#### Acceptance Criteria

1. WHEN the Mode is Channel_Plan, THE Engine SHALL run exactly 3 Rounds, assigned to channels 1, 6 and 11 in that order (Round 1 to channel 1, Round 2 to channel 6, Round 3 to channel 11).
2. WHEN the Mode is Place, THE Engine SHALL run exactly 1 Round.
3. WHEN a Round starts, THE Engine SHALL compute an Independent_Set on the Points not picked in earlier Rounds.
4. THE Engine SHALL return, for every Round, an Independent_Set of the Conflict_Graph, containing 0 or more Points and no 2 Points joined by an edge of the Conflict_Graph.
5. THE Engine SHALL assign each Point to at most one Round, so that the Independent_Sets of any 2 Rounds in the same run share 0 Points.
6. WHEN the Mode is Channel_Plan, THE Engine SHALL list every Point not picked in any Round as 5 GHz only, so that the number of Points picked plus the number of Points listed as 5 GHz only equals the total number of input Points.
7. THE Engine SHALL make each Round's Independent_Set maximal on the Points available to that Round for Hybrid, Annealing_Rules and Coin_Flip_Rules (Atoms_Alone is the exception: it can have gaps and reports them, see Requirement 8.3), so that adding any Point that was available to that Round (not picked in an earlier Round) would create at least 1 conflict with a Point already in that Round's Independent_Set.
8. IF the set of Points available to a Round is empty, THEN THE Engine SHALL return an empty Independent_Set for that Round and SHALL still complete the remaining Rounds without returning an error.
9. IF the input contains 0 Points, THEN THE Engine SHALL return the required number of Rounds for the Mode, each with an empty Independent_Set, and, in Channel_Plan Mode, an empty 5 GHz only list.

### Requirement 4: qReduMIS loop

**User Story:** As a curious user, I want the Engine to use the qReduMIS method, so that the result comes from the published hybrid approach.

#### Acceptance Criteria

1. WHEN a Round runs Hybrid, Annealing_Rules or Coin_Flip_Rules, THE Engine SHALL repeat the following steps until zero Points remain available in that Round: (a) apply Classical_Rules until nothing changes; (b) get frequencies for all live Tiles: from the Simulator for Hybrid, from simulated annealing samples for Annealing_Rules, none for Coin_Flip_Rules; (c) rank all remaining Points by frequency and pick ONE at random (seeded) from the top 40%, or for Coin_Flip_Rules pick any remaining Point; (d) select it, remove its neighbours and log it. Every step picks exactly one Point, so the loop always ends.
2. WHEN Classical_Rules pick or remove a Point, THE Engine SHALL record one Decision_Log entry per action, with the source "rule", the name of the rule that caused it, the action (pick or remove), and the identifier of each affected Point.
3. WHEN step 1(c) picks a Point, THE Engine SHALL record one Decision_Log entry with the source "atoms", "annealing" or "coin flip" (by Competitor), the action "pick", and the identifier of the Point.
4. WHEN a Point is picked, THE Engine SHALL remove that Point and all of its neighbors in the Conflict_Graph from the Points available in the same Round, before the next pick or rule is applied.
5. WHEN the first reduction of a Round finishes, THE Engine SHALL split the remaining Points into fixed spatial Tiles of at most 10 Points by recursive bisection on the longer axis, and Tiles SHALL only shrink after that.
6. THE Engine SHALL cite Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5, in the package documentation and in the metadata of every returned result.
7. THE Engine SHALL contain its own implementation of qReduMIS and SHALL NOT import or include code from the paper's authors.

### Requirement 5: Quantum simulation settings

**User Story:** As a developer, I want fixed simulation settings, so that runs are comparable and follow the physics steering.

#### Acceptance Criteria

1. WHEN the Engine runs a Tile on the Simulator, THE Engine SHALL set C6 to 5.42e-24 rad·m^6/s and omega to 15.8e6 rad/s, and SHALL NOT accept overrides of these values from any input.
2. WHEN the Engine runs a Tile on the Simulator, THE Engine SHALL use a pulse with a total duration of 4 µs, a linear amplitude ramp-up from 0 over the first 0.25 µs, a constant amplitude from 0.25 µs to 3.75 µs, a linear amplitude ramp-down to 0 over the last 0.25 µs, a detuning that stays at -5 omega during the first 0.25 µs, goes linearly to +5 omega at 3.75 µs and stays there until 4 µs, and a phase of 0 rad throughout.
3. WHEN the Engine runs a Tile on the Simulator, THE Engine SHALL execute exactly 400 time steps and exactly 100 shots per Tile. The only exception is a lab run whose request has `settings.shots` (an integer from 10 to 200, experience spec Requirement 17): then every Tile of that run gets that many shots. The time steps, C6, omega and the pulse are never changed by any input.
4. THE Engine SHALL seed numpy right before each Simulator call, from the Seed and the Tile, so that two runs with the same Seed and the same input produce identical results, with or without the cache of criterion 8.
5. THE Engine SHALL compute the blockade radius in metres as (C6 / omega)^(1/6), using the C6 and omega values from criterion 1, and SHALL return the same value on every call.
6. WHEN the Engine runs a Tile on the Simulator, THE Engine SHALL execute it through the Amazon Braket local AHS simulator: in the browser through Pyodide, in tests natively with the same simulator.
7. WHEN a Tile run returns shots, THE Engine SHALL read post sequence 0 as atom excited, meaning the Point is picked, SHALL repair each shot with conflicts by keeping Points in a seeded random order, and SHALL compute a frequency per Point from the repaired shots.
8. THE Engine SHALL cache each Tile's frequencies by its set of Points and reuse them until one of those Points is removed.

### Requirement 6: Layouts

**User Story:** As a developer, I want each Tile's atom layout to match its conflict graph exactly, so that atom results are valid.

#### Acceptance Criteria

1. THE Engine SHALL place at most 10 atoms in one Simulator call.
2. THE Engine SHALL place atoms at least 4.0 µm apart, measured as the Euclidean distance between every pair of atoms after rounding each coordinate to the nearest 0.1 µm.
3. WHEN the Engine evaluates a candidate Layout for a Tile, THE Engine SHALL accept the Layout only if the set of atom pairs whose distance is below the blockade radius equals the set of edges of the Tile's Conflict_Graph, with no missing edges and no extra edges.
4. WHEN the Engine lays out a Tile, THE Engine SHALL scale the real coordinates so that r becomes the blockade radius, push apart pairs closer than 4.15 µm, and check the edge match from criterion 3.
5. IF the scaled Layout does not match exactly, THEN THE Engine SHALL try an optimiser Layout and SHALL accept it only if it matches exactly.
6. IF neither Layout matches exactly, THEN THE Engine SHALL split the Tile into two Tiles and repeat criteria 4 to 6 on each part.
7. WHEN a Tile contains a single Point, THE Engine SHALL, for the loop Competitors (Hybrid, Annealing_Rules and Coin_Flip_Rules), use no atoms and a frequency of 1.0 for that Point, SHALL treat this value as classical, SHALL log picks made from it with the source "annealing", and SHALL NOT count those picks as atom-informed. Atoms_Alone instead runs a single Point through the Simulator as one atom (Requirement 8.2).
8. THE Engine SHALL fit every Layout in a 100 µm box.
9. IF a Tile cannot be laid out, THEN THE Engine SHALL split the Tile and SHALL NOT skip it, so that every vertex of the original Tile belongs to exactly one laid-out part.
10. IF a Tile cannot be laid out, THEN THE Engine SHALL NOT substitute a placeholder value (for example 0.5) for that Tile's result, and every reported Tile result SHALL come from a Simulator call on a valid Layout.
11. WHEN a Tile is split, THE Engine SHALL add one entry to the Decision_Log identifying the original Tile, the two resulting Tiles, and the reason for the split, and SHALL increase the split count in the Stats by 1.

### Requirement 7: Simulator errors

**User Story:** As a user, I want the run to continue when the simulator fails on one tile, so that I still get a complete result.

#### Acceptance Criteria

1. IF the Simulator raises an exception during the call for a Tile, THEN THE Engine SHALL mark that Tile as skipped, discard any partial Simulator output for that Tile, and continue the run with the next Tile.
2. WHEN a Tile is skipped, THE Engine SHALL add one Decision_Log entry with action "skip" that contains the Round, the identifiers of all Points in the Tile, and the exception message text, placed in the log at the position where the skip occurred.
3. WHEN a Tile is skipped, THE Engine SHALL increase the skipped Tiles count in the Stats by 1 for that Competitor.
4. WHEN a Tile is skipped, THE Engine SHALL use simulated annealing frequencies for that Tile in that step, SHALL NOT use placeholder values, and SHALL NOT count picks made from that Tile as atom-informed, so they are not part of the Quantum_Share. The Round's returned Independent_Set SHALL still be maximal on the Points available to that Round. Picks made from those annealing frequencies SHALL have the source "annealing" in the Decision_Log.
5. IF the Simulator raises an exception for every Tile in a Round, THEN THE Engine SHALL still complete the Round the same way, with annealing frequencies for every Tile, return a result for all Rounds, keep the Round maximal, and report in the Stats a skipped Tiles count equal to the number of Tiles sent to the Simulator.
6. IF an error other than a Simulator exception occurs during a run, THEN THE Engine SHALL stop the run, return an error to the Worker that contains the error type and the error message, and return no partial result.

### Requirement 8: Competitors

**User Story:** As a user, I want four methods run on the same map, so that I can compare atoms with classical choices.

#### Acceptance Criteria

1. WHEN a comparison run is requested, THE Engine SHALL run exactly four Competitors (Atoms_Alone, Hybrid, Annealing_Rules and Coin_Flip_Rules), each on the same Points, Conflict_Graph, Mode and Seed, and SHALL leave those inputs unchanged by any Competitor.
2. THE Engine SHALL run Atoms_Alone without applying Classical_Rules: it splits the Points into Tiles of at most 10 with the layout rule of Requirement 6, keeps the biggest repaired shot of each Tile, merges them, and drops every Point that conflicts with an already kept Point. Single-Point pieces are also run on the Simulator as one atom, so every Atoms_Alone pick comes from a Simulator run.
3. THE Engine SHALL return an Atoms_Alone result that is always an Independent_Set but can have gaps (a Point that is not picked and could be picked without creating a conflict), SHALL report in the Atoms_Alone Stats the number of gaps and their Point identifiers, and SHALL label the result "atoms alone (in pieces of 10 or less in simulation)".
4. THE Engine SHALL run Annealing_Rules and Coin_Flip_Rules with the same Classical_Rules, in the same order and with the same parameters as Hybrid, replacing only the atom step.
5. WHEN Coin_Flip_Rules is run twice on identical Points, Conflict_Graph, Mode and Seed, THE Engine SHALL return identical picks both times.
6. IF a Competitor fails during a comparison run, THEN THE Engine SHALL return an error for that Competitor identifying the failure cause, SHALL omit that Competitor's picks, and SHALL still return the results of the remaining Competitors.
7. THE Engine SHALL return a separate Decision_Log and a separate Stats object for each Competitor, with no entries from one Competitor appearing in another's Decision_Log or Stats.
8. WHEN a comparison run finishes, THE Engine SHALL return the picks of all four Competitors in one result, with each Competitor's picks labelled by its Competitor name, so that the UI can show them side by side.

### Requirement 9: Decision log

**User Story:** As a UI developer, I want an ordered decision log, so that I can animate and explain each step.

#### Acceptance Criteria

1. THE Engine SHALL return one Decision_Log for each of the four Competitors in every comparison run, and each Decision_Log SHALL cover all Rounds of the run (3 for Channel_Plan, 1 for Place).
2. THE Engine SHALL order Decision_Log entries by the order in which the decisions were made, so that each entry's position in the log is greater than the position of every entry made before it, across all Rounds.
3. THE Engine SHALL include in each Decision_Log entry exactly these fields: the Round (the channel 1, 6 or 11 for Channel_Plan, or the single Place Round), the source of the decision (one of rule, atoms, annealing, coin flip), the action (one of pick, remove, split, skip), and the identifiers of the affected Points (one or more identifiers, each equal to a Point identifier in the request).
4. WHEN the source of a Decision_Log entry is "rule", THE Engine SHALL include in the entry the name of the Classical_Rule that caused the decision.
5. WHEN the Engine serializes a result for the Worker, THE Engine SHALL produce text that a standard JSON parser accepts, containing only JSON types (object, array, string, number, true, false, null).
6. IF a result cannot be serialized to the JSON-compatible format, THEN THE Engine SHALL return an error to the Worker that names the field that failed and SHALL NOT return a partial result.
7. FOR ALL valid results, deserializing the serialized result SHALL produce a result equal to the original (round-trip property).
8. FOR ALL Rounds of every Competitor, THE Engine SHALL produce a Decision_Log whose pick entries for that Round, replayed in order, produce a set of Point identifiers equal to the Round's returned Independent_Set, with no Point identifier picked more than once.
9. WHILE a run is in progress, THE Engine SHALL send progress events per Round, step and Tile, so that the UI can light up the atoms. The progress events SHALL include these kinds:
   - a `simulate` event right before each real Simulator call, with the Tile ids;
   - a `frequencies` event after each real Simulator call, with the Tile ids, the frequency (0 to 1) of each Point in the Tile, and `shots`, the number of shots the Simulator returned;
   - a `shots` event right after each `frequencies` event (same conditions), with the Tile ids and `kept`: for each shot, in Simulator order, the indexes into the Tile ids of the Points kept after repair. These are the same repaired shots the frequencies are computed from, so for each Point the share of `kept` lists that contain its index equals its frequency, and the Engine makes no extra random draw for this event (experience spec, Requirement 6);
   - a `pick` event for every pick, carrying a `removed` list with the identifiers of the neighbour Points removed by that pick (an empty list when none), and the fields `remaining` (number of undecided Points before the pick), `top_group` (size of the top frequency group at that step), `rank` (1 is the top Point) and `frequency` (0 to 1) of the picked Point. These four fields are null where they do not apply: a pick with source `"atoms"` from the loop carries all four as numbers; a pick with source `"annealing"` or `"coin flip"` carries `remaining` and `top_group` as numbers and `rank` and `frequency` as null; a pick with source `"rule"` carries only `remaining` and the other three as null; every pick of Atoms_Alone carries all four as null;
   - a `pick` event with source `"rule"` for every pick made by a Classical_Rule, also carrying `removed` and the fields above.
10. THE Engine SHALL provide the emit switch as `api.run(request_json, emit=None)`. WHEN `emit` is None, THE Engine SHALL send no progress events. FOR ALL valid requests, THE Engine SHALL return the same result text with and without `emit`.

### Requirement 10: Stats and honesty

**User Story:** As a curious non-expert, I want honest numbers, so that I can trust what the app shows.

#### Acceptance Criteria

1. WHEN a run completes, THE Engine SHALL return Stats for each Competitor containing: the number of picks in each Round (a non-negative integer per Round), the number of picks per source (a non-negative integer per source), the Quantum_Share, the number of split Tiles (a non-negative integer), the number of skipped Tiles (a non-negative integer), the number of Braket calls, cache hits and layout fallbacks, and timings.
2. WHEN a run completes with a Quantum_Share of 0 picks, THE Engine SHALL include the Quantum_Share in the Stats with the value 0 for the number of picks.
3. WHEN the Quantum_Share is 0 picks and no Tile was sent to the Simulator in the run (skipped Tiles count as sent), THE Engine SHALL set a boolean flag in the Stats named `atoms_not_needed` to true, which indicates atoms were not needed on this map.
4. WHEN a run completes, THE Engine SHALL attach the Result_Label "simulation" to every result returned, including each Competitor's result and the Hybrid result.
5. WHEN a run completes, THE Engine SHALL return the results of all classical Competitors together with the Hybrid result in the same output.
6. THE Engine SHALL NOT include in any output a statement or field that claims a speed advantage of the Hybrid over any classical Competitor.
7. WHEN a run completes, THE Engine SHALL report in the Stats the count of splits, the count of skipped Tiles and the count of mismatches, including when any count is 0. The count of mismatches SHALL always be 0.
8. IF a layout problem (a split or a skipped Tile) occurs during a run, THEN THE Engine SHALL record it in the Stats of that run and SHALL complete the run without removing the record.
9. THE Engine SHALL compute every Stats value only from the picks and decisions made during that run, and SHALL NOT use values from earlier runs or fixed values.
10. THE Engine SHALL count a pick as atom-informed only if its frequency came from a real Simulator run, so that picks from a single-Point piece or from annealing frequencies are not part of the Quantum_Share.

### Requirement 11: Determinism on one device

**User Story:** As a developer, I want a run with the same input to give the same result on the same device, so that tests are stable.

#### Acceptance Criteria

1. WHEN two runs on the same device, in the same software environment, receive identical Points (same count, order and coordinate values), an identical Conflict_Graph (same vertices and edges), the same Mode and the same Seed, THE Engine SHALL return results that are bit-for-bit equal in every numeric output and equal in every non-numeric output.
2. WHEN the Engine is run by its test suite, THE Engine SHALL execute the tests with the environment variable OPENBLAS_NUM_THREADS set to 1.
3. IF the environment variable OPENBLAS_NUM_THREADS is unset or has a value other than 1 when the test suite starts, THEN THE Engine SHALL fail the test run before executing any test and SHALL report an error indicating that OPENBLAS_NUM_THREADS must be 1.
4. WHEN a determinism test compares two runs, THE Engine SHALL perform at least 2 runs per input and SHALL report the test as failed if any numeric output differs by even one bit between runs.

### Requirement 12: Testing

**User Story:** As a developer, I want automated tests with fixed settings, so that reported numbers are reproducible and not cherry-picked.

#### Acceptance Criteria

1. THE Engine SHALL have an automated test suite written with pytest and hypothesis, runnable with a single pytest invocation that exits with code 0 when all tests pass and a nonzero code when any test fails.
2. FOR ALL generated Conflict_Graphs and Modes, THE Engine SHALL return only Rounds whose Independent_Set contains no pair of Points joined by an edge (invariant property), with at least 100 hypothesis examples per run using a fake Simulator.
3. FOR ALL generated Conflict_Graphs, THE Engine SHALL place each Point in at most one Round (invariant property), with at least 100 hypothesis examples per run using a fake Simulator.
4. FOR ALL generated inputs, WHEN the Engine is run twice with the same Seed on the same device, THE Engine SHALL produce results that are exactly equal in every Round and every Point assignment (idempotence property), with at least 100 hypothesis examples per run using a fake Simulator.
5. FOR ALL generated Tiles of 1 to 10 nodes, THE Engine SHALL return only accepted Layouts whose atom spacing and edge match equal the values defined in Requirement 6 (invariant property), with at least 100 hypothesis examples per run.
6. THE Engine SHALL read the seeds, map sizes and run counts used for reported numbers from a test settings file committed to the repository before those runs are made, and THE Engine SHALL NOT accept overrides of these values when producing reported numbers.
7. IF a test settings value required for a reported number (seed, map size or run count) is missing, THEN THE Engine SHALL abort the run with an error indicating the missing value and SHALL NOT produce reported numbers.
8. THE Engine SHALL include the Hero map as a test fixture (a wifi hall of 70 APs on a 10 x 7 grid, 9 m spacing, ±2 m jitter, r = 20 m), and at least one test SHALL execute a complete Channel_Plan run on that fixture and assert that it finishes without error.
9. THE Engine SHALL include a sparse control fixture (the same hall with 11 m spacing and ±1.5 m jitter, r = 20 m), and at least one test SHALL assert that the Hybrid Quantum_Share on the sparse control is below half of the Hybrid Quantum_Share on the Hero map (both run with the seeds from the test settings file) and SHALL report both numbers, because the fixture is not changed to make a result look good.
10. THE Engine SHALL run every test that calls the real Braket Simulator with at most 20 hypothesis examples and mark it slow.
