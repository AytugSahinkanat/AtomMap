# Requirements Document

## Introduction

The UI is the web app people see. A visitor with no quantum background opens the link, sees a map, presses run, and watches atoms help pick points next to three other methods. The map comes first, theory second, in plain words. The UI code lives in `web/` and contains no algorithm logic. The Engine, Worker, Competitors, Decision_Log, Stats and progress events are defined in the engine spec (`.kiro/specs/engine/requirements.md`) and are not repeated here.

The one piece of computation the UI owns is building the edge list from the Radio_Model in Channel_Plan mode, with walls counted or not. The UI passes that edge list, with r, to the Engine as the Engine's Conflict_Graph definition.

The UI is built with Vite and TypeScript without a large framework, as a static build that works on GitHub Pages. The UI depends on three small additions to the Engine's progress events (Requirement 10). The UI task list, written later, begins with an Engine task for them, with tests. The Engine spec is not edited by this spec.

Out of scope: the AI tutor itself, real hardware, accounts, a backend, a map tile server.

## Glossary

- **UI**: The web app in `web/` that displays the screens below.
- **Engine**, **Worker**, **Point**, **Conflict_Graph**, **Round**, **Competitor**, **Quantum_Share**, **Result_Label**, **Stats**: As defined in the engine spec.
- **Loading_Screen**: The screen shown while the Worker loads the Engine.
- **Map_Screen**: The screen that shows the Points, their conflicts and the picks per Round.
- **Run_Screen**: The view shown while a run is in progress.
- **Scoreboard**: The view that shows the four Competitors side by side.
- **Hero_Map**: The wifi hall fixture with 70 access points, as defined in the engine spec.
- **Wall**: A line segment in the Hero_Map fixture, either concrete (12 dB loss) or drywall (4 dB loss).
- **Radio_Model**: Received power in dBm = 10 - 40 - 30 * log10(d in metres) - the sum of the losses of the Walls crossed by the straight line between two APs. Pt is 10 dBm, path loss at 1 m is 40 dB and the exponent is 3. The Wall term is included only while the walls toggle is on.
- **Signal_Threshold**: The received power at distance Hero_Map_R (r, read from the Hero_Map fixture) without Wall losses, computed from the Radio_Model as `receivedPowerDbm(r)`. It is about -69.03 dBm for r = 20 m. It is not a constant. An edge needs a power strictly above it, so with walls off the edges are exactly the pairs closer than r.
- **Hero_Map_R**: The Conflict_Radius r of 20 m, stored in the Hero_Map fixture.
- **Rule_Pick**: A pick whose Decision_Log source is "rule".
- **Tie**: Two or more Competitors with the same total pick count.
- **Place_Preset**: A Place mode preset with the cafe Points of one place (the real count stored in its Street_Fixture), a 150 m walking rule and the street data of that place. There is one: "Kadıköy, Istanbul" (file slug `kadikoy`).
- **Street_Fixture**: A committed file, one per place, with the street lines and the precomputed walking edges of that place, produced by the Street_Build_Script from OpenStreetMap data (Overpass). It also stores the real cafe count and the fetch date.
- **Street_Build_Script**: `scripts/fetch_place.py`. It takes a place name and a bounding box (south,west,north,east), fetches the data once and writes the Street_Fixture of that place. Bounding boxes: kadikoy 40.982,29.020,40.996,29.040.
- **Results_Page**: The "what we measured" page of the UI.
- **Results_File**: The committed file `results.json` that the Results_Page reads.
- **Run_Record**: One entry in the Results_File describing one run.
- **Plan_Selector**: A control that chooses which Competitor's picks the Map_Screen shows.
- **Progress_Event**: A message the Engine sends while a run is in progress, as in the engine spec (Requirement 9.9).
- **Frequencies_Event**: A Progress_Event sent after each Simulator call, carrying the Tile identifier and the frequency of each Point of that Tile.
- **atoms_not_needed**: The name of the Stats flag that the engine spec describes as "atoms were not needed on this map".
- **Custom_Map**: A map uploaded by the visitor as CSV (columns id, x, y in metres) or GeoJSON points.

## Requirements

### Requirement 1: Loading screen

**User Story:** As a visitor, I want to see what is happening while the page loads, so that the wait of 10 to 30 seconds teaches me something.

#### Acceptance Criteria

1. WHILE the Worker loads the Engine, THE Loading_Screen SHALL show a progress bar driven by the percent of the Worker's progress events.
2. WHILE the Worker loads the Engine, THE Loading_Screen SHALL show the current stage of the Worker's progress events as a plain-words sentence, such as "loading a quantum simulator into your browser".
3. WHEN the Worker reports that loading is complete, THE UI SHALL replace the Loading_Screen with the Map_Screen.
4. IF the Worker reports a loading error, THEN THE Loading_Screen SHALL show the error in plain words.

### Requirement 2: Map screen

**User Story:** As a visitor, I want to see the points and the picks on a map, so that I understand the result before reading any theory.

#### Acceptance Criteria

1. THE Map_Screen SHALL draw every Point at its position on the map.
2. THE Map_Screen SHALL draw every edge of the Conflict_Graph as a thin line between its two Points.
3. WHEN a run finishes in Channel_Plan mode, THE Map_Screen SHALL colour the Points picked in each Round by the selected Competitor by channel 1, 6 or 11.
4. WHEN a run finishes in Channel_Plan mode, THE Map_Screen SHALL colour Points picked in no Round grey and label them "5 GHz only".
5. WHEN a run finishes in Place mode, THE Map_Screen SHALL mark the Points picked in the single Round by the selected Competitor.
6. THE Map_Screen SHALL offer the one distance toggle of the current Mode: walls on or off in Channel_Plan mode, walking distance or straight line in Place mode.
7. THE Map_Screen SHALL offer a run button.
8. THE Map_Screen SHALL draw the Points, edges, Walls and streets from the UI's own data as SVG or canvas, without requesting tiles from a tile server.
9. WHILE a run is in progress, THE Map_Screen SHALL show the picks of the "atoms + rules (hybrid)" Competitor.
10. WHEN a run finishes, THE Scoreboard cards SHALL work as the Plan_Selector (one radio per card title, in a radio group labelled "plan on the map"), with "atoms + rules (hybrid)" selected, the selected card marked by an accent border and the text "on the map", and no extra row of controls. While the run is in progress the radios SHALL be disabled, and the radio of a Competitor whose entry is an error SHALL be disabled with the reason shown as text.
11. WHEN the visitor selects a Competitor in the Plan_Selector, THE Map_Screen SHALL show the picks of that Competitor without a new run, including the Points it left uncovered, and THE Tutor SHALL be given the selected plan (tutor Requirement 3).

### Requirement 3: Run screen

**User Story:** As a visitor, I want to watch the atoms work, so that I see where the quantum part helps.

#### Acceptance Criteria

1. WHEN the visitor presses the run button, THE UI SHALL start a run in the Worker and show the Run_Screen.
2. WHILE a run is in progress, THE Run_Screen SHALL animate the atoms of the current Tile from the Progress_Events per Round, step and Tile.
3. WHEN the UI receives a Frequencies_Event, THE Run_Screen SHALL make the Points of that Tile glow, with a brighter glow for a Point with a higher frequency.
4. WHEN the UI receives a pick event, THE Run_Screen SHALL show the picked Point locked in and SHALL fade out the removed neighbour identifiers carried by that event.
5. WHEN a Rule_Pick event is received, THE Run_Screen SHALL draw it differently from an atom pick and SHALL label it with a small "rule" tag.
6. THE Run_Screen SHALL offer a speed control and a skip button.
7. WHEN the visitor presses the skip button, THE UI SHALL jump to the end state of the run and show the Scoreboard.
8. WHERE the visitor's system sets prefers-reduced-motion, THE Run_Screen SHALL replace the animation with static steps, without glow transitions or fades.
9. WHEN the run finishes, THE UI SHALL show the Scoreboard.

### Requirement 4: Scoreboard

**User Story:** As a visitor, I want to compare the four methods side by side, so that I see what the atoms add and what they do not.

#### Acceptance Criteria

1. WHEN a run finishes, THE Scoreboard SHALL show four Competitors side by side, labelled "atoms alone", "atoms + rules (hybrid)", "annealing + rules" and "coin flip + rules", each with its picks per Round, its total picks, its splits and its skipped Tiles from the Stats.
2. THE Scoreboard SHALL show the Quantum_Share of each Competitor, including when it is 0%.
3. WHEN the Stats of a Competitor have atoms_not_needed set, THE Scoreboard SHALL show the text "atoms weren't needed on this map" for that Competitor.
4. THE Scoreboard SHALL show the Result_Label "simulation" on each result.
5. IF a run reports splits, skipped Tiles or mismatches in the Stats, THEN THE Scoreboard SHALL show them, including when a count is 0.
6. THE Scoreboard SHALL show the citation "Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5".
7. THE Scoreboard SHALL present the four Competitors with equal visual weight and SHALL NOT mark any Competitor as the winner.
8. WHEN two or more Competitors have a Tie, THE Scoreboard SHALL show the word "tie" for those Competitors.
9. THE Scoreboard SHALL contain no speed claim and no wording that says the quantum method wins.
10. THE Scoreboard SHALL show the Seed of the run and the note "One run proves nothing."
11. WHEN the visitor presses the "run again with another seed" button, THE UI SHALL start a new run with the previous Seed plus 1 on the same map and settings.
12. THE UI SHALL let the visitor type an integer Seed before a run.
13. IF the typed Seed is not an integer, THEN THE UI SHALL show a plain-words message and SHALL NOT start a run.

### Requirement 5: Channel plan on the wifi hall

**User Story:** As a visitor, I want to see how walls change which access points can share a channel, so that I understand why the plan changes.

#### Acceptance Criteria

1. THE Map_Screen SHALL offer the Hero_Map in Channel_Plan mode with 3 Rounds and a toggle labelled "walls on / off".
2. THE Map_Screen SHALL draw the Walls of the Hero_Map fixture, with concrete and drywall Walls visually distinct.
3. WHILE the walls toggle is on, THE UI SHALL build an edge between two APs only if the Radio_Model, with the loss of every crossed Wall, gives a received power strictly above the Signal_Threshold for that pair.
4. WHILE the walls toggle is off, THE UI SHALL build an edge between two APs only if the Radio_Model, without Wall losses, gives a received power strictly above the Signal_Threshold for that pair.
5. WHEN the visitor turns the walls toggle on, THE UI SHALL remove edges or keep them as they are, and SHALL NOT add an edge that is absent while the toggle is off.
6. THE UI SHALL read r (Hero_Map_R) from the Hero_Map fixture.
7. WHEN the visitor presses the run button, THE UI SHALL send the Engine the Points, the Mode, the Seed, the edge list of criterion 3 or 4 and r.

### Requirement 6: Place on real cafe maps

**User Story:** As a visitor, I want to place things on a real street map of Kadıköy, Istanbul, so that the 150 m rule means walking, not flying.

#### Acceptance Criteria

1. THE Map_Screen SHALL offer the Place_Preset in Place mode, with 1 Round, its display name "Kadıköy, Istanbul" shown as plain text (no selector, the map label reads "Kadıköy, Istanbul, N cafes" with N from the Street_Fixture) and a toggle labelled "walking / straight line".
2. WHILE the walking toggle is selected, THE UI SHALL pass the Engine the walking edges from the Street_Fixture, with r of 150 m.
3. WHILE the straight line toggle is selected, THE UI SHALL pass the Engine r of 150 m alone as the Conflict_Graph definition.
4. THE Map_Screen SHALL draw the streets of the Street_Fixture as thin lines under the Points.
5. THE Map_Screen SHALL show the attribution "© OpenStreetMap contributors" with a link to the ODbL licence for the Place_Preset.
6. THE UI SHALL read the Street_Fixture from a committed file and make zero requests to Overpass or any other street data service at runtime.
7. THE Map_Screen SHALL show the real cafe count and the fetch date stored in the Street_Fixture of the selected Place_Preset.
8. IF the Street_Build_Script finds fewer than 20 cafes for a place, THEN THE Street_Build_Script SHALL abort without writing the Street_Fixture of that place. The minimum only catches a broken or empty download and is not a quality bar.
9. THE Street_Build_Script SHALL write one Street_Fixture per place, containing the real cafe count and the fetch date of that fetch.
10. THE UI SHALL show the Points and edges that come out of each fetch as they are, without tuning or filtering them to change a result.
11. WHEN a run finishes in Place mode, THE Scoreboard SHALL show the atoms_not_needed text of Requirement 4.3 for any Competitor whose Stats have atoms_not_needed set, on either Place_Preset.

### Requirement 7: Export

**User Story:** As a visitor, I want to take the plan with me, so that I can use it outside the app.

#### Acceptance Criteria

1. WHEN a run finishes, THE UI SHALL offer an export of the plan shown on the map as CSV, with one row per Point containing its identifier, x, y and its Round (the channel in Channel_Plan mode, or "5 GHz only" for Points picked in no Round).
2. WHEN a run finishes, THE UI SHALL offer an export of the plan shown on the map as GeoJSON, with one point feature per Point and the same values as properties.
3. THE UI SHALL include the Result_Label "simulation" and the Seed in both exports.

### Requirement 8: Bring your own map (optional, lowest priority)

**User Story:** As a visitor, I want to upload my own points, so that I can try the method on my own map.

This requirement is the first to be cut if time runs out.

#### Acceptance Criteria

1. WHERE the Custom_Map feature is included, THE UI SHALL accept an uploaded CSV with the columns id, x and y in metres, or a GeoJSON file of points.
2. WHERE the Custom_Map feature is included, THE UI SHALL let the visitor choose r in metres and run the Custom_Map with that r as the Conflict_Graph definition.
3. WHERE the Custom_Map feature is included, IF an uploaded file cannot be read, THEN THE UI SHALL show the reason in plain words and keep the current map.

### Requirement 9: Moved to the tutor spec

**User Story:** As a visitor, I want the tutor to explain the run, so that I understand the result.

#### Acceptance Criteria

1. THE UI SHALL show the Tutor as specified in `.kiro/specs/tutor/requirements.md`, in place of the empty tutor panel of earlier versions of this spec.

### Requirement 10: Engine prerequisite (progress events)

**User Story:** As a UI developer, I want three additions to the Engine's progress events, so that the Run_Screen can show glow, fading neighbours and rule picks.

#### Acceptance Criteria

1. WHEN a Simulator call for a Tile finishes, THE Engine SHALL send a Frequencies_Event with the Tile identifier and the frequency of each Point of the Tile.
2. WHEN a Point is picked, THE Engine SHALL include in the pick event the identifiers of the neighbours removed by that pick.
3. WHEN a Classical_Rule picks a Point, THE Engine SHALL send a pick event with the source "rule".
4. FOR ALL generated inputs, THE Engine SHALL return the same picks, Decision_Log and Stats with progress events enabled as with progress events disabled (invariant property).

### Requirement 11: Platform and accessibility

**User Story:** As a visitor on any device, I want the app to be usable on a laptop and a phone, with keyboard and screen reader, so that everyone can try it.

#### Acceptance Criteria

1. THE UI SHALL run the Engine only in the Worker, so that the UI thread stays responsive during a run.
2. WHILE the screen is narrow, THE UI SHALL show its content in one column.
3. THE UI SHALL make every control reachable and operable by keyboard, with a visible focus indicator.
4. THE UI SHALL give every control and map element a text label for screen readers.
5. THE UI SHALL give each channel colour (1, 6, 11) and the "5 GHz only" state its own shape as well as its colour.
6. THE UI SHALL meet WCAG AA text contrast.
7. THE UI SHALL use English for all text.
8. THE UI SHALL meet the load and run time targets of the engine spec (Requirement 1.2 and 1.15) without redefining them.

### Requirement 13: What we measured page

**User Story:** As a visitor, I want a plain page with every recorded run, so that I can see the results as they came out, including the bad ones.

The script that fills the Results_File is a later spec. This spec covers the Results_Page and a small example Results_File.

#### Acceptance Criteria

1. THE Map_Screen SHALL contain a link to the Results_Page.
2. THE Results_Page SHALL read the Results_File from a committed file and make zero other data requests at runtime.
3. THE Results_Page SHALL show the protocol text and settings from the Results_File.
4. THE Results_Page SHALL show every Run_Record in a table, in the order of the Results_File, with its seed, map, picks per Competitor, Quantum_Share, atoms_not_needed, splits, skipped Tiles and status.
5. THE Results_Page SHALL show Run_Records with a failed or bad status in the same table as all others, with the same visual weight.
6. THE Results_Page SHALL show the Results_File as it is, without selecting, sorting out, averaging or ranking Run_Records.
7. THE Results_Page SHALL show the Result_Label "simulation" on each Run_Record.
8. THE Results_Page SHALL show the Quantum_Share of each Competitor, including when it is 0%.
9. THE Results_Page SHALL contain no speed claim.
10. THE Results_Page SHALL show the citation "Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5".
11. THE Results_Page SHALL meet the accessibility criteria of Requirement 11, with the table given column headers and a text caption for screen readers.
12. THE repository SHALL contain an example Results_File with a few Run_Records, including one failed Run_Record, whose `example` field is true.
13. WHILE the `example` field of the Results_File is true, THE Results_Page SHALL show a visible notice at the top that the data is an example and not a measurement.
14. IF the Results_File cannot be read or does not match the shape of criterion 15, THEN THE Results_Page SHALL show the reason in plain words and no table.
15. THE Results_File SHALL be a JSON object with the fields `example` (boolean), `protocol` (text and a settings object), and `runs` (a list of Run_Records), where each Run_Record has `seed`, `map`, `picks` (per Competitor), `quantum_share` (per Competitor), `atoms_not_needed`, `splits`, `skipped_tiles` and `status` ("ok", "failed" or "bad", with an optional reason text).

### Requirement 12: UI tests

**User Story:** As a developer, I want tests for the UI-owned logic and one end-to-end check, so that the UI numbers are trustworthy.

#### Acceptance Criteria

1. THE UI SHALL have unit tests for the wall edge builder, the walking edge builder and the Scoreboard numbers.
2. THE UI tests SHALL allow the gap between the Engine blockade radius (about 19.95 m) and the Hero_Map_R of 20 m.
3. THE UI SHALL have a Playwright smoke test that loads the page, runs the Hero_Map and checks that the Scoreboard shows four Competitors.
