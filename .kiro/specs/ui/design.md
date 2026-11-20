# Design Document

## Overview

The UI is a static Vite and TypeScript app in `web/`. It talks to the existing Worker (`worker/`), which runs the Engine (`atommap.api.run`) in Pyodide. The UI draws the map, plays back progress events, shows the Scoreboard and exports the plan. It holds no MIS algorithm. The only computation it owns is small map helpers: building conflict edges (walls model, straight line) for display and for the request.

Design decisions:
- **Canvas, in layers, not SVG.** The place maps have hundreds of Points plus thousands of street segments and edges. A static canvas layer is drawn once. A small dynamic canvas layer redraws only what animates. SVG would keep thousands of DOM nodes and restyle them during animation. Canvas needs an explicit accessibility layer (see Accessibility).
- **Events are buffered, then replayed.** The Worker's progress messages only append to an array. A `requestAnimationFrame` loop reads the array and applies the events due that frame.
- **Committed fixtures only.** Hero map, walls and the two place maps (Kadikoy, NYC Midtown) are static files. Nothing is fetched at runtime except these files and the Worker assets from the same origin.
- **Animation shows Hybrid only; the finished map shows the selected plan.** During a run only `Hybrid` events are drawn. After the result arrives, a Plan_Selector chooses which of the four Competitors' plans the map and the export read from the result (default Hybrid).

## Architecture

```mermaid
flowchart LR
    subgraph web[web/ main thread]
      APP[app state] --> SCR[screens]
      SCR --> MAP[render: static layer + dynamic layer + a11y list]
      APP --> PB[playback: event buffer + rAF]
      APP --> EB[edge builders]
      APP --> EXP[export]
    end
    FIX[fixtures/*.json] --> APP
    RES[web/public/results.json] --> APP
    APP <-->|start / progress / ready / result / error| W[worker/ TS]
    W -->|api.run request_json, emit| ENG[atommap.api]
```

Layout of `web/src/` (new files):

| Path | Purpose |
|---|---|
| `main.ts`, `state.ts` | Boot, screen switching (including the `#/results` hash route), one state object (map, mode, toggle, seed, run status, result) |
| `client.ts` | Wraps `new Worker`, typed with `worker/src/messages.ts` |
| `screens/loading.ts`, `map.ts`, `run.ts`, `scoreboard.ts`, 	utor.ts, esults.ts | One module per screen or panel (`results.ts` is the Results_Page) |
| `data/results.ts` | `loadResults()` and `validateResults()` for `results.json` (pure validator) |
| `render/static-layer.ts`, `dynamic-layer.ts`, `sprites.ts`, `a11y.ts` | Canvas drawing, glow sprites, accessible point list |
| `render/playback.ts` | Event buffer, rAF loop, pure reducer from events to point states |
| `edges/walls.ts`, `edges/straight.ts` | Edge builders owned by the UI |
| `data/fixtures.ts`, `data/custom-map.ts` | Fixture loading (including the per-place loader) and Custom_Map parsing |
| `scoreboard-model.ts`, `seed.ts`, `export.ts`, `settings.ts` | Pure functions: Scoreboard numbers, seed parsing, CSV/GeoJSON, default seed |

Build: Vite with relative `base: './'` for GitHub Pages. Fixtures are imported with `?url` from `../../fixtures/` (Vite `server.fs.allow` for the repo root) and copied to the build output.

## Components and Interfaces

### Worker message protocol (existing, `worker/src/messages.ts`)

| Direction | Message | Payload |
|---|---|---|
| UI to Worker | `start` | `{points:[{id,x,y}], mode, graph:{r, edges?}, seed}` |
| Worker to UI | `progress` (loading) | `{stage, percent, detail?}`, stage is `pyodide`, `engine`, `packages`, `boot` or `warmup` |
| Worker to UI | `ready` | `{elapsedMs, lean}` |
| Worker to UI | `progress` (run) | the Engine event dict, see below |
| Worker to UI | `result` | the parsed `result` object: `{meta, competitors}` |
| Worker to UI | `error` | `{type, message, dependency?, kind?, items?}` |

`mode` is `"channel_plan"` or `"place"`. The UI does not send `competitors`, so all four run. The UI maps `stage` to a plain sentence (Req. 1.2), and `ready` replaces the Loading_Screen (Req. 1.3). An `error` before `ready` is shown on the Loading_Screen (Req. 1.4). An `error` during a run shows the message on the Run_Screen with a back button.

### Engine events used by the UI

Existing (from `atommap.api`): `{type:"run", kind:"simulate", competitor, round, step, tile:[ids]}` and `{type:"run", kind:"pick", competitor, round, step, tile:null, picked:[id], source:"atoms"|"annealing"|"coin flip"|"rule"}`. `competitor` is one of `Atoms_Alone`, `Hybrid`, `Annealing_Rules`, `Coin_Flip_Rules`. `round` is the channel (1, 6, 11) in Channel_Plan and 1 in Place.

Added by the Engine prerequisite below: `kind:"frequencies"` with `{competitor, round, step, tile:[ids], frequencies:{id: number 0..1}}`, and `removed:[ids]` on every `pick`.

### Rendering (smooth on about 300 and 70 Points)

Three stacked elements in one container, all sized by CSS and scaled by `devicePixelRatio`:

1. **Static canvas.** Streets (Place), Walls (Channel_Plan) and conflict edges, drawn in one pass into a single batched path per style (one `stroke()` per style, not per segment). Redrawn only when the map, the distance toggle, the container size or the pixel ratio changes. Never redrawn per frame.
2. **Dynamic canvas.** Points, glow, lock-in pulse, fading neighbours, tile outlines and the focus ring. A point is drawn from a small per-point state held in typed arrays (`glow`, `lockT`, `fadeT`, `status`). Glow uses pre-rendered sprites (one offscreen canvas per glow level, 8 levels) drawn with `drawImage`. `shadowBlur` and per-frame gradients are not used. Channel shapes (circle, triangle, square, hollow circle) are cached `Path2D` objects.
3. **Accessibility layer.** See Accessibility.

Playback (`render/playback.ts`):
- `client.ts` pushes each `progress` run event onto `buffer[]` and returns. It does no drawing and does not touch state.
- The rAF loop starts when a run starts and stops when the buffer is drained, no tween is active and the result has arrived. At most one dynamic redraw happens per frame. The loop does not run while idle.
- Each frame, a pure reducer `apply(state, event)` consumes the events due this frame. Due count is set by the speed control (events per second, default and steps in `settings.ts`). Several events in one frame are applied in order and drawn once (coalescing).
- Only `competitor === "Hybrid"` events change the map. Events of the other three only update a plain-words status line ("Annealing + rules is running").
- `frequencies` sets the glow target of the Tile's Points (glow level = frequency). `pick` locks the Point (small pulse) and fades `removed`. A pick with source `rule` is drawn as an outlined lock with a "rule" tag. A pick with source `annealing` (a single-Point Tile, not atom-informed) is a plain lock with no glow. `simulate` draws the dashed stitch outline of its Tile until the next `frequencies` event.
- Skip sets the cursor to the end of the buffer, waits for `result`, and applies the final state without tweens. The end state equals the state after full playback (checked by a test).
- `prefers-reduced-motion: reduce`: no rAF tweening, no glow transitions, no fades. The Run_Screen shows static steps: one state per Round with a "next round" button and the same skip button. Colours and shapes change at once.
- After the result arrives, the Round colours come from the selected Competitor's `rounds` and `five_ghz_only` in the result, not from the event stream. Atoms alone also shows the Points it left uncovered (`stats.gaps`).

### Plan_Selector

`state.selectedPlan` is one of the four engine names, `Hybrid` at the start of each run. The selector is shown only after `result` arrives, as four buttons (radio group, keyboard operable, labelled like the Scoreboard cards). Changing it redraws the dynamic layer from `result.competitors[selectedPlan]` without a new run and without animation. A Competitor entry `{error}` has its button disabled with the reason as text. The selected plan name is shown above the map. Export reads the same selection.

All Engine work stays in the Worker (Req. 11.1). The main thread only appends events, runs the rAF loop and draws. Targets that follow from requirements: the Engine load and run times are those of the engine spec (Req. 11.8, not redefined here); the static layers are drawn once per change; the dynamic layer is drawn at most once per frame. No frame-rate figure is promised and nothing user-facing claims speed (honesty rule 1).

### Accessibility

- A visually hidden `<ul>` mirrors the Points, in id order, each item with text such as "ap12, picked on channel 6" and a state that updates after the run. It uses one roving `tabindex`: Tab enters the list once, arrow keys move to the nearest Point in that direction on screen, and the focused Point gets a focus ring on the dynamic canvas. Screen readers get the list, not hundreds of tab stops.
- One `aria-live="polite"` region announces Round and run state changes ("Round 2 of 3 done, 21 picks"), never per event.
- Every button, toggle and input has a visible label and focus ring (accent `#7f77dd`). The map container has an `aria-label` that states the map name, Point count and mode.
- Channel and state shapes come from `.kiro/steering/design.md` (1 circle, 6 triangle, 11 square, 5 GHz only hollow circle) and are drawn with colour and shape. Text and background colours follow the steering palette (AA).
- One column below a CSS width breakpoint. The Tutor_Panel is an empty `<aside aria-label="Tutor, coming later">` beside the Scoreboard (one column when narrow).

### Edge builders

`edges/walls.ts` (Channel_Plan, Hero_Map):

```ts
interface Wall { x1:number; y1:number; x2:number; y2:number; kind:"concrete"|"drywall" }
function buildWallEdges(points: Pt[], walls: Wall[], wallsOn: boolean): [string,string][]
```

For each pair with distance d, received power = `10 - 40 - 30*log10(d) - sum(loss of crossed walls)`, where concrete is 12 dB and drywall is 4 dB (both only when `wallsOn`). An edge exists when power >= -69 dBm. A wall is crossed when the straight segment between the two APs properly intersects the wall segment. Pairs are returned once, sorted by id. Constants live in `settings.ts` with the Radio_Model comment. The request carries `graph: {r: 20, edges}` where `r` is read from the fixture.

`edges/straight.ts` (Place, straight line): all pairs with distance below `r`, the same rule the Engine uses when edges are omitted. The UI needs these only to draw them. The request sends `graph:{r:150}` without `edges`.

### Place: walking edges

Walking edges come from the Street_Fixture of the selected place (see Place data). The request sends `graph:{r:150, edges: fixture.walking_edges}`.

### Scoreboard model

`scoreboard-model.ts` turns `result.competitors` into four cards, keyed by engine names and labelled "atoms alone", "atoms + rules (hybrid)", "annealing + rules", "coin flip + rules". Per card, from `CompetitorResult`:
- picks per Round: `rounds[i].picks.length` (channel `rounds[i].channel`); total: `stats.total_picks`.
- Quantum_Share: `stats.quantum_picks` of `stats.total_picks` and `stats.quantum_share` as a percent, always shown, including 0%.
- `stats.atoms_not_needed` true shows "atoms weren't needed on this map".
- `stats.splits`, `stats.skipped_tiles`, `stats.mismatches` always shown, including 0. `stats.gaps` count is shown for atoms alone.
- label from `label` ("simulation").
- A competitor entry `{error}` shows the error text in plain words, no numbers.
- Ties: competitors with equal `total_picks` get the word "tie". No card is styled as winner. Cards use one shared component.
- The seed, the note "One run proves nothing." and the citation text are on the Scoreboard.

### Seed

`seed.ts` parses the typed text: trimmed, matches `^-?\d+$` and is a safe integer. Otherwise the UI shows a plain message and does not call the Worker. "Run again with another seed" uses previous seed + 1. The default seed is a constant in `settings.ts`, decided before running (honesty rule 8).

### Export

`export.ts`, for the plan selected in the Plan_Selector. CSV header: `id,x,y,round,result_label,seed`; `round` is the channel, `5 GHz only` in Channel_Plan for unpicked Points, and `1` or `not picked` in Place. Fields with commas, quotes or newlines are quoted. GeoJSON: a FeatureCollection with top-level `result_label` and `seed`, one Point feature per Point with `id`, `x`, `y`, `round`, `result_label`, `seed` properties. Geometry is `[lon, lat]` for the place maps and `[x, y]` in local metres for other maps (stated in a top-level `units` member). Files are made with `Blob` and an `<a download>`.

### Custom map (optional, lowest priority)

`data/custom-map.ts` parses CSV (`id,x,y` in metres) and GeoJSON Point features (projected to local metres with the same equirectangular projection as `fetch_place.py`). The visitor sets `r`; the request is `graph:{r}` with no edges. A read error shows the reason and keeps the current map.

## Data Models

```ts
interface Pt { id: string; x: number; y: number }          // metres

interface HeroFixture { name; points: Pt[]; graph: { r: number } }   // fixtures/wifi_hall_hero.json (existing)
interface WallsFixture { walls: Wall[] }                              // fixtures/wifi_hall_walls.json (new)

interface PlaceFixture {                                              // fixtures/place_<name>.json (new, one per place)
  name: string;                                    // "kadikoy" or "midtown", also the file suffix
  mode: "place"; r: 150;
  bbox: { south: number; west: number; north: number; east: number };
  origin: { lat: number; lon: number };            // local metres: x east, y north of origin
  points: { id: string; x: number; y: number; lat: number; lon: number; name?: string }[];
  streets: [number, number][][];                   // polylines in local metres, for drawing
  walking_edges: [string, string][];               // sorted pairs, each once
  source: { attribution: "© OpenStreetMap contributors";
            licence: "ODbL 1.0"; licence_url: string;
            overpass_endpoint: string; query: string;
            osm_data_timestamp: string;            // Overpass osm3s timestamp_osm_base
            fetched_at: string;                    // ISO date of the script run
            script: "scripts/fetch_place.py"; script_args: string[] };
  counts: { points: number;                        // real cafe count, at least 20
            street_polylines: number; walking_edges: number;
            max_snap_m: number };
}

interface ResultsFile {                                               // web/public/results.json (new)
  example: boolean;
  protocol: { text: string; settings: Record<string, unknown> };
  runs: RunRecord[];
}
interface RunRecord {
  seed: number; map: string;
  picks: Record<EngineName, number>;               // per Competitor
  quantum_share: Record<EngineName, number>;       // per Competitor, percent, 0 allowed
  atoms_not_needed: boolean; splits: number; skipped_tiles: number;
  status: "ok" | "failed" | "bad"; reason?: string;
}
The existing hero fixture has no walls, so a new `fixtures/wifi_hall_walls.json` holds them. The Engine tests keep using `wifi_hall_hero.json` unchanged.

## Place data

**Where the script lives.** `scripts/fetch_place.py`. `scripts/` holds build time scripts run by hand (`structure.md`).

**Who runs it.** The user runs it by hand, once per place. The app, the tests and CI never call Overpass (Req. 6.6). Both fixtures are committed.

```
python scripts/fetch_place.py kadikoy 40.982,29.020,40.996,29.040
python scripts/fetch_place.py midtown 40.750,-73.995,40.762,-73.975
```

**Arguments.** `name` (lowercase letters, digits, underscore) and `bbox` as `south,west,north,east`. Optional `--out` (default `fixtures/place_<name>.json`, consistent with `wifi_hall_*.json`). `parse_args` checks that the bbox has four numbers, south < north, west < east, latitude within ±90 and longitude within ±180, and exits with a plain message otherwise, before any network call. Other constants in the script: the Overpass endpoint, the cafe filter (`amenity=cafe`), the walkable `highway` filter (everything except `motorway`, `motorway_link`, and ways with `foot=no` or `access=private`), the walking limit 150 m and the minimum count 20 (it only catches a broken or empty download and is not a quality bar; Midtown had about 150 cafes in tests). Standard library only (`urllib`, `json`, `heapq`, `math`, `argparse`), so there is nothing to pin or fetch.

**Steps.**
1. One Overpass request, limited to the bbox, returns cafes (`nwr`, `out center`) and walkable ways with their nodes. The exact query text and the response's `timestamp_osm_base` are stored in `source`.
2. Project lat/lon to local metres with an equirectangular projection around the cafe centroid (`origin`). Metres are rounded to 0.1.
3. Assign ids `cafe000`... in a stable order (sorted by OSM type and id). Keep the cafe name when present.
4. Build the street graph: nodes are OSM nodes, edges are consecutive way nodes weighted by length in metres. Polylines (one per way, rounded) are kept for drawing.
5. Snap each cafe to the nearest point on the nearest street segment. The snap point becomes a virtual node splitting that segment; several snap points on one segment are chained in order along it, so cafes on the same segment connect directly. The snap offset (cafe to snap point) is recorded and the maximum is stored as `max_snap_m`.
6. For each cafe, run Dijkstra from its snap node bounded at `150 - offset`. Cafes `i` and `j` get an edge when `offset_i + path(snap_i, snap_j) + offset_j <= 150`. Edges are stored as sorted id pairs, each once.
7. If the cafe count is below 20, the script prints the place name and the count and exits with an error without writing that place's file. Any count of 20 or more is accepted and stored as the real count. The two places are independent: a failure for one does not touch the other file.
8. Write compact JSON (no indentation) with `bbox`, `source`, `counts` (including the real cafe count) and the fetch date.

**Walking vs straight line.** Walking distance is never shorter than the straight line, so every walking edge is also a pair within 150 m straight. That is checked on each committed file.

**No sample fixture.** The design uses none. Tests that read a committed place file run once the user has produced it. Until then they are skipped with a message naming the missing file, not replaced by invented data (honesty rule 8). Script logic is tested with tiny hand-made inputs (see Testing Strategy).

**Preset selector and loader.** Place mode shows a preset selector with the two places, labelled "Kadikoy" and "NYC Midtown" (labels and file names in a `PLACES` constant in `settings.ts`). `data/fixtures.ts` has `loadPlace(name)`: it fetches `place_<name>.json` from the same origin the first time that place is selected, validates the shape, and caches it per place. Switching places shows the cached or newly loaded map and clears the previous result. If the file is missing or malformed, the Map_Screen shows a message naming the file and the other place stays usable. Points, `streets` and `walking_edges` feed the static layer and the request.

**Attribution and counts.** For the selected place, the map screen shows "© OpenStreetMap contributors" with the ODbL link (`licence_url`), the real cafe count (`counts.points`) and the fetch date (`source.fetched_at`), all read from that file.

## Results page

**Route.** A hash route: `#/results`. `main.ts` reads `location.hash` at boot and on `hashchange` and shows either the map flow or the Results_Page. A hash route needs no server rewrite, so it works on GitHub Pages and with `base: './'`. The Map_Screen has a plain link `<a href="#/results">What we measured</a>` (Req. 13.1), and the Results_Page has a link back to `#/`. The page is static and does not wait for the Worker to be ready.

**Where the file lives.** `web/public/results.json`. Vite copies `public/` to the build root, so the page fetches `./results.json` at runtime, which works under any GitHub Pages path. `fixtures/` holds map data (`structure.md`), and the results file is page data that a later script will overwrite, so it does not go there. This is the least surprising place and needs no `server.fs.allow` change. The committed example has `example: true`, a few runs and one with `status: "failed"` and a `reason`.

**Loader and validator.** `loadResults()` fetches the file (the only request the page makes, Req. 13.2). `validateResults(json): {ok:true, value} | {ok:false, reason}` is a pure function that checks the shape of `ResultsFile`: types of all fields, `status` in `ok|failed|bad`, `picks` and `quantum_share` holding the four Competitor names with numbers, counts as non-negative integers. It returns the first problem as a plain sentence naming the field, such as "run 3: status must be ok, failed or bad".

**Rendering.** `screens/results.ts` renders in this order: example notice (only when `example` is true, "This is example data, not a measurement."), protocol text and settings, one `<table>` with a `<caption>` and `<th scope="col">` headers, then the citation. One row per Run_Record, in file order, with seed, map, picks per Competitor, Quantum_Share per Competitor (0% shown as 0%), `atoms_not_needed`, splits, skipped Tiles and status (with reason when present). Failed and bad rows use the same row component and styling as ok rows. There is no sorting, filtering, totals, averages or ranking. Each row carries the label "simulation". Text is inserted with `textContent`, not `innerHTML`.

**Error state.** If the fetch fails, the JSON is invalid or `validateResults` fails, the page shows the reason in plain words and no table (Req. 13.14).
## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Only the pure edge builder, the export serializer and the Engine's progress switch have universal properties. Rendering, animation, loading and layout are covered by example and smoke tests.

### Property 1: Turning walls on never adds an edge

*For any* set of APs and any set of walls, every edge built with walls on is also an edge built with walls off.

**Validates: Requirements 5.3, 5.4, 5.5**

### Property 2: CSV export round trip

*For any* list of Points with ids (including commas, quotes and newlines), coordinates and rounds, parsing the exported CSV gives the same rows, and every row carries the result label "simulation" and the seed.

**Validates: Requirements 7.1, 7.3**

### Property 3: Progress events do not change the result

*For any* valid request and Seed, the JSON text returned by `api.run` with `emit=None` equals the text returned with an `emit` that collects events.

**Validates: Requirements 10.4**

## Error Handling

| Case | Behaviour |
|---|---|
| Loading `error` | Plain-words message on the Loading_Screen (1.4) |
| Run `error` (Worker or Engine, including `items`) | Message on the Run_Screen, back to the Map_Screen, no partial Scoreboard |
| A Competitor entry `{error}` | Its card shows the error, the other cards show their numbers |
| Typed seed not an integer | Message, no run (4.13) |
| Fixture fails to load or has the wrong shape | Message naming the file, that map not shown, the other place still usable |
| `results.json` missing, invalid JSON or wrong shape | Plain-words reason on the Results_Page, no table, no partial rows |
| Custom map unreadable | Reason shown, current map kept (8.3) |
| Worker `ready` never arrives | Loading_Screen stays on the last stage; the time targets are the engine spec's |

## Testing Strategy

Property-based testing applies to the edge builder, the CSV serializer and the Engine emit switch. It does not apply to rendering, animation, layout, the results validator and render, or the `fetch_place.py` args handling, which use example, snapshot and smoke tests.

**Property tests** (at least 100 iterations each; comment `Feature: ui, Property N: <title>`):
- Properties 1 and 2: `vitest` with `fast-check` in `web/`, one test per property.
- Property 3: `hypothesis` in `engine/tests/`, with the fake Simulator and `OPENBLAS_NUM_THREADS=1`, one test.
- Versions of `vitest`, `fast-check`, `playwright` and `vite` are pinned (tech rule).

**Unit tests** (`vitest`, Req. 12.1, 12.2):
- Wall edge builder: concrete and drywall losses, a pair at the 19.95 m boundary, walls on and off. The gap between about 19.95 m and the Hero_Map_R of 20 m is allowed.
- Straight-line builder and each committed place fixture (`place_kadikoy.json`, `place_midtown.json`; skipped with a message naming the file until the user has produced them): at least 20 points, `counts.points` equals the number of points, `fetched_at` present, edge ids exist, each edge is within 150 m straight, `source` metadata present, `streets` non-empty.
- Walking edge logic: the Python function in `scripts/fetch_place.py` is tested with a tiny hand-made street graph (`scripts/test_fetch_place.py`, no network).
- `fetch_place.py` args and bbox handling, offline: a valid name and bbox parse; a wrong count of numbers, south >= north, west >= east, out-of-range values and a bad name exit with an error before any request; the under-20 abort writes no file (fetch function replaced by a stub).
- Results: `validateResults` accepts the committed `web/public/results.json` and rejects wrong types, a bad `status` and missing fields with a reason; the render function gives rows in file order, shows the example notice only when `example` is true, renders failed rows with the same markup as ok rows, shows 0% shares, and has no banned words; the error state shows a reason and no table.
- Scoreboard model: four cards, zero counts shown, `atoms_not_needed` text, ties, error entry, no banned words ("faster", "speed", "wins", "winner", "beats") in the rendered text.
- Seed parsing, Plan_Selector (each of the four plans is drawn from the result, export follows the selection), export (GeoJSON shape), custom map parser errors, playback reducer (skip end state equals full playback end state).

**Smoke:** a Playwright test loads the page, waits for the Map_Screen, runs the Hero_Map, presses skip, and checks four Competitor cards. It also records requests and asserts none go to a tile server or Overpass (2.8, 6.6).

## Engine prerequisite

The first task of the UI task list will update the Engine spec (this spec does not edit it now):
- Engine requirement 9.9 names three event kinds: a `frequencies` event after each Simulator call with the Tile ids and the frequency of each Point; `removed` neighbour ids on every `pick` event; and `pick` events for Classical_Rule picks with source `"rule"`.
- Engine requirement 10.3 names the Stats flag `atoms_not_needed`.
- The Engine spec states that the emit switch already exists as `api.run(request_json, emit=None)`.
- Results are identical with and without `emit` (Property 3).

The task also adds the `frequencies` event and `removed` ids to the Engine code, with tests.
