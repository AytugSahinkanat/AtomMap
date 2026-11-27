# Requirements Document

## Introduction

The experience spec turns the one-screen app into a short guided visit. A visitor chooses a map, learns how to read it, watches a run in which every flash on screen comes from the real simulation, and then reads the results. It also adds a way to try the puzzle by hand, a map of the day to come back for, the two US maps, and a lab for people who want to change the settings.

The deadline is December 4, 2026. The lab (Requirements 15 to 18) is built after the main flow and before the optional UI property tests. It stays in. If time runs short, the cuts happen inside the lab, in this order: first "Download run log" (Requirement 16.6), then the guided experiment cards (Requirement 16.5).

The Engine, Worker, Competitors, Stats, Decision_Log and progress events are defined in the engine spec. The map screen, Scoreboard, Plan_Selector, export, Your_Map and Results_Page are defined in the ui spec. The Tutor (the explanation strip) is defined in the tutor spec. This spec changes how these parts are arranged and adds to them. It does not repeat them. All rules of `.kiro/steering/honesty.md` apply, and the look follows `.kiro/steering/design.md` as updated by Requirement 20.

Out of scope: accounts, a server, sharing results with other people, real hardware, other languages, sound.

## Glossary

- **Stage**: The area of the page that shows one Scene at a time.
- **Scene**: One page-like view of the Stage. There are four: Choose_Scene, Map_Scene, Run_Scene and Results_Scene.
- **Choose_Scene**: Scene 1, where the visitor chooses a map.
- **Map_Scene**: Scene 2, the chosen map with the How_To_Read items and the run button.
- **Run_Scene**: Scene 3, the map while a run is in progress.
- **Results_Scene**: Scene 4, the finished map with the Scoreboard and the Tutor.
- **Scene_Steps**: The row "1 Choose a map, 2 Read the map, 3 Run, 4 Results" that shows which Scene is current.
- **Map_Card**: A card on the Choose_Scene that stands for one map.
- **Card_Preview**: The small live picture of a map's Points and edges inside its Map_Card.
- **Card_Chips**: The small setting controls inside a Map_Card (walls on or off, walking or straight line, r).
- **How_To_Read**: The three short icon items of the Map_Scene that explain a dot, a line and the run.
- **Container_Transform**: The transition in which the Card_Preview grows into the map box of the Map_Scene.
- **Run_Number**: The Seed of a run as the visitor sees it, for example "Run #4821".
- **Group**: A Tile part that one Simulator call runs, as in the engine spec (at most 10 Points).
- **Shots_Event**: A new progress event with the repaired shots of one Simulator call: for each shot, the Points of the Group that are kept after repair.
- **Atom**: A Point of the Group on the atoms, drawn as a glowing sphere while its Group is simulated.
- **Blockade_Halo**: A circle of radius r/2 around an Atom. Two halos overlap exactly when the two Points are closer than r, so they cannot both light up.
- **Laser_Sweep**: A band of light that passes over the Group while it is simulated.
- **Shot_Replay**: The fast replay of the Shots_Event of a Group: the Atoms kept in each shot flash, and each Atom's glow builds up to its real frequency.
- **Shot_Histogram**: A small bar chart of how often each Atom of the Group was kept, filled in during the Shot_Replay.
- **Hand_Pick**: The set of Points the visitor picks by hand on a map.
- **Clash**: Two Points of the Hand_Pick that are joined by an edge.
- **Valid_Picks**: The Points of the Hand_Pick that are in no Clash.
- **Free_Points**: The Points that are not in the Hand_Pick and have no edge to any Point of the Hand_Pick, so each one could still be added alone without a Clash.
- **You_Line**: The line on the Results_Scene with the visitor's Valid_Picks for that map, for example "You: 23".
- **Daily_Map**: A map made from the UTC date, the same for every visitor on that date.
- **Daily_Seed**: The number made from the UTC date that builds the Daily_Map and is its Run_Number.
- **Local_Progress**: The visitor's best Valid_Picks per Daily_Map and the streak of days played, kept in the browser's localStorage.
- **Streak**: The number of UTC days in a row, up to today, on which the visitor made a Hand_Pick or a run on the Daily_Map.
- **US_Maps**: The two place maps "San Francisco bus stops (Mission)" (fixture `place_sf_bus_stops.json`) and "New York bike-share stations (Greenwich Village)" (fixture `place_nyc_bike_share.json`).
- **Map_Check**: A committed measurement of a place map in the built site: seeds 1, 2 and 3, the time of each run with all four plans, and the quantum share of each plan. Every run is reported, and none is rerun.
- **Daily_Check**: A committed measurement of the Daily_Map in the built site for the fixed dates 2026-12-01 to 2026-12-10: for each date one run with its Daily_Seed, the time with all four plans and the four totals. Every run is reported, and none is rerun.
- **Tangled_Cluster**: The part of the Daily_Map with 8 to 12 Points in which the order of picks matters: under the Rule_Pick_Process, at least two different final counts can be reached.
- **Rule_Pick_Process**: Repeat until no Point is left: apply the Classical_Rules (the simplicial rule) until no rule pick is possible, then pick any one of the Points left and remove its neighbours. It is the shape of every loop-based plan, with any choice of the non-rule picks.
- **Simulator_Ready**: The state in which the Worker has loaded the Engine and the Simulator and can start a run.
- **Lab**: The optional full-screen view for changing the settings of a run and comparing runs.
- **Lab_Settings**: An optional `settings` object in the Engine request with `shots` and `top_share` only.
- **Measured_Defaults**: The settings of every measured run: no `settings` object, which means 100 shots per Group and a Top_Group share of 40%.
- **Lab_Run**: A run started from the Lab.
- **Lab_History**: The table of the Lab_Runs of the current visit.
- **Lab_Label**: The text "Lab settings: shots N, top group P%. Not the measured defaults." shown on every Lab_Run result.
- **Engine**, **Worker**, **Point**, **Round**, **Tile**, **Competitor**, **Quantum_Share**, **Result_Label**, **Stats**, **Seed**, **Classical_Rules**, **Top_Group**: As defined in the engine, ui and tutor specs.
- **Scoreboard**, **Plan_Selector**, **Tutor**, **Your_Map**, **Point_Limit**, **Results_Page**, **Results_File**, **Hero_Map**, **Place_Preset**, **Street_Fixture**: As defined in the ui and tutor specs.

## Requirements

### Requirement 1: Scenes and routes

**User Story:** As a first-time visitor, I want the app to move through a few clear pages, so that I always know where I am and what to do next.

#### Acceptance Criteria

1. THE Stage SHALL show exactly one Scene at a time: Choose_Scene, Map_Scene, Run_Scene or Results_Scene.
2. THE UI SHALL give each Scene its own hash route: `#/` for the Choose_Scene, `#/map/<map>` for the Map_Scene, `#/map/<map>/run` for the Run_Scene and `#/map/<map>/results` for the Results_Scene, where `<map>` is the map's slug.
3. WHEN the visitor uses the browser's back or forward button, THE UI SHALL show the Scene of the new route.
4. IF the route names a Run_Scene or Results_Scene for which no run of this visit exists, THEN THE UI SHALL show the Map_Scene of that map, and IF the map slug is unknown, THEN THE UI SHALL show the Choose_Scene.
5. WHEN the visitor leaves the Run_Scene through the back button while a run is in progress, THE UI SHALL stop that run and show the Map_Scene.
6. THE route `#/results` SHALL keep showing the Results_Page, and every Scene SHALL keep its link to it.
7. THE Scene_Steps SHALL be shown on the Map_Scene, the Run_Scene and the Results_Scene, with the current Scene marked in text and by its look, and SHALL NOT be shown on the Choose_Scene.
8. WHEN a Scene opens, THE UI SHALL move the keyboard focus to that Scene's heading and announce its name in a polite live region.

### Requirement 2: Choose a map

**User Story:** As a first-time visitor, I want to see all maps at once and start with one click, so that I can pick the one that interests me.

#### Acceptance Criteria

1. THE Choose_Scene SHALL fill the Stage with the title "Choose a map", one line that states the question every map asks (how many points can be picked when no two that are too close may both be picked), and the Map_Cards.
2. THE Choose_Scene SHALL show one Map_Card for each of: the wifi hall, Kadıköy cafés, the two US_Maps, Your_Map, and the Daily_Map (Requirement 11).
3. EACH Map_Card SHALL show its map's name, a one-line description, a Card_Preview drawn from the map's own Points and edges, and its Card_Chips: walls on or off for the wifi hall, walking or straight line for the place maps, and r for Your_Map.
4. WHEN the visitor changes a Card_Chip, THE Card_Preview SHALL redraw with the new edges, and THE choice SHALL be kept when the Map_Scene of that map opens.
5. WHEN the visitor activates a Map_Card outside its Card_Chips (click, tap, Enter or Space), THE UI SHALL open the Map_Scene of that map without any further button.
6. THE Map_Cards SHALL be operable by keyboard, with one tab stop per card plus one per Card_Chip, and each card SHALL have a text label that names the map and its point count.
7. THE Map_Card of each US_Map SHALL show the note of Requirement 13.4.

### Requirement 3: Read the map

**User Story:** As a first-time visitor, I want three short hints instead of a paragraph, so that I understand the map at a glance.

#### Acceptance Criteria

1. THE Map_Scene SHALL show the chosen map, its label line (as in the ui spec, for example "Wifi hall, 70 access points. Results are a simulation."), its distance toggle, the run button, the Hand_Pick controls (Requirement 9) and the How_To_Read items.
2. THE How_To_Read items SHALL be exactly three, each one short line with a small icon: a dot is a place you could pick; a line means the two are too close, so only one of the two can be picked; run it and watch the atoms.
3. THE Map_Scene SHALL NOT show the Tutor's idle paragraph. The Tutor SHALL appear on the Results_Scene as in the tutor spec.
4. THE Map_Scene of a place map SHALL show the "© OpenStreetMap contributors" attribution with the licence link, and the source and fetch date from the Street_Fixture, as in the ui spec.
5. THE Map_Scene of a US_Map SHALL show the map's story line from its fixture.

### Requirement 4: Transitions

**User Story:** As a visitor, I want the pages to change smoothly and calmly, so that the app feels polished without getting in my way.

#### Acceptance Criteria

1. WHEN a Scene changes, THE outgoing Scene SHALL fade out while it scales down slightly and blurs, in about 260 ms.
2. WHEN a Scene opens, ITS parts SHALL come in one after another, each fading in while it rises about 14 px, in about 460 ms each, 60 ms apart, with an ease-out curve and no overshoot or bounce.
3. WHEN a Map_Card opens its Map_Scene, THE Card_Preview SHALL grow smoothly into the map box of the Map_Scene (Container_Transform, about 520 ms), and the map SHALL appear inside it.
4. WHILE a transition runs, THE UI SHALL ignore clicks, taps and key presses that would start another transition or a run.
5. WHERE the visitor's system sets `prefers-reduced-motion: reduce`, THE UI SHALL switch Scenes at once, with no fade, scale, blur, rise or Container_Transform.
6. EVERY transition SHALL end in the same final layout as a switch without motion.

### Requirement 5: Run numbers instead of seeds

**User Story:** As a first-time visitor, I want to press Run without being asked for a "seed", and to see that results vary, so that I am not stopped by jargon.

#### Acceptance Criteria

1. THE Map_Scene and the Results_Scene SHALL NOT show a seed input.
2. WHEN the visitor presses Run on a map other than the Daily_Map, THE UI SHALL choose the Run_Number itself, as a random integer from 1 to 9999 drawn by the browser.
3. WHEN a run finishes, THE Results_Scene SHALL show its Run_Number as "Run #N" and a "Repeat this run" control that starts a new run with the same Run_Number, map and settings.
4. THE "Run again" control of the Results_Scene SHALL start a new run with a new random Run_Number.
5. ON the Daily_Map, THE Run_Number SHALL always be the Daily_Seed, and "Run again" SHALL be replaced by "Repeat this run".
6. THE seed input SHALL exist only in the Lab, with the note "Same number, same result."
7. THE exports (ui spec Requirement 7) SHALL keep writing the Seed, which is the Run_Number.

### Requirement 6: Engine shots event

**User Story:** As a UI developer, I want the Engine to send the real repaired shots of each Group, so that the run animation replays real data and invents nothing.

This is an Engine prerequisite of Requirement 7. The Engine spec is updated by the first task of this spec.

#### Acceptance Criteria

1. WHEN a real Simulator call of a Group finishes, THE Engine SHALL send a Shots_Event right after that Group's `frequencies` event, with the Competitor, the Round, the step, the Group's Point ids in Group order and, for each shot, the indexes into that list of the Points kept after repair.
2. THE Shots_Event SHALL list the same shots, in the same order, that the frequencies of that Group were computed from, so that for every Point the share of shots that keep it equals its frequency in the `frequencies` event.
3. THE Engine SHALL make no random draw for the Shots_Event that it does not also make without it.
4. THE Engine SHALL NOT send a Shots_Event for a cache hit or a single-Point part, the same as for the `frequencies` event.
5. FOR ALL generated requests, THE Engine SHALL return the same result text with progress events enabled as with them disabled (the existing emit property, extended to the Shots_Event).

### Requirement 7: The run, shown from real data

**User Story:** As a visitor, I want to watch the atoms work on each group, so that I see what the quantum part actually does.

#### Acceptance Criteria

1. WHILE a run is in progress, THE Run_Scene SHALL draw the Hybrid Competitor's events only, as the ui spec does now.
2. WHEN a `simulate` event arrives, THE Run_Scene SHALL draw the Points of its Group as Atoms with their Blockade_Halos of radius r/2 in map units, and a Laser_Sweep over the Group.
3. WHEN the Shots_Event of that Group arrives, THE Run_Scene SHALL play its Shot_Replay: in each replayed shot exactly the Atoms kept in that shot flash, each Atom's glow rises to (shots that kept it so far) / (shots replayed so far), and the Shot_Histogram shows the same counts.
4. WHEN the Shot_Replay ends, EACH Atom's glow and bar SHALL equal its frequency in the `frequencies` event of that Group.
5. WHEN an atom pick event arrives, THE picked Atom SHALL collapse into a locked Point with a pulse and its `removed` neighbours SHALL fade, and WHEN a rule pick arrives, THE Point SHALL lock with the short pulse of the ui spec.
6. THE Run_Scene SHALL draw nothing that has no event behind it: no extra shots, no made-up frequencies, no halo for a Point that is not in the current Group.
7. THE speed control and the skip button SHALL keep working, and skip SHALL end in the same final state as a full replay.
8. WHERE `prefers-reduced-motion: reduce` is set, THE Run_Scene SHALL show the final state of each step at once: Atoms with their halos, the final glow and histogram, and the pick, with no sweep, flashes, pulses or fades.
9. IF a Group has no Shots_Event (for example a cached Group), THEN THE Run_Scene SHALL show its frequencies without a Shot_Replay and say "results reused from an earlier step" in the status line.

### Requirement 8: Results scene

**User Story:** As a visitor, I want the results on their own page, so that the scoreboard and the explanation have room.

#### Acceptance Criteria

1. THE Results_Scene SHALL show the finished map, the Scoreboard with the Plan_Selector, the Tutor, the You_Line when there is a Hand_Pick (Requirement 10), the Run_Number controls of Requirement 5, the export buttons and the "Open the lab" button of Requirement 15.
2. THE Scoreboard SHALL keep every rule of the ui spec: four equal cards, Quantum_Share always shown, splits and skipped Tiles always shown, the Result_Label, the citation and "One run proves nothing."

### Requirement 9: Try it yourself

**User Story:** As a visitor, I want to try the puzzle by hand, so that I feel how hard it is before the atoms do it.

#### Acceptance Criteria

1. ON the Map_Scene of any map, THE visitor SHALL be able to add a Point to the Hand_Pick or remove it by clicking or tapping it, or by pressing Enter or Space on it in the accessible Point list.
2. THE Map_Scene SHALL draw the Points of the Hand_Pick with a distinct mark, and the Points in a Clash in red together with the edge between them, with shape or line style as well as colour.
3. THE Map_Scene SHALL show the number of Valid_Picks and, when it is not 0, the number of Clashes, and a hint with the number of Free_Points: "You could still add N more without a clash." or, when N is 0, "No point can be added without a clash."
4. THE Map_Scene SHALL offer a "Clear my picks" control.
5. THE Hand_Pick SHALL be kept per map and per distance setting until the visitor clears it or the page is reloaded, and changing the distance setting SHALL show that setting's own Hand_Pick.
6. ON Your_Map, WHILE the Hand_Pick mode is on, a click SHALL pick or unpick a Point instead of adding or removing one, and THE Map_Scene SHALL offer one toggle "Edit points / Pick points" to switch between the two.
7. THE Valid_Picks, Clashes and Free_Points SHALL be computed from the same edges that the run request uses.

### Requirement 10: Your pick next to the four plans

**User Story:** As a visitor, I want to see my own count next to the four plans, so that I can compare without being told I won or lost.

#### Acceptance Criteria

1. WHEN a run finishes on a map with a non-empty Hand_Pick for the same distance setting, THE Results_Scene SHALL show the You_Line "You: N" with N the Valid_Picks, followed by "(K clashes not counted)" when there are Clashes.
2. THE You_Line SHALL be shown next to the Scoreboard, outside the four cards, and SHALL NOT change the look of any card.
3. THE You_Line and every text about it SHALL use neutral words only, and SHALL NOT contain "beat", "win", "winner", "won", "lose", "lost", "better", "worse" or "best".
4. THE Tutor SHALL NOT mention the Hand_Pick.

### Requirement 11: Map of the day

**User Story:** As a returning visitor, I want a new small map every day, the same for everyone, so that I have a reason to come back and can compare fairly.

#### Acceptance Criteria

1. THE UI SHALL build the Daily_Map from the Daily_Seed of the current UTC date, so that every visitor sees the same Points, edges, r and Run_Number on that date.
2. THE Daily_Seed SHALL be the integer YYYYMMDD of the UTC date.
3. THE Daily_Map SHALL have between 30 and 40 Points, no more than the Point_Limit, in its own drawing area of 120 × 80 m with r = 10 m (larger than Your_Map's 90 × 60 m), and SHALL contain at least one chain (a path the Classical_Rules can solve), at least one ring of 4 to 6 Points in which no Point is simplicial (a part the Classical_Rules alone cannot finish), and exactly one Tangled_Cluster. No edge SHALL join two of its parts.
4. THE Daily_Map SHALL be different for different dates (at most 1 equal map pair in 366 consecutive dates).
5. THE Choose_Scene SHALL show the Daily_Map as its own Map_Card titled "Today's map" with the date, and the Map_Card SHALL show the Local_Progress when there is any.
6. THE Daily_Map SHALL run in Place mode with one Round and straight-line edges, with the Run_Number fixed to the Daily_Seed (Requirement 5.5).
7. THE Tangled_Cluster SHALL have 8 to 12 Points, be connected, take one or two slots of the Daily_Map, and reach at least two different final counts under the Rule_Pick_Process, checked by trying every choice of non-rule picks.
8. NO text of the app SHALL promise or suggest that the plans or the visitor get different counts on the Daily_Map. THE UI SHALL only show the numbers of the run.
9. THE Daily_Check SHALL be made with `npm run check-maps` for the dates 2026-12-01 to 2026-12-10, fixed before measuring, and SHALL report every run. Each run with all four plans SHALL take 60 seconds or less in the built site. IF a run takes longer, THEN THE check SHALL report it as over the limit and change nothing, so that the owner and the developer look at the numbers before any change to the Daily_Map.

### Requirement 12: Local progress

**User Story:** As a returning visitor, I want my best count and my streak remembered on this device, so that I see my progress without an account.

#### Acceptance Criteria

1. WHEN the visitor's Valid_Picks on a Daily_Map are higher than the stored best for that date, THE UI SHALL store the new best in localStorage.
2. WHEN the visitor makes a Hand_Pick or a run on the Daily_Map, THE UI SHALL mark that UTC date as played and update the Streak.
3. THE UI SHALL wrap every localStorage read and write in a try/catch, and IF localStorage is missing, full or blocked, or holds data of the wrong shape, THEN THE UI SHALL work as without Local_Progress and show no error to the visitor.
4. THE UI SHALL send nothing to any server. Local_Progress SHALL never leave the browser.
5. THE Local_Progress SHALL keep at most the last 60 dates.

### Requirement 13: The two US maps

**User Story:** As a visitor, I want two real US maps next to Kadıköy, so that I see a case where the rules alone are enough.

#### Acceptance Criteria

1. THE UI SHALL offer the US_Maps as place maps, each loaded from its committed fixture, with its name, its r from the fixture (244 m and 305 m), its walking edges, its story line and its source, and the "© OpenStreetMap contributors" attribution with the licence link.
2. THE fixture loader SHALL read r and the walking limit from each fixture, and SHALL NOT assume 150 m.
3. NO text, file name, fixture value or export of the app SHALL contain an operator or brand name of the two US systems.
4. WHERE the Map_Check of a US_Map shows that the rules made every pick (Quantum_Share 0% for the Hybrid) in all three seeds, THE Map_Card and the Map_Scene of that map SHALL say so in plain words: the atoms were not needed in our runs on this map, because the stops or stations line up along streets and the rules solve such chains. The text SHALL read as a contrast with the hall and Kadıköy, not as a failure.
5. THE text of Requirement 13.4 SHALL be taken from the committed Map_Check, and SHALL NOT be shown for a map whose Map_Check is missing, is for another version of the fixture, or does not show 0% in all three seeds.
6. A US_Map SHALL be shown in the app only when its Map_Check shows that seeds 1, 2 and 3 each finished all four plans in 60 seconds or less in the built site. This rule was fixed before measuring. THE Map_Check SHALL be made again after every new fetch of a US fixture, and SHALL report every run.
7. THE Results_Page SHALL stay as it is, and SHALL add one sentence that its measured protocol covers the wifi hall, the sparse wifi hall and Kadıköy only.

### Requirement 14: Map data fixes

**User Story:** As the project owner, I want clean names in the US fixtures, so that no brand appears and stops at one crossing become one point.

These fixes are done before this spec's other tasks, so that the owner can rerun both fetches.

#### Acceptance Criteria

1. WHEN `scripts/fetch_place.py` builds a bike_share fixture, IT SHALL remove an operator or brand prefix before the station name, and SHALL stop without writing a file when an operator or brand word is still in a name.
2. WHEN `scripts/fetch_place.py` merges bus stops, IT SHALL treat a crossing with its streets in the other order as the same name ("Mission Street & 16th Street" and "16th Street & Mission Street"), with all stops of a group still within 40 m of each other.
3. THE CI engine job SHALL run `scripts/test_fetch_place.py`.

### Requirement 15: Opening and leaving the lab

**User Story:** As a curious visitor or a developer, I want a separate lab that feels like a lab, so that I can dig in without cluttering the normal visit.

#### Acceptance Criteria

1. THE Results_Scene SHALL show an "Open the lab" button with a small flask icon, and THE Lab SHALL be closed by default and reachable only through that button or its route `#/map/<map>/lab`.
2. WHEN the visitor opens the Lab, THE UI SHALL play the lab entrance in about 1 second: the screen fades to the darker lab colour, a line drawing of an Erlenmeyer flask appears in the middle (accent purple outline, teal liquid), the liquid rises, three small teal bubbles float up, and "ENTERING THE LAB" settles in under it.
3. AFTER the entrance, THE Lab SHALL fill the screen with a darker background and a faint measurement grid, monospace labels, three columns (instruments with controls, the map, readouts) whose panels rise in one after another, and a top bar with a small flask icon, the text "ATOMMAP LAB · <map name> · RUN <n>" and the text "Lab settings, not the measured defaults."
4. EACH panel title SHALL have a small line icon (flask, sliders, test tubes or gauge), drawn as inline SVG in the steering palette or taken from an open icon set whose licence is noted in the repository, with no new dependency.
5. WHEN the visitor presses "Leave the lab" or Escape, THE Lab panels SHALL fade out and the Results_Scene SHALL come back in, with the focus on the "Open the lab" button.
6. WHEN the Lab opens, THE focus SHALL move to the Lab's heading.
7. WHERE `prefers-reduced-motion: reduce` is set, THE Lab SHALL open and close at once, with no entrance animation.
8. THE Lab motion SHALL have no bounce and nothing cartoonish.

### Requirement 16: Lab controls

**User Story:** As a curious visitor, I want to change a few settings and see what happens, so that I learn what each part of the method does.

#### Acceptance Criteria

1. THE Lab SHALL offer, each with a short plain instruction next to it: the Run_Number as a seed input with the note "Same number, same result.", the map's r, the shots per Group (integer, 10 to 200, default 100) and the Top_Group share (10% to 100%, default 40%), and a "Run again" button.
2. IF a typed value is outside its range or not a number, THEN THE Lab SHALL show a plain-words message next to that control and SHALL NOT start a run.
3. WHERE the map uses walking edges, THE r control SHALL be read-only with the note that the walking distances were measured on the streets for that r, and that switching to straight line allows changing it.
4. THE Lab SHALL show the Lab_History: one row per Lab_Run of this visit, with the Run_Number, r, shots, Top_Group share, the four totals and the Hybrid's Quantum_Share, in the order they were made.
5. THE Lab SHALL show a few guided experiments as short cards, each with one sentence of what to try and one of what to look for, at least: change the seed (one run proves nothing); 10 shots (the atoms' advice gets noisier); Top_Group 100% (pick at random among all points); Top_Group 10% (always follow the strongest atom); a bigger r (more lines, more tangles, more work for the atoms). Activating a card SHALL set its controls and SHALL NOT start a run by itself.
6. THE Lab SHALL offer "Copy request" (the exact JSON text sent to the Engine for the shown run) and "Download run log" (all progress events and the result of that run as one JSON file).
7. THE Lab SHALL show a "For developers" box that says the Engine is a Python package, shows how to call `atommap.api.run` with a request in a few lines, and links to the README.
8. THE Lab readouts SHALL show, for the shown run, the four totals, the Quantum_Share of each plan, splits and skipped Tiles, all from that run's result.

### Requirement 17: Engine lab settings

**User Story:** As a developer, I want the Engine to accept a small optional settings object, so that the Lab can change shots and the Top_Group share without changing the measured defaults.

#### Acceptance Criteria

1. THE Engine SHALL accept an optional `settings` object in the request with only the keys `shots` (integer, 10 to 200) and `top_share` (number, 0.1 to 1.0).
2. IF `settings` has another key, a value of the wrong type or a value outside its range, THEN THE Engine SHALL return a ValidationError with a plain message that names the key and the allowed values.
3. WHEN `settings` is absent, THE Engine SHALL behave exactly as before this spec.
4. FOR ALL generated requests, THE result text with no `settings` SHALL equal the result text with `settings` `{"shots": 100, "top_share": 0.4}` (defaults property).
5. THE `shots` setting SHALL set the number of shots of every Simulator call of the run, and THE `top_share` setting SHALL be passed to every loop-based Competitor of the run (Hybrid, Annealing_Rules, Coin_Flip_Rules), so that the four Competitors keep running under the same conditions. Coin_Flip_Rules has no ranking and already picks among all remaining Points, so `top_share` does not change its picks; this is its definition and is not changed.
6. THE measurement scripts and the Results_Page SHALL always use the Measured_Defaults, and `web/scripts/record-results.mjs` SHALL refuse a request with a `settings` object.
7. THE recorded Tutor runs in `web/test-data/tutor` SHALL still reproduce exactly from the native Engine without `settings`.

### Requirement 18: Lab results are labelled

**User Story:** As a visitor, I want every lab result to say that it used other settings, so that I never mistake it for a measured result.

#### Acceptance Criteria

1. EVERY Lab_Run result SHALL show the Lab_Label on the Scoreboard and on the first line of the Tutor, and in both exports.
2. THE Tutor SHALL keep using only the numbers of that run, also for a Lab_Run.
3. THE Lab_Label SHALL be shown even when the Lab settings equal the defaults, because a Lab_Run may also change the seed or r.
4. WHEN the visitor leaves the Lab after a Lab_Run, THE Results_Scene SHALL show that Lab_Run with its Lab_Label until a normal run replaces it.

### Requirement 19: README

**User Story:** As a developer, I want to know how to use the Engine and how to add my city, so that I can build on AtomMap.

#### Acceptance Criteria

1. THE README SHALL have a section "Build on AtomMap" with the request and result format and a Python example of about 10 lines that calls `atommap.api.run`.
2. THE README SHALL have a section "Add your city" with one `scripts/fetch_place.py` command for each `--kind`.
3. EVERY command and code example in these sections SHALL be run once in this repository before it is written down.

### Requirement 20: Steering update

**User Story:** As the project owner, I want the motion rule written down, so that the rich animation stays honest.

#### Acceptance Criteria

1. THE `.kiro/steering/design.md` SHALL say that motion may be rich when it shows real data, SHALL never be decoration or show made-up data, and that reduced motion always works.
2. THE `.kiro/steering/design.md` SHALL list the new transition timings of Requirement 4, the lab look of Requirement 15 (darker background, faint grid) and that the Lab, and only the Lab, may use the system monospace font stack (no web fonts).

### Requirement 21: Layout and accessibility

**User Story:** As a visitor on a laptop or a phone, I want every Scene to fit and work, so that I can use the app anywhere.

#### Acceptance Criteria

1. EVERY Scene and the Lab SHALL fit a 1366 x 768 viewport (inner size) without vertical page scroll, in every state of the layout check.
2. EVERY Scene and the Lab SHALL work at a 375 px wide viewport without horizontal scroll, with every control reachable.
3. EVERY control SHALL be reachable and operable by keyboard with a visible focus indicator and a text label, as in the ui spec.
4. THE Atoms, Blockade_Halos, Hand_Pick marks and Clash marks SHALL use shape or line style as well as colour.

### Requirement 22: Tests

**User Story:** As a developer, I want the new parts tested, so that the numbers on screen are trustworthy.

#### Acceptance Criteria

1. THE existing Tutor, Results_Page and Engine properties SHALL keep passing.
2. THE Engine SHALL have tests that the Lab_Settings are validated with plain errors, a property that no `settings` and the default `settings` give the same result text, a property that the Shots_Event matches the `frequencies` event of the same Group, and the existing emit property extended to the Shots_Event.
3. THE UI SHALL have a property test that the Valid_Picks, Clashes and Free_Points equal a brute-force count on small random maps.
4. THE UI SHALL have tests that the Daily_Map is the same for the same date, differs across dates, and meets Requirements 11.3 and 11.7 for every date of a full year.
5. THE UI SHALL have tests that Local_Progress survives a localStorage that throws, is missing or holds wrong data, and that the app still works.
6. THE UI SHALL have a test that the Shot_Replay end state equals the `frequencies` event, and that skip and a full replay end in the same state.
7. THE layout check SHALL cover every Scene and the Lab at 1366 x 768 and at 375 px.
8. THE UI SHALL have a test that the You_Line and the Lab texts contain no banned word.

### Requirement 23: Loading in the background

**User Story:** As a first-time visitor, I want to see the maps right away instead of a 30-second loading screen, so that I can look around and try the puzzle by hand while the simulator loads.

This replaces the Loading_Screen of the ui spec (its Requirement 1) in the normal flow.

#### Acceptance Criteria

1. WHEN the page opens, THE UI SHALL show the Choose_Scene at once and start loading the Engine in the Worker in the background.
2. THE Map_Cards, the Card_Previews, the Map_Scene and the Hand_Pick SHALL work before Simulator_Ready.
3. WHILE the Simulator is not ready, THE run button of the Map_Scene SHALL be disabled, SHALL show the loading progress (the percent and the plain-words stage of the Worker's progress events, as on the old Loading_Screen), and THE Map_Scene SHALL show the hint "Try it by hand while the simulator gets ready."
4. WHEN Simulator_Ready is reached, THE run button SHALL become enabled and say "Run", and the hint SHALL go away, with a polite announcement for screen readers.
5. IF loading fails, THEN THE run button SHALL stay disabled and THE Map_Scene SHALL show the error in plain words, as the old Loading_Screen did, and the Choose_Scene, the Map_Cards and the Hand_Pick SHALL keep working.
6. THE Results_Page SHALL keep working without waiting for the Worker.

### Requirement 24: The answer box
**User Story:** As a visitor, I want the results to answer the map's question in plain words, so that I do not have to work out the answer from four cards.
#### Acceptance Criteria
1. WHEN a run finishes, THE Results_Scene SHALL show the Answer_Box with the headline "Answer: you can pick N of these M <noun>, with no two <rule>.", with <noun> and <rule> from the map: "cafés" and "within a 150 m walk" (or "closer than 150 m" in a straight line) on Kadıköy, "bus stops" and "stations" with their own r on the US_Maps, "points" and "closer than r m" on Your_Map and the Daily_Map.
2. ON the channel plan, THE headline SHALL read "Answer: N of M access points get a 2.4 GHz channel: a on channel 1, b on 6, c on 11. The other K use 5 GHz only."
3. N SHALL be the size of the Answer_Set. THE UI SHALL check each plan's sets against the edges of the run request (no edge inside a Round's set, no Point in two Rounds, the count equal to the plan's total) and SHALL count only plans that pass. A plan that fails the check or did not finish SHALL be named in the box with the reason.
4. WHEN the Valid_Picks of the Hand_Pick of the same map and distance setting are more than every plan's count, THE Answer_Set SHALL be the Hand_Pick, and THE box SHALL say "Your own pick has N points with no clash, more than the plans found in this run." On the channel plan the Hand_Pick is one set, not three channels, so it SHALL NOT be compared.
5. THE box SHALL name the plans that found N ("Found by annealing + rules.") and give the others' counts ("Atoms alone found 25, atoms + rules (hybrid) 31, coin flip + rules 33."), with neutral words only: found, picked, more, fewer. IT SHALL NOT contain "beat", "win", "winner", "won", "lose", "lost", "better", "worse" or "best".
6. ONLY WHEN every Point outside the Answer_Set has an edge to a Point of it (on the channel plan: to a Point of each Round's set), THE box SHALL say "Every other one is <near> one of them. Click a point to see which." (on the channel plan: "Each of the other K clashes with an access point on every channel. Click a point to see which."). A click or Enter on a Point SHALL then name its neighbours in the Answer_Set.
7. THE box SHALL always say "This is the most found in this run. It is not proven to be the most possible."
8. THE box SHALL offer "Show them on the map", which selects the plan of the Answer_Set on the map through the Plan_Selector (or draws the Hand_Pick), so that the export buttons then export exactly that plan; the Hybrid stays the default view.
9. THE box SHALL offer "Show the list", folded by default, with the ids of the Answer_Set, or their names on place maps, by channel on the channel plan.
10. ON a Lab_Run, THE box SHALL show the Lab_Label.
11. EVERY number in the box SHALL come from the run; THE UI SHALL compute nothing beyond counting and checking the sets. THE Tutor SHALL stay as it is.
12. THE Results_Scene with the box SHALL fit 1366 x 768 without vertical page scroll and work at 375 px without horizontal scroll.
