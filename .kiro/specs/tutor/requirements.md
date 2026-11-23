# Requirements Document

## Introduction

The Tutor explains one finished run in plain words to a visitor who has never touched quantum computing. This version has no AI model. The Tutor is a set of fixed sentences filled with numbers from that run. Facts (the numbers of the run) and sentences are kept separate.

The Tutor is a strip above the map, full width. Its first line is always the existing line of the ui spec (Task 12.1 there): before a run the "Wifi hall, 70 access points. Results are a simulation." label, after a run the "run is finished" line. The Tutor_Sentences come after that line. It depends on four additions to the Engine's progress events (Requirement 1), defined here and implemented as the first task of this spec. The Engine, its events, the Decision_Log and the Stats are defined in the engine spec, and the screens in the ui spec. They are not repeated here. All honesty rules of `.kiro/steering/honesty.md` apply.

Out of scope: any AI model, chat, free text questions, other languages, audio.

## Glossary

- **Tutor**: The strip above the map that shows the Tutor_Sentences.
- **Facts**: The numbers and identifiers of one run, taken from the Engine's result and progress events and from the Stats. The Facts contain no sentences.
- **Tutor_Sentence**: A fixed sentence template filled only with Facts.
- **Step**: One screen of the Tutor after a run, with 1 to 4 Tutor_Sentences. Steps are numbered as in Requirement 4.
- **Step_Ring**: A ring drawn on the map around the Points that a Step is about.
- **Hybrid_Plan**: The plan of the "atoms + rules (hybrid)" Competitor.
- **Selected_Plan**: The Competitor chosen in the ui spec's Plan_Selector.
- **Atoms_Pick**: A pick whose Decision_Log source is "atoms".
- **Rank**: The position of a Point among all Points left in the Round, over all Tiles, ordered by (-frequency, id), as sent in the pick event.
- **Top_Group**: The group of highest ranked Points from which the Engine picks one at random. The pick event gives its size.
- **Why_Answer**: The Tutor text that explains what happened to one Point in each Round.
- **Fits_Screen**: The finished screen shows the Tutor, the map and the Scoreboard in a 1366 x 768 viewport (inner size) without vertical scrolling.
- **Recorded_Run**: A run recorded from the native Engine by a script into the test data folder, with its Facts.
- **Engine**, **Point**, **Round**, **Tile**, **Competitor**, **Quantum_Share**, **Result_Label**, **Stats**, **Seed**, **Classical_Rules**: As defined in the engine and ui specs.

## Requirements

### Requirement 1: Engine prerequisite (events for the Tutor)

**User Story:** As a Tutor developer, I want the Engine to send the values the Tutor needs, so that no number is computed again from incomplete events.

This is the first task of this spec. Recomputing Rank from the current events was wrong for 3 of 15 picks, because a Point alone in its group has a frequency of 1.0 and no event.

#### Acceptance Criteria

1. WHEN a Point is picked, THE Engine SHALL include in the pick event the fields `remaining`, `top_group`, `rank` and `frequency`. `remaining` is the number of Points of the Round still undecided before that pick, and `top_group` is the size of the Top_Group (the same number as `StepInfo.top_group`).
2. WHEN a pick comes from the loop with source "atoms", THE Engine SHALL set `rank` and `frequency` to the Rank and the frequency of the picked Point.
3. WHEN the source of a pick is "annealing" or "coin flip", THE Engine SHALL set `remaining` and `top_group` to numbers and `rank` and `frequency` to null.
4. WHEN the source of a pick is "rule", THE Engine SHALL set `remaining` to a number and `top_group`, `rank` and `frequency` to null.
5. WHEN a pick comes from the Atoms_Alone Competitor (source "atoms", no ranking), THE Engine SHALL set `remaining`, `top_group`, `rank` and `frequency` to null.
6. WHEN the Engine sends a frequencies event, THE Engine SHALL include the field `shots`, the number of shots of that Simulator call.
7. FOR ALL generated inputs, THE Engine SHALL return the same picks, Decision_Log and Stats with progress events enabled as with progress events disabled (invariant property).
8. THE Engine spec SHALL be updated to list the new fields in Requirement 9.9.

### Requirement 2: Tutor placement and states

**User Story:** As a visitor, I want the explanation in one fixed place, so that I read it without the map moving.

#### Acceptance Criteria

1. THE Tutor SHALL be a strip above the map, with the full width of the page.
2. WHILE no run has started, THE Tutor SHALL show the "Wifi hall, 70 access points. Results are a simulation." label as its first line, followed by one or two Tutor_Sentences saying what the Points and lines are. The rule about close atoms and close sites is already in the tagline of the Map_Screen and SHALL NOT be repeated.
3. THE UI SHALL keep the texts "Results are a simulation" (label in `web/src/screens/map.ts`) and the Result_Label in the status of `web/src/screens/run.ts` as they are.
4. WHILE a run is in progress, THE UI SHALL show the run bar in the place of the Tutor.
5. WHEN a run finishes, THE Tutor SHALL show the "run is finished" line as its first line, followed by the Step sentences, keeping the focus rule of the ui spec for that line.
6. THE Tutor SHALL show one Step at a time, with a "back" button, a "next" button and the text "step N of M", where N is the position of the shown Step and M is the number of Steps shown for that run. A Step with no Tutor_Sentence left SHALL NOT be shown and SHALL NOT be counted in M. WHILE a Why_Answer is shown, THE Tutor SHALL show one button "back to step N" in place of "back" and "next", where N is the Step shown before it.
7. THE Tutor SHALL keep the same height for every Step of a run, so that the map does not move when the Step changes.
8. WHERE the screen is narrow, THE Tutor MAY grow in height.
9. THE UI SHALL satisfy Fits_Screen for a finished run. WHERE the viewport is smaller (about 650 px high), THE page MAY scroll, but the Tutor, the map and the four Scoreboard cards SHALL stay visible, and the legend MAY be below them.
10. WHILE a Step is shown, THE Map_Screen SHALL draw a Step_Ring around the Points that Step is about.
11. THE Tutor SHALL be operable by keyboard and SHALL give its buttons and its text a label for screen readers, as in Requirement 11 of the ui spec.
12. THE Tutor SHALL use only English text.

### Requirement 3: Plan shown

**User Story:** As a visitor, I want to know which plan the Tutor talks about, so that the words match the map.

#### Acceptance Criteria

1. WHILE the Selected_Plan is the Hybrid_Plan, THE Tutor SHALL show the Steps of Requirement 4. Until the Plan_Selector of the ui spec (task 10) exists, the Selected_Plan is always the Hybrid_Plan.
2. WHILE the Selected_Plan is not the Hybrid_Plan, THE Tutor SHALL show a sentence saying that the explanation covers the "atoms + rules (hybrid)" plan only, together with the first line of the finished run.

### Requirement 4: Steps after a run

**User Story:** As a visitor, I want the run explained one step at a time, so that I see where the atoms were used and where they were not.

Each Step has 1 to 4 short Tutor_Sentences. The Steps below are in order.

#### Acceptance Criteria

1. THE Tutor SHALL show Step 1 "rules first" with the number of picks made by Classical_Rules before the first group ran on the atoms, in any channel, the name of the first such pick, and the reason it is safe, written about the Points left at that moment: among the Points left at that moment, the Point has no neighbours, or it and its neighbours all clash with each other, so no other pick is lost by taking it. The sentence SHALL read correctly when the pick has 0 or 1 neighbours left.
2. IF that number is 0, THEN THE Tutor SHALL say in Step 1 that the rules found no safe pick, so the atoms went first.
3. THE Tutor SHALL show Step 2 "groups" and Step 3 "one group" about the first loop step that sent groups to the atoms. Step 2 SHALL give the channel, the number of Points left at that time, the number of groups of that loop step only, the smallest and the biggest group size, the number of tries per group, and the Result_Label. Step 3 SHALL be about the biggest of those groups (the first in event order when sizes are equal), with its two top Points and the number of its Points that never lit up.
4. IF all Points of that group clash with each other, THEN THE Tutor SHALL say in Step 3 that the atoms had no clear favourite.
5. THE Tutor SHALL show Step 4 "one pick" about the first Atoms_Pick, saying that the app does not take the top Point, that it ranks the Points that are left, keeps the Top_Group and picks one Point of the Top_Group at random, and giving the number of Points left, the size of the Top_Group, the Rank of the picked Point and how often it lit up (for example "34 of 100 tries").
6. THE Tutor SHALL describe the first Atoms_Pick without the wording "the atoms chose" or "the atoms decided".
7. THE Tutor SHALL show Step 5 "after it" with the number of safe picks that the first Atoms_Pick opened for the Classical_Rules.
8. IF the atoms ran but the Hybrid_Plan has no Atoms_Pick, THEN THE Tutor SHALL skip Steps 4 and 5.
9. THE Tutor SHALL show one Step 6 per Round with the number of Points to choose from, the number of picks, and how many picks were made by the rules, with help from the atoms, and classically.
10. THE Tutor SHALL show Step 7 "result" with the total picks, the Quantum_Share (including 0%, in the same format as the Scoreboard), the number of Points that are 5 GHz only, the number of splits and the number of skipped groups (including 0).
11. THE Tutor SHALL show Step 8 with the total picks of each of the four Competitors as plain numbers, the sentence "One run proves nothing.", no winner, and the word "tie" for Competitors with equal totals.
12. IF the Stats of the Hybrid_Plan have atoms_not_needed set, THEN THE Tutor SHALL say that the atoms weren't needed on this map and SHALL skip Steps 2 to 5.
13. WHERE the Mode is Place, THE Tutor SHALL show the same Steps with 1 Round and without channels.
14. IF a Fact needed by a Tutor_Sentence is missing, THEN THE Tutor SHALL leave that sentence out and SHALL NOT show an invented number.

### Requirement 5: Why this point

**User Story:** As a visitor, I want to ask about one Point, so that I see what happened to it.

#### Acceptance Criteria

1. WHEN the visitor clicks, taps or selects from the keyboard list a Point, THE Tutor SHALL show the Why_Answer for that Point in place of the Step.
2. THE Why_Answer SHALL give the number of Points that clash with the chosen Point.
3. THE Why_Answer SHALL give, for each Round, one of: "picked by a rule", "picked with help from the atoms", "picked classically, without atoms" (source annealing), "not possible, its neighbour <id> was picked", or "no channel was left, so it uses 5 GHz only". A Point that was picked has no answer for later Rounds.
4. WHERE the Mode is Place, THE Why_Answer SHALL use "picked ..." (by a rule, with help from the atoms, or classically) or "not picked, its neighbour <id> was picked", without channels.
5. FOR ALL Recorded_Runs of the Hybrid_Plan, every Point available in a Round SHALL end that Round picked or removed (test over the Recorded_Runs, not an Engine requirement).
6. WHEN the visitor leaves the Why_Answer, THE Tutor SHALL show the Step that was shown before it.

### Requirement 6: Honesty and test of sentences

**User Story:** As a maintainer, I want every sentence checked against the run, so that the Tutor never shows a number that is not from that run.

#### Acceptance Criteria

1. THE Tutor SHALL use only numbers that are Facts of the run shown, not counting Point identifiers.
2. THE Tutor SHALL show the Result_Label on every result.
3. THE Tutor SHALL contain none of the words "faster", "speed", "wins", "winner", "beats", "best", "the atoms chose" and "the atoms decided".
4. THE Tutor SHALL keep Facts and Tutor_Sentences in separate modules, so that the same Facts can later be given to a rephrasing service.
5. FOR ALL Tutor_Sentences of every Step and Why_Answer of every Recorded_Run, every number in the sentence SHALL be one of the Facts of that run (property).
6. THE repository SHALL contain Recorded_Runs for the Hero map with Seed 1, the sparse control hall with Seed 1, a small Channel_Plan map that the Classical_Rules solve alone and a small Place map that the Classical_Rules solve alone, recorded by a script from the native Engine into the test data folder.
7. THE tests SHALL check the banned words of criterion 3 on all Tutor_Sentences of all Recorded_Runs.
8. THE tests SHALL check that a missing Fact leaves out its sentence and shows no number in its place.
