# Requirements Document

## Introduction

The UI is the web app people see. A visitor with no quantum background opens the link, sees a map, presses run, and watches atoms help pick points next to three other methods. The map comes first, theory second, in plain words. The UI code lives in `web/` and contains no algorithm logic. The Engine, Worker, Competitors, Decision_Log, Stats and progress events are defined in the engine spec (`.kiro/specs/engine/requirements.md`) and are not repeated here.

The one piece of computation the UI owns is building the edge list: from the Radio_Model in Channel_Plan mode, with walls counted or not, and from straight-line distance for the Your_Map. The UI passes that edge list, with r, to the Engine as the Engine's Conflict_Graph definition.

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
- **Your_Map**: The third map choice. A set of Points that the visitor draws, pastes or uploads, run in one Round with Place mode rules (the Engine's `place` mode) and a straight-line conflict radius chosen by the visitor.
- **Your_Map_Area**: The drawing area of the Your_Map, fixed at 90 m wide and 60 m high (about the size of the Hero_Map), with the origin at its lower left corner.
- **Map_Editor**: The part of the Map_Screen where the visitor edits the Your_Map: click to add or remove a Point, a Clear button, an Add random points button and the r input.
- **Your_R**: The Conflict_Radius r of the Your_Map in metres. Default 20 m, allowed 2 m to 200 m.
- **Map_Text**: The text box and the file chooser through which the visitor gives the Your_Map as CSV (columns id, x, y in metres) or GeoJSON points.
- **Point_Limit**: The largest number of Points a Your_Map may have. It is a measured number (Requirement 8.13), stored as one constant in `web/src/settings.ts` and written with its measurements in the design document.

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

### Requirement 8: Your map

**User Story:** As a visitor, I want to draw or bring my own points and run the method on them, so that I can try it on a map I care about.

#### Acceptance Criteria

1. THE Map_Screen SHALL offer "Your map (1 round)" as a third choice in the Mode group, next to "Channel plan (3 rounds)" and "Place (1 round)". The Your_Map runs in one Round and sends the Engine mode `place`.
2. WHEN the visitor chooses the Your_Map for the first time in a visit, THE Map_Screen SHALL show the Your_Map_Area, drawn at its true proportions (90 m by 60 m), with the Map_Editor and a starting map of 10 Points made by the fixed generator of the design (the same 10 Points every time), so that a run works at once, and the short hint "Click to add or remove points." on the map. Choosing another map and coming back keeps the Points the visitor has. "Clear" still empties the map.
3. WHEN the visitor clicks an empty spot of the Your_Map_Area, THE Map_Editor SHALL add a Point there, with its x and y in metres rounded to 0.1 m and the next free id of the form `p001`, `p002`.
4. WHEN the visitor clicks an existing Point, THE Map_Editor SHALL remove that Point and no other.
5. THE Map_Editor SHALL offer a "Clear" button that removes every Point, and an "Add random points" button that adds 10 Points at random places inside the Your_Map_Area.
6. WHILE the visitor edits, THE Map_Screen SHALL draw the Points and every edge of the Conflict_Graph (every pair of Points closer than Your_R) as in Requirement 2.2, and SHALL redraw after every change.
7. THE Map_Editor SHALL offer a number input for Your_R in metres, labelled in text, with the default 20 and the allowed range 2 to 200. IF the typed value is not a number in that range, THEN THE UI SHALL show a plain-words message, keep the last valid Your_R for the picture and SHALL NOT start a run.
8. WHEN the visitor presses the run button on a Your_Map, THE UI SHALL build the request with `buildRequest` like the other maps and send the Engine the Points, the mode `place`, the Seed, Your_R and the edge list of exactly the pairs of Points with a distance strictly below Your_R, each pair once. The Engine is not changed.
9. THE Map_Screen SHALL offer the Map_Text: a text box for pasted CSV and a file chooser that takes a CSV or a GeoJSON file, each with an apply action that works from the keyboard. Files are read in the browser and nothing is sent anywhere.
10. THE UI SHALL read CSV text as follows: the first line names the columns and contains `id`, `x` and `y` (any order, other columns ignored), values are separated by commas, semicolons or tabs, `x` and `y` are numbers in metres written with a dot, and ids are non-empty and unique.
11. THE UI SHALL read GeoJSON as a FeatureCollection, a single Feature or a bare Point geometry, in which every feature is a Point with `[longitude, latitude]`, and SHALL project the points to local metres with the equirectangular projection around the centroid of the points that `scripts/fetch_place.py` uses. The id of a Point is `properties.id` when it is a non-empty text or number, otherwise the next free `p001`-style id. The Points keep their longitude and latitude for the GeoJSON export.
12. IF the Map_Text cannot be used, THEN THE UI SHALL show the reason in plain words next to the Map_Text, keep the current map exactly as it was (Points, Your_R and result) and change nothing else. The reasons cover at least: an unreadable or too large file (over 1 MB), text that is not CSV or GeoJSON, an empty file or no Points, a missing column, a value that is not a number (with its line), a duplicate id, a feature that is not a Point, and more Points than the Point_Limit. WHEN the Map_Text is good, THE UI SHALL replace the Points of the Your_Map with it, keep Your_R, and clear any earlier result.
13. THE Point_Limit SHALL be the largest tested Point count for which the slowest measured run of all four Competitors stays under about 60 seconds on the development laptop in the built site, found by measuring dense and sparse random layouts at several sizes with settings fixed before the run (honesty rule 8). The design document SHALL record the settings, every measurement and the resulting limit, and the page SHALL show no time and make no speed claim.
14. THE Map_Editor, the Add random points button and the Map_Text SHALL NOT take the Your_Map above the Point_Limit: they show a plain-words message that names the limit and leave the map as it was. IF a Your_Map above the Point_Limit is somehow present when the visitor presses run, THEN THE UI SHALL show the same kind of message and SHALL NOT start a run. A Your_Map with no Point cannot be run, and the run button says why in text.
15. THE Map_Screen SHALL label the Your_Map "Your map, N points. Results are a simulation." with N the current number of Points, and the Scoreboard SHALL show the Quantum_Share, splits, skipped Tiles, the Result_Label and the citation exactly as for the other maps (Requirement 4).
16. THE Tutor, the Plan_Selector and the export (Requirements 2.10, 2.11, 7 and 9) SHALL work on a finished Your_Map run as on the other maps. The Tutor's sentences about the map SHALL say "point" and SHALL NOT call the points cafes or access points. The export file name uses the map name `your-map`, and the GeoJSON geometry follows the rule of the design (`[lon, lat]` only when every Point has a longitude and a latitude).
17. WHEN the visitor changes the Points or Your_R after a finished run, THE UI SHALL clear that result and the Tutor and show the editor state. WHILE a run is in progress, THE Map_Editor and the Map_Text SHALL be disabled.
18. THE Your_Map SHALL NOT be part of the Results_Page: the Results_Page, the Results_File and `web/scripts/record-results.mjs` do not mention it.
19. THE Map_Screen with the Your_Map SHALL fit a 1366 x 768 viewport (inner size) without vertical scrolling in every state (empty, with Points, with a Map_Text message, a run in progress, a finished run) and SHALL be usable at a 375 px wide viewport without horizontal scrolling and with every control reachable.
20. THE Map_Editor and the Map_Text SHALL follow Requirement 11: every control reachable and operable by keyboard with a visible focus indicator and a text label, and the Map_Text is the keyboard way to make a Your_Map, so drawing with the pointer is never the only way.

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
2. WHILE the viewport is 60rem (960 px at the default font size) wide or narrower, THE UI SHALL show its content in one column on the Map_Screen, the Scoreboard and the Results_Page.
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
16. THE Results_Page SHALL show, under the results table and before the citation, one plain paragraph that says the numbers come from the browser build and reports how often a desktop Python run of the same 30 requests matched (17 of 30 runs; the hybrid's numbers differed slightly in the others, annealing and coin flip matched in all 30), whether or not the Results_File is an example.

### Requirement 12: UI tests

**User Story:** As a developer, I want tests for the UI-owned logic and one end-to-end check, so that the UI numbers are trustworthy.

#### Acceptance Criteria

1. THE UI SHALL have unit tests for the wall edge builder, the walking edge builder and the Scoreboard numbers.
2. THE UI tests SHALL allow the gap between the Engine blockade radius (about 19.95 m) and the Hero_Map_R of 20 m.
3. THE UI SHALL have a Playwright smoke test that loads the page, runs the Hero_Map and checks that the Scoreboard shows four Competitors.
4. THE UI SHALL have unit tests for the Map_Text parser (good CSV and GeoJSON files, bad columns, non-Point features, an empty file, too many Points), for the Map_Editor logic (add, remove, Clear, random) and for the Your_Map request (property test: the request edges are exactly the pairs closer than Your_R).
5. THE UI SHALL have a Playwright check of Requirement 8.19 (1366 x 768 and 375 px) for the Your_Map.
