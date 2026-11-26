// The shared map of Scenes 2 to 4 (experience spec): Map_Scene, Run_Scene and Results_Scene.
// One map element (canvases, accessible Point list) is made once and stays; the scenes only
// change what sits next to it: the side panel on the Map_Scene, the run bar and the Scoreboard
// on the Run_Scene, and the Tutor, the Scoreboard and the legend on the Results_Scene.
// It draws with the static, dynamic and a11y layers and sends the run request to the worker.
// It holds no MIS logic.

import { loadHero, loadPlace, loadWalls, type HeroFixture } from "../data/fixtures";
import { buildStraightEdges } from "../edges/straight";
import type { Wall } from "../edges/walls";
import { nearestPoint } from "../render/hit";
import { createA11y, type A11yLayer } from "../render/a11y";
import { DynamicLayer } from "../render/dynamic-layer";
import { StaticLayer, toScreenX, toScreenY, toWorldX, toWorldY, type StaticScene } from "../render/static-layer";
import {
  DEFAULT_SEED,
  MAX_TEXT_BYTES,
  PLACES,
  POINT_LIMIT,
  RANDOM_BATCH,
  YOUR_MAP_AREA_M,
  YOUR_R_DEFAULT,
  YOUR_R_MAX,
  YOUR_R_MIN,
  placeTitle,
  type PlaceName,
} from "../settings";
import { detectKind, parseMapText, tooLargeReason } from "../data/custom-map";
import {
  addRandom,
  clearMap,
  clickAt,
  parseR,
  randomFor,
  replaceMap,
  R_MESSAGE,
  startingRing,
  type EditResult,
  type EditorState,
} from "../your-map/editor";
import { yourMapLabel } from "../your-map/label";
import { state, subscribe, update } from "../state";
import { buildRequest, DEFAULT_PLACE, placeView, type MapChoice } from "./map-request";
import { buffer, doneCompetitors } from "../client";
import { parseSeed } from "../seed";
import { focusInside } from "../focus";
import { createRunView, type RunView } from "./run";
import { createScoreboard } from "./scoreboard";
import { renderLegend } from "./legend";
import { deriveFacts, type TutorEvent } from "../tutor/facts";
import { buildIdle } from "../tutor/sentences";
import { createStrip } from "../tutor/strip";
import { downloadCsv, downloadGeoJson, type ExportInput } from "../export";
import { CARD_LABELS, type EngineName } from "../scoreboard-model";
import { stageSentence } from "./loading";
import { getChips, mapEntry, setChips, setYourPointsSource } from "../scenes/maps";
import type { MapSlug } from "../scenes/router";

/** The scenes this map belongs to. */
export type FlowScene = "map" | "run" | "results";

export const HOW_TO_READ = [
  "A dot is a place you could pick.",
  "A line means the two are too close, so only one of the two can be picked.",
  "Run it and watch the atoms.",
] as const;

/** Shown while the simulator loads (experience spec, Requirement 23.3). Task 8 adds picking by hand. */
export const LOADING_HINT = "Look around while the simulator gets ready.";
export const READY_ANNOUNCEMENT = "The simulator is ready.";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Small line icons for the How_To_Read items, drawn in the palette (inline SVG). */
function howToIcon(kind: 0 | 1 | 2): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("how-icon");
  const add = (tag: string, attrs: Record<string, string>) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  if (kind === 0) {
    add("circle", { cx: "12", cy: "12", r: "4.5", fill: "#8f8cb8" });
  } else if (kind === 1) {
    add("line", { x1: "6", y1: "15", x2: "18", y2: "9", stroke: "#8f8cb8", "stroke-width": "1.5" });
    add("circle", { cx: "6", cy: "15", r: "3.2", fill: "#8f8cb8" });
    add("circle", { cx: "18", cy: "9", r: "3.2", fill: "none", stroke: "#8f8cb8", "stroke-width": "1.5" });
  } else {
    add("circle", { cx: "12", cy: "12", r: "3", fill: "#5dcaa5" });
    add("ellipse", { cx: "12", cy: "12", rx: "9", ry: "3.6", fill: "none", stroke: "#5dcaa5", "stroke-width": "1.2" });
    add("ellipse", { cx: "12", cy: "12", rx: "9", ry: "3.6", fill: "none", stroke: "#7f77dd", "stroke-width": "1.2", transform: "rotate(60 12 12)" });
  }
  return svg;
}

interface PlaceSelector {
  /** The picker (radios only), for the toolbar. */
  el: HTMLElement;
  /** Status, error and attribution lines, shown under the toolbar. */
  info: HTMLElement;
  select(name: PlaceName): Promise<void>;
}

function createPlaceSelector(): PlaceSelector {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "place-selector";
  const legend = document.createElement("legend");
  legend.textContent = "Place";
  fieldset.append(legend);
  const info = document.createElement("div");
  info.className = "place-info";

  const status = document.createElement("p");
  status.className = "muted place-status";
  status.setAttribute("role", "status");

  const error = document.createElement("p");
  error.className = "error place-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  // One place only: show its name as text, no selector. The fieldset legend stays as the label.
  const placeText = document.createElement("span");
  placeText.className = "place-option";
  placeText.textContent = PLACES[0].label;
  fieldset.append(placeText);
  // Attribution, cafe count and fetch date of the loaded place (Task 6.7).
  const attribution = document.createElement("p");
  attribution.className = "muted place-attribution";
  attribution.hidden = true;
  const copyright = document.createElement("span");
  const licenceLink = document.createElement("a");
  licenceLink.rel = "noopener noreferrer";
  licenceLink.target = "_blank";
  const countText = document.createElement("span");
  const dateText = document.createElement("span");
  attribution.append(copyright, " (", licenceLink, "). ", countText, ". ", dateText, ".");

  info.append(status, error, attribution);

  function renderAttribution(): void {
    const f = state.placeFixture;
    if (f === null) {
      attribution.hidden = true;
      return;
    }
    copyright.textContent = "© OpenStreetMap contributors";
    licenceLink.textContent = f.source.licence;
    licenceLink.href = /^https?:\/\//i.test(f.source.licence_url) ? f.source.licence_url : "";
    countText.textContent = `${f.counts.points} cafes`;
    dateText.textContent = `Fetched ${f.source.fetched_at}`;
    attribution.hidden = false;
  }

  function render(): void {
    renderAttribution();
    status.textContent = state.placeLoading ? "Loading the map…" : "";
    error.hidden = state.placeError === null;
    error.textContent = state.placeError ?? "";
  }

  async function select(name: PlaceName): Promise<void> {
    // Clear the previous result and show the loading state. Both places stay selectable.
    update({
      placeName: name,
      placeFixture: null,
      placeLoading: true,
      placeError: null,
      result: null,
    });
    render();
    try {
      const fixture = await loadPlace(name);
      if (state.placeName !== name) return; // a newer choice won
      update({ placeFixture: fixture, placeLoading: false });
    } catch (e) {
      if (state.placeName !== name) return;
      update({
        placeLoading: false,
        placeError: e instanceof Error ? e.message : String(e),
      });
    }
    render();
  }

  render();
  return { el: fieldset, info, select };
}

export interface MapScreenDeps {
  /** Send a run request to the worker. */
  start(payload: StartPayload): boolean | void;
  /** The Run_Screen finished with a result (state transition to the scoreboard). */
  onFinished(result: unknown): void;
  /** Drop the run in the worker: its messages are ignored (the back button during a run). */
  cancel?(): void;
  /** Called right before the scene changes, while the old parts are still on screen. */
  sceneWillChange?(from: FlowScene, to: FlowScene): void;
  /** Called right after the scene changed. */
  sceneDidChange?(to: FlowScene): void;
}

export interface MapScreen {
  el: HTMLElement;
  /** Run_Screen controller. main.ts forwards worker events to it. */
  run: RunView;
  /** Back to the map controls after a run (error or scoreboard back button). */
  showMap(): void;
  /** One Competitor finished (client `onCompetitorDone`). Fills in its card. */
  competitorDone(competitor: string): void;
  /** Show this map on the Map_Scene, with its chips from the Choose_Scene. No transition of its own. */
  select(slug: MapSlug): void;
  /** The map shown now. */
  readonly slug: MapSlug;
  /** The scene shown now. */
  readonly scene: FlowScene;
  /** The back button during a run: drop the run and show the Map_Scene. */
  stopRun(): void;
  /** The heading of the scene shown now (focus goes there when a scene opens). */
  heading(): HTMLElement;
  /** The parts of a scene that come in (and go out) when the scene changes. The map stays. */
  parts(scene: FlowScene): HTMLElement[];
  /** The map box, the target of the container transform. */
  readonly mapBox: HTMLElement;
  /** Lay the map out again (after it was put into the page). */
  relayout(): void;
}

type Mode = "channel_plan" | "place" | "your_map";

/** The Engine, the Scoreboard, the legend and the Tutor know two modes. Your map runs as Place. */
function engineModeOf(m: Mode): "channel_plan" | "place" {
  return m === "channel_plan" ? "channel_plan" : "place";
}

export const YOUR_MAP_HINT = "Click to add or remove points.";

function radioGroup(
  legendText: string,
  name: string,
  options: readonly { value: string; label: string }[],
  initial: string,
  onChange: (value: string) => void,
): { el: HTMLFieldSetElement; setValue(v: string): void } {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "place-selector";
  const legend = document.createElement("legend");
  legend.textContent = legendText;
  fieldset.append(legend);
  const inputs: HTMLInputElement[] = [];
  for (const o of options) {
    const label = document.createElement("label");
    label.className = "place-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = o.value;
    input.checked = o.value === initial;
    input.addEventListener("change", () => {
      if (input.checked) onChange(o.value);
    });
    inputs.push(input);
    label.append(input, " ", o.label);
    fieldset.append(label);
  }
  return {
    el: fieldset,
    setValue(v) {
      for (const i of inputs) i.checked = i.value === v;
    },
  };
}

export function createMapScreen(deps: MapScreenDeps): MapScreen {
  let running = false;
  const el = document.createElement("main");
  el.className = "screen map scene mapflow";
  /** The scene shown now. */
  let sceneNow: FlowScene = "map";
  let currentSlug: MapSlug = "hall";
  // The heading of the Run_Scene and the Results_Scene. The Map_Scene has its own, in the side panel.
  const flowHeading = document.createElement("h1");
  flowHeading.className = "visually-hidden";
  flowHeading.tabIndex = -1;

  // ---- controls ----
  let mode: Mode = "channel_plan";
  let wallsOn = false; // off by default: the first run matches the measured hero numbers
  let walking = true;
  let placeRequested = false;

  // The distance setting of the map. The same choice as the card's chips on the Choose_Scene.
  const wallsGroup = radioGroup(
    "Walls",
    "walls",
    [
      { value: "off", label: "Walls off" },
      { value: "on", label: "Walls on" },
    ],
    "off",
    (v) => {
      wallsOn = v === "on";
      setChips("hall", { walls: wallsOn });
      onMapOrToggleChanged();
    },
  );
  const distanceGroup = radioGroup(
    "Distance",
    "distance",
    [
      { value: "walking", label: "Walking" },
      { value: "straight", label: "Straight line" },
    ],
    "walking",
    (v) => {
      walking = v === "walking";
      setChips(currentSlug, { walking });
      onMapOrToggleChanged();
    },
  );
  const placeSelector = createPlaceSelector();

  // ---- Your map: editor controls (ui requirement 8) ----
  /** The points of Your map. Made the first time it is chosen, then kept. */
  let yourState: EditorState | null = null;
  /** Bumped on every edit, so the scene key changes and the map is redrawn. */
  let yourVersion = 0;
  /** The last valid r, used for the picture and the run. */
  let yourR = YOUR_R_DEFAULT;
  let yourRInvalid = false;
  let randomPresses = 0;
  /** Message for the corner of the map (an editor refusal or the r message). */
  let yourNote: string | null = null;

  const yourGroup = document.createElement("fieldset");
  yourGroup.className = "place-selector your-group";
  yourGroup.hidden = true;
  const yourLegend = document.createElement("legend");
  yourLegend.textContent = "Your map";
  const rLabel = document.createElement("label");
  rLabel.className = "seed-label";
  rLabel.textContent = "r (metres) ";
  const rInput = document.createElement("input");
  rInput.type = "number";
  rInput.min = String(YOUR_R_MIN);
  rInput.max = String(YOUR_R_MAX);
  rInput.step = "any";
  rInput.inputMode = "decimal";
  rInput.value = String(YOUR_R_DEFAULT);
  rLabel.append(rInput);
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  const randomButton = document.createElement("button");
  randomButton.type = "button";
  randomButton.textContent = "Add random points";
  yourGroup.append(yourLegend, rLabel, clearButton, randomButton);

  const seedLabel = document.createElement("label");
  seedLabel.className = "seed-label";
  seedLabel.textContent = "Seed ";
  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.inputMode = "numeric";
  seedInput.value = String(DEFAULT_SEED);
  seedLabel.append(seedInput);

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.textContent = "Run";

  const runHint = document.createElement("span");
  runHint.className = "muted run-hint";
  runHint.textContent = "Add at least one point to run.";
  runHint.hidden = true;

  // Loading in the background (experience spec, Requirement 23): the run button waits for the
  // simulator and shows how far it is. Everything else on the scene works meanwhile.
  const loadBox = document.createElement("div");
  loadBox.className = "run-loading";
  const loadBar = document.createElement("div");
  loadBar.className = "bar run-loading-bar";
  loadBar.setAttribute("role", "progressbar");
  loadBar.setAttribute("aria-label", "Simulator loading");
  loadBar.setAttribute("aria-valuemin", "0");
  loadBar.setAttribute("aria-valuemax", "100");
  const loadFill = document.createElement("div");
  loadFill.className = "bar-fill";
  loadBar.append(loadFill);
  const loadStageLine = document.createElement("p");
  loadStageLine.className = "muted run-loading-stage";
  const loadHint = document.createElement("p");
  loadHint.className = "run-loading-hint";
  loadHint.textContent = LOADING_HINT;
  const loadErrorLine = document.createElement("p");
  loadErrorLine.className = "error run-loading-error";
  loadErrorLine.setAttribute("role", "alert");
  loadErrorLine.hidden = true;
  loadBox.append(loadBar, loadStageLine, loadHint, loadErrorLine);
  let announcedReady = false;

  const message = document.createElement("p");
  message.className = "error";
  message.setAttribute("role", "alert");
  message.hidden = true;


  // ---- map area ----
  const wrap = document.createElement("div");
  wrap.className = "map-wrap";
  const staticCanvas = document.createElement("canvas");
  const dynamicCanvas = document.createElement("canvas");
  // Corner credit for the Kadikoy map, on screen whenever that map is (idle, run, finished). Not in the canvas.
  const osmCredit = document.createElement("span");
  osmCredit.className = "map-credit";
  osmCredit.textContent = "© OpenStreetMap contributors";
  osmCredit.hidden = true;
  // Your map: the hint (or the latest editor message) in the top left corner, so it adds no height.
  const mapHint = document.createElement("span");
  mapHint.className = "map-hint";
  mapHint.setAttribute("role", "status");
  mapHint.textContent = YOUR_MAP_HINT;
  mapHint.hidden = true;
  wrap.append(staticCanvas, dynamicCanvas, osmCredit, mapHint);
  const staticLayer = new StaticLayer(staticCanvas);
  const dynamicLayer = new DynamicLayer(dynamicCanvas);
  const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  dynamicLayer.setReducedMotion(reducedQuery?.matches ?? false);

  let indexById = new Map<string, number>();
  /** Screen positions (x,y pairs, CSS px, canvas space) of the Points, for the hit test. */
  let pointXY: number[] = [];
  const a11y: A11yLayer = createA11y(wrap, {
    onActivate: (id) => {
      // Why this point: only after a finished run (the strip ignores it for non-Hybrid plans).
      if (finishedShown) strip.showWhy(id);
    },
    onFocusChange: (id) => {
      dynamicLayer.setFocus(id === null ? -1 : (indexById.get(id) ?? -1));
      dynamicLayer.draw();
    },
  });

  // Tutor strip: its first line is the label (before a run) or the finished line (after a run).
  const strip = createStrip({
    onRing: (ids) => {
      currentRingIds = ids;
      applyRing();
      dynamicLayer.draw();
    },
  });
  /** Ids the strip wants ringed now. layout() re-applies them, because setPoints clears the ring. */
  let currentRingIds: string[] = [];
  function applyRing(): void {
    const idx: number[] = [];
    for (const id of currentRingIds) {
      const i = indexById.get(id);
      if (i !== undefined) idx.push(i);
    }
    dynamicLayer.setRing(idx);
  }
  let labelText = "";
  let finishedShown = false;
  /** The plan on the map after a finished run, and the result it is drawn from. */
  let selectedPlan: EngineName = "Hybrid";
  let finishedResult: unknown = null;

  // Why this point: click or tap on a Point after a finished run. A click on
  // no Point leaves the answer. leaveWhy does nothing when no answer is shown.
  dynamicCanvas.addEventListener("pointerdown", (e) => {
    // Your map, in the editor state: a click on a Point removes it, a click on an empty spot adds one.
    if (mode === "your_map" && editorOpen()) {
      if (yourState === null || scene === null) return;
      const box = dynamicCanvas.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      const hit = nearestPoint(pointXY, px, py, 12);
      const hitId = hit >= 0 ? (scene.points[hit]?.id ?? null) : null;
      const view = staticLayer.view;
      applyEdit(clickAt(yourState, toWorldX(view, px), toWorldY(view, py), hitId, POINT_LIMIT));
      return;
    }
    if (!finishedShown) return;
    const r = dynamicCanvas.getBoundingClientRect();
    const i = nearestPoint(pointXY, e.clientX - r.left, e.clientY - r.top, 12);
    if (i < 0) {
      strip.leaveWhy();
      return;
    }
    const id = scene?.points[i]?.id;
    if (id !== undefined) strip.showWhy(id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !el.isConnected || !finishedShown) return;
    strip.leaveWhy();
  });
  /** Request edges of the run on screen, for the Facts. */
  let runEdges: [string, string][] = [];

  // The Map_Scene shows no Tutor paragraph (experience spec, Requirement 3.3): the map's label
  // sits in the side panel, and the Tutor appears on the Results_Scene.
  function refreshIdle(): void {
    if (running || finishedShown) return;
    strip.hide();
    layout();
  }
  function setLabel(text: string): void {
    labelText = text;
    labelLine.textContent = text;
    refreshIdle();
  }

  // ---- side panel of the Map_Scene ----
  const side = document.createElement("aside");
  side.className = "map-side";
  side.setAttribute("aria-label", "Map settings and run");
  const sideTitle = document.createElement("h1");
  sideTitle.className = "map-side-title";
  sideTitle.tabIndex = -1;
  const labelLine = document.createElement("p");
  labelLine.className = "map-label";
  const chipRow = document.createElement("div");
  chipRow.className = "map-side-chips";
  chipRow.append(wallsGroup.el, distanceGroup.el, yourGroup);
  const howTo = document.createElement("ul");
  howTo.className = "how-to";
  howTo.setAttribute("aria-label", "How to read the map");
  HOW_TO_READ.forEach((text, i) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = text;
    li.append(howToIcon(i as 0 | 1 | 2), span);
    howTo.append(li);
  });
  const runRow = document.createElement("div");
  runRow.className = "run-row";
  runRow.append(seedLabel, runButton, runHint);
  side.append(sideTitle, labelLine, chipRow, placeSelector.info, howTo, runRow, loadBox);

  const noData = document.createElement("p");
  noData.className = "error no-data";
  noData.setAttribute("role", "status");
  noData.hidden = true;

  // Scoreboard panel next to the map. It opens when a run starts and fills in
  // card by card. Its seed input and run-again button work only after the run.
  const scoreboard = createScoreboard({
    onRunAgain: (seed) => startRun(seed),
    onBack: () => showMap(true),
    announce: (m) => a11y.announce(m),
    onSelectPlan: (plan) => showPlan(plan),
    onExport: (kind, plan) => exportPlan(kind, plan),
  });

  /** Download the plan selected now. Returns a plain message instead of throwing. */
  function exportPlan(kind: "csv" | "geojson", plan: EngineName): string | null {
    if (!finishedShown || finishedResult === null || scene === null) return "There is no finished run to export yet.";
    const input: ExportInput = {
      result: finishedResult,
      plan,
      mode: engineModeOf(mode),
      map: mode === "your_map" ? "your-map" : mode === "place" ? (state.placeName ?? DEFAULT_PLACE) : "hero",
      seed: runSeed,
      points: scene.points.map((p) => {
        const q = p as { id: string; x: number; y: number; lon?: number; lat?: number };
        return { id: q.id, x: q.x, y: q.y, lon: q.lon, lat: q.lat };
      }),
    };
    try {
      if (kind === "csv") downloadCsv(input);
      else downloadGeoJson(input);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "The export did not work.";
    }
  }
  const legendBox = document.createElement("div");
  legendBox.className = "map-legend-box";
  legendBox.hidden = true;
  const mapCol = document.createElement("div");
  mapCol.className = "map-col";
  // Under the map (room there at 1366x768): the one-run note, the citation and the run-again form.
  const under = document.createElement('div');
  under.className = 'map-under';
  for (const q of ['.score-note-one', '.score-cite', '.score-again']) {
    const node = scoreboard.el.querySelector(q);
    if (node) under.append(node);
  }
  mapCol.append(wrap, under);
  // The legend sits in the scoreboard column, under the cards.
  scoreboard.el.querySelector('.score-cards')?.after(legendBox);
  const mapRow = document.createElement("div");
  mapRow.className = "map-row";
  mapRow.append(mapCol, side, scoreboard.el);

  /** Seed and mode of the run on screen (for the scoreboard). */
  let runSeed = DEFAULT_SEED;
  /**
   * Hybrid card choice: its numbers show once Hybrid has finished AND the
   * playback has drained every Hybrid event, so the card never spoils the
   * animation. `hybridEnd` is the buffer length when Hybrid's competitor_done
   * arrived (all Hybrid events are before it).
   */
  let hybridEnd: number | null = null;

  /** Finished Competitors that may be shown now. */
  function visibleCompetitors(): Record<string, unknown> {
    const out: Record<string, unknown> = { ...doneCompetitors };
    const hybridShown = hybridEnd !== null && run.cursor >= hybridEnd;
    if (!hybridShown) delete out.Hybrid;
    return out;
  }

  function refreshScoreboard(): void {
    if (!scoreboard.el.hidden && running) scoreboard.update(visibleCompetitors());
  }

  const run = createRunView({
    buffer,
    reducedMotion: () => reducedQuery?.matches ?? false,
    onFinished: (result) => {
      deps.sceneWillChange?.(sceneNow, "results");
      running = false;
      const competitors = (result as { competitors?: Record<string, unknown> } | null)?.competitors ?? {};
      scoreboard.finish(competitors);
      selectedPlan = "Hybrid";
      finishedResult = result;
      legendBox.replaceChildren(renderLegend(engineModeOf(mode)));
      legendBox.hidden = false;
      finishedShown = true;
      updateYourUi();
      strip.showFinished(
        "The run is finished. These results are a simulation.",
        deriveFacts({
          mode: engineModeOf(mode),
          seed: runSeed,
          ids: scene?.points.map((p) => p.id) ?? [],
          edges: runEdges,
          events: buffer as unknown as TutorEvent[],
          result: { competitors, meta: (result as { meta?: Record<string, unknown> } | null)?.meta },
        }),
        "Hybrid",
        false, // the scene change moves the focus to the Results_Scene heading
      );
      sceneNow = "results";
      setFlowHeading();
      updateRunButton();
      layout(); // the run bar collapsed: use the room for the map; the final state is redrawn by resync()
      deps.onFinished(result);
      deps.sceneDidChange?.("results");
    },
    onProgress: () => refreshScoreboard(),
    onBack: () => showMap(true),
    onStopped: () => {
      // A run error: the Run_Scene stays, with the message and its back button.
      running = false;
      updateRunButton();
      scoreboard.hide();
    },
  });

  function setFlowHeading(): void {
    const title = mapEntry(currentSlug)?.title ?? "Map";
    flowHeading.textContent = sceneNow === "results" ? `Results: ${title}` : `Run: ${title}`;
    flowHeading.hidden = sceneNow === "map";
  }

  el.append(flowHeading, strip.el, message, noData, run.el, mapRow);

  /**
   * Back to the Map_Scene. `silent`: the map itself changes (select), and the stage animates the
   * whole switch, so no scene change of its own is reported.
   */
  function showMap(_fromBack = false, silent = false): void {
    const from = sceneNow;
    if (!silent && from !== "map") deps.sceneWillChange?.(from, "map");
    run.hide();
    running = false;
    finishedShown = false;
    finishedResult = null;
    selectedPlan = "Hybrid";
    scoreboard.hide();
    legendBox.hidden = true;
    side.hidden = false;
    sceneNow = "map";
    setFlowHeading();
    updateYourUi();
    update({ screen: "map" });
    refreshIdle();
    updateRunButton();
    layout();
    if (!silent && from !== "map") deps.sceneDidChange?.("map");
  }

  // ---- data and scene ----
  let hero: HeroFixture | null = null;
  let walls: Wall[] = [];
  let loadError: string | null = null;

  /** Same object until the map or a toggle changes. */
  let scene: StaticScene | null = null;
  let choice: MapChoice | null = null;
  let sceneKey = "";
  let lastW = 0;

  function showMessage(text: string | null): void {
    const changed = message.hidden !== (text === null);
    message.hidden = text === null;
    message.textContent = text ?? "";
    // The message row changes the room left for the map, so the page stays inside the viewport.
    if (changed) layout();
  }

  // ---- Your map: state, editing and the Map_Text ----
  function ensureYourState(): EditorState {
    // The first choice in a visit starts with a ring of 8 points, so Run works at once and the atoms are needed.
    // Clear leaves the map empty.
    if (yourState === null) yourState = startingRing();
    return yourState;
  }

  /** The drawing area joined with the bounding box of the points (a pasted map can be larger than the area). */
  function yourBounds(pts: readonly { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number } {
    const b: { minX: number; minY: number; maxX: number; maxY: number } = {
      minX: 0,
      minY: 0,
      maxX: YOUR_MAP_AREA_M.width,
      maxY: YOUR_MAP_AREA_M.height,
    };
    for (const p of pts) {
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxY = Math.max(b.maxY, p.y);
    }
    return b;
  }

  const yourKey = (): string => `your:${yourVersion}`;

  /** The editor takes clicks only when no run is shown. */
  function editorOpen(): boolean {
    return mode === "your_map" && !running && !finishedShown && !run.active;
  }

  /** One edit of the points: keep the new state, show its message, redraw. */
  function applyEdit(r: EditResult): void {
    if (r.state !== yourState) {
      yourState = r.state;
      yourVersion++;
    }
    yourNote = yourRInvalid ? R_MESSAGE : r.message;
    render();
  }

  function setTextStatus(text: string, isError: boolean): void {
    textStatus.textContent = text;
    textStatus.classList.toggle("is-error", isError);
  }

  /** Use the text of the box or a file. A bad text changes nothing but the message. */
  function applyMapText(text: string, fileName?: string): void {
    const parsed = parseMapText(text, detectKind(text, fileName), POINT_LIMIT);
    if (!parsed.ok) {
      setTextStatus(parsed.reason, true);
      return;
    }
    yourState = replaceMap(parsed.points);
    yourVersion++;
    yourNote = yourRInvalid ? R_MESSAGE : null;
    const n = parsed.points.length;
    setTextStatus(`Loaded ${n} ${n === 1 ? "point" : "points"}.`, false);
    render();
  }

  // The Map_Text panel sits in the column on the right of the map, where the Scoreboard opens during a run.
  // Folded by default so the Map_Scene fits one laptop screen; the summary is a keyboard control.
  const textPanel = document.createElement("details");
  textPanel.className = "maptext-panel";
  textPanel.hidden = true;
  const textTitle = document.createElement("summary");
  textTitle.textContent = "Points as text (CSV or GeoJSON)";
  const textArea = document.createElement("textarea");
  textArea.id = "maptext-box";
  textArea.rows = 4;
  textArea.spellcheck = false;
  textArea.placeholder = "id,x,y\na,10,20\nb,35.5,12";
  const textAreaLabel = document.createElement("label");
  textAreaLabel.htmlFor = textArea.id;
  textAreaLabel.textContent = "Paste points as CSV: id,x,y in metres";
  const fileLabel = document.createElement("label");
  fileLabel.className = "maptext-file";
  fileLabel.textContent = "or choose a CSV or GeoJSON file ";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.geojson,.json,text/csv,application/geo+json,application/json";
  fileLabel.append(fileInput);
  const useButton = document.createElement("button");
  useButton.type = "button";
  useButton.textContent = "Use these points";
  const textStatus = document.createElement("p");
  textStatus.className = "maptext-status";
  textStatus.setAttribute("role", "status");
  textPanel.append(textTitle, textAreaLabel, textArea, fileLabel, useButton, textStatus);
  // Your map: the Map_Text panel is part of the Map_Scene side panel.
  side.append(textPanel);

  useButton.addEventListener("click", () => applyMapText(textArea.value));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_TEXT_BYTES) {
      setTextStatus(tooLargeReason().replace("The text", "The file"), true);
      fileInput.value = "";
      return;
    }
    file.text().then(
      (text) => {
        textArea.value = text;
        applyMapText(text, file.name);
        fileInput.value = ""; // so the same file can be chosen again
      },
      () => {
        setTextStatus("The file could not be read.", true);
        fileInput.value = "";
      },
    );
  });

  clearButton.addEventListener("click", () => {
    if (yourState === null || !editorOpen()) return;
    applyEdit({ state: clearMap(yourState), message: null });
  });
  randomButton.addEventListener("click", () => {
    if (yourState === null || !editorOpen()) return;
    randomPresses++;
    applyEdit(addRandom(yourState, RANDOM_BATCH, randomFor(randomPresses), POINT_LIMIT));
  });
  rInput.addEventListener("input", () => {
    const r = parseR(rInput.value);
    if (r.ok) {
      yourR = r.value;
      yourRInvalid = false;
      yourNote = null;
      yourVersion++; // the edges change
      setChips("your-map", { r: yourR });
    } else {
      yourRInvalid = true;
      yourNote = r.error;
    }
    if (mode === "your_map") render();
  });

  /** Show or hide the parts that belong to Your map only. */
  function updateYourUi(): void {
    const yours = mode === "your_map";
    if (yours) ensureYourState();
    const open = editorOpen();
    yourGroup.hidden = !yours;
    for (const b of [clearButton, randomButton, rInput, useButton, fileInput, textArea]) b.disabled = !open;
    textPanel.hidden = !(yours && open);
    mapHint.hidden = !(yours && open);
    mapHint.textContent = yourNote ?? YOUR_MAP_HINT;
    mapHint.classList.toggle("is-error", yourNote !== null);
    runHint.hidden = !(yours && open && (yourState?.points.length ?? 0) === 0);
  }

  function rebuildScene(): void {
    scene = null;
    choice = null;
    sceneKey = "";
    if (mode === "your_map") {
      const pts = ensureYourState().points;
      choice = { mode, points: pts, r: yourR };
      // The request builds this same edge list, so what is drawn is what is sent.
      const edges = buildStraightEdges(pts, yourR);
      scene = {
        points: pts,
        edges,
        bounds: yourBounds(pts),
        edgesStrong: true,
        frame: { width: YOUR_MAP_AREA_M.width, height: YOUR_MAP_AREA_M.height },
      };
      sceneKey = yourKey();
      setLabel(yourMapLabel(pts.length));
    } else if (mode === "channel_plan") {
      if (hero === null) return;
      const edgesChoice: MapChoice = { mode, points: hero.points, walls, wallsOn, r: hero.graph.r };
      choice = edgesChoice;
      const edges = buildRequest(edgesChoice, 0).graph.edges ?? [];
      scene = { points: hero.points, edges, walls: wallsOn ? walls : [] };
      sceneKey = `channel:${wallsOn}`;
      setLabel(`Wifi hall, ${hero.points.length} access points. Results are a simulation.`);
    } else {
      const f = state.placeFixture;
      if (f === null) return;
      choice = { mode, points: f.points, walkingEdges: f.walking_edges, walking };
      const edges = walking ? f.walking_edges : buildStraightEdges(f.points, f.r);
      scene = { points: f.points, edges, streets: f.streets };
      sceneKey = `place:${f.name}:${walking}`;
      setLabel(`${placeTitle(f.name)}, ${f.points.length} cafes. Results are a simulation.`);
    }
  }

  /** Draw one Competitor of the finished result on the layer: rounds, 5 GHz only, uncovered points. No animation. */
  function paintPlan(plan: EngineName): void {
    const comp = (finishedResult as { competitors?: Record<string, any> } | null)?.competitors?.[plan];
    if (comp === undefined || comp === null || typeof comp !== "object" || "error" in comp) return;
    // Who made each pick (atoms: filled shape; anything else: outlined with a padlock).
    const source = new Map<string, string>();
    for (const e of Array.isArray(comp.decision_log) ? comp.decision_log : []) {
      if (e?.action !== "pick" || !Array.isArray(e.points)) continue;
      for (const id of e.points) source.set(String(id), String(e.source));
    }
    dynamicLayer.reset();
    dynamicLayer.setFinalView(true);
    const picked = new Set<number>();
    for (const r of Array.isArray(comp.rounds) ? comp.rounds : []) {
      const channel = typeof r?.channel === "number" ? r.channel : 1;
      for (const id of Array.isArray(r?.picks) ? r.picks : []) {
        const i = indexById.get(String(id));
        if (i === undefined) continue;
        picked.add(i);
        const src = source.get(String(id));
        if (src === "atoms") dynamicLayer.lock(i, channel, false, false);
        else dynamicLayer.lock(i, channel, true, false, src !== undefined && src !== "rule");
      }
    }
    for (let i = 0; i < (scene?.points.length ?? 0); i++) if (!picked.has(i)) dynamicLayer.setFiveGhzOnly(i);
    const gaps = Array.isArray(comp.stats?.gaps) ? comp.stats.gaps : [];
    dynamicLayer.setGaps(gaps.map((id: unknown) => indexById.get(String(id)) ?? -1));
    dynamicLayer.finishTweens();
    dynamicLayer.draw();
  }

  /** The visitor chose a plan on the scoreboard: redraw the map, no new run. */
  function showPlan(plan: EngineName): void {
    if (!finishedShown || plan === selectedPlan) return;
    selectedPlan = plan;
    if (plan === "Hybrid") {
      run.redrawFinal();
      dynamicLayer.draw();
    } else {
      paintPlan(plan);
    }
    legendBox.replaceChildren(renderLegend(engineModeOf(mode), plan === "Atoms_Alone"));
    strip.setPlan(plan); // the Tutor: Steps for Hybrid, one sentence otherwise
    a11y.announce(`The map shows the plan: ${CARD_LABELS[plan]}.`);
  }

  function layout(): void {
    if (scene === null) return;
    const width = Math.max(240, Math.round(wrap.clientWidth || 640));
    // Your map fits its bounds (the area and the points), so an empty map still has a size.
    const b = scene.bounds;
    const xs = scene.points.map((p) => p.x);
    const ys = scene.points.map((p) => p.y);
    const spanX = (b ? b.maxX - b.minX : Math.max(...xs) - Math.min(...xs)) || 1;
    const spanY = (b ? b.maxY - b.minY : Math.max(...ys) - Math.min(...ys)) || 1;
    // Keep the map and the toolbar on one laptop screen (about 1366x768).
    // Space below the map's top edge, minus a small bottom margin. Falls back to a fixed offset before the first paint.
    const top = wrap.hidden ? 0 : wrap.getBoundingClientRect().top;
    const maxH = Math.max(240, Math.min(640, top > 0 ? window.innerHeight - top - 40 - under.offsetHeight : window.innerHeight - 250));
    const height = Math.round(Math.min(maxH, Math.max(240, (width * spanY) / spanX)));
    wrap.style.height = `${height}px`;
    const dpr = window.devicePixelRatio || 1;
    const redrew = staticLayer.update(scene, width, height, dpr);
    if (redrew || width !== lastW) {
      lastW = width;
      dynamicLayer.resize(width, height, dpr);
      const view = staticLayer.view;
      const xy: number[] = [];
      const screen = scene.points.map((p) => {
        const sx = toScreenX(view, p.x);
        const sy = toScreenY(view, p.y);
        xy.push(sx, sy);
        return { id: p.id, x: sx, y: sy };
      });
      dynamicLayer.setPoints(xy);
      pointXY = xy;
      indexById = new Map(scene.points.map((p, i) => [p.id, i]));
      a11y.setPoints(screen);
      dynamicLayer.draw(true);
      run.resync(); // the final map survives a new size (finished panel opens)
      if (finishedShown && selectedPlan !== "Hybrid") paintPlan(selectedPlan); // resync drew the Hybrid map
      applyRing(); // setPoints and resync may have cleared the Tutor ring
      dynamicLayer.draw();
    }
  }

  function render(): void {
    wallsGroup.el.hidden = mode !== "channel_plan";
    distanceGroup.el.hidden = mode !== "place";
    placeSelector.info.hidden = mode !== "place";
    updateYourUi();

    // Place mode opens on Kadikoy. Nothing loaded and nothing loading: try once per visit.
    if (mode === "place" && state.placeFixture === null && !state.placeLoading && !placeRequested) {
      placeRequested = true;
      void placeSelector.select(state.placeName ?? DEFAULT_PLACE);
    }
    if (mode !== "place") placeRequested = false;

    let next: string | null = null;
    if (mode === "channel_plan") {
      next = loadError;
    } else {
      next = state.placeError;
    }
    // Place errors are shown by the selector itself.
    showMessage(mode === "channel_plan" ? next : null);

    const key =
      mode === "your_map"
        ? yourKey()
        : mode === "channel_plan"
          ? `channel:${wallsOn}`
          : `place:${state.placeFixture?.name}:${walking}`;
    const ready = mode === "your_map" ? true : mode === "channel_plan" ? hero !== null : state.placeFixture !== null;
    if (!ready) {
      scene = null;
      choice = null;
      sceneKey = "";
      setLabel(mode === "place" ? "" : "Loading the wifi hall…");
    } else if (scene === null || key !== sceneKey) {
      rebuildScene();
      a11y.setMapLabel(
        mode === "your_map"
          ? "Your map"
          : mode === "channel_plan"
            ? "Wifi hall"
            : state.placeFixture
              ? placeTitle(state.placeFixture.name)
              : "Place",
        scene?.points.length ?? 0,
        mode === "your_map" ? "your map" : mode === "channel_plan" ? "channel plan" : "place",
      );
      lastW = 0; // force the dynamic layer to take the new points
    }
    // Place mode: a map only for a valid place. Never the hall, never an empty canvas.
    if (mode === "place") {
      const view = placeView(state);
      noData.hidden = view.kind === "ready";
      noData.textContent = view.text;
      wrap.hidden = view.kind !== "ready";
      osmCredit.hidden = view.kind !== "ready";
    } else {
      osmCredit.hidden = true;
      noData.hidden = true;
      wrap.hidden = mode === "your_map" ? false : hero === null;
    }
    updateRunButton();
    layout();
  }

  /** The run button and the loading status next to it (experience spec, Requirement 23). */
  function updateRunButton(): void {
    const yourEmpty = mode === "your_map" && (yourState?.points.length ?? 0) === 0;
    const ready = state.ready;
    const failed = !ready && state.loadError !== null;
    runButton.disabled = !ready || choice === null || running || yourEmpty || (mode === "your_map" && yourRInvalid);
    const pct = Math.round(Math.min(100, Math.max(0, state.loadPercent)));
    runButton.textContent = ready
      ? "Run"
      : failed
        ? "The simulator could not load"
        : `Getting the simulator ready… ${pct}%`;
    loadBox.hidden = ready;
    loadBar.hidden = failed;
    loadFill.style.width = `${pct}%`;
    loadBar.setAttribute("aria-valuenow", String(pct));
    loadStageLine.hidden = failed;
    loadStageLine.textContent = stageSentence(state.loadStage);
    loadHint.hidden = failed;
    loadErrorLine.hidden = !failed;
    loadErrorLine.textContent = state.loadError ?? "";
    if (ready && !announcedReady) {
      announcedReady = true;
      a11y.announce(READY_ANNOUNCEMENT);
    }
  }

  function onMapOrToggleChanged(): void {
    render();
  }

  // Place selection (and its loading) updates the shared state, and so does the simulator loading.
  subscribe(() => {
    if (mode === "place") render();
    else updateRunButton();
  });

  // ---- run ----
  function startRun(seedValue: number): void {
    if (run.active || running) return;
    if (choice === null || scene === null || !state.ready) return;
    // Your map: three plain refusals, none of them starts a run.
    if (mode === "your_map") {
      const n = scene.points.length;
      const refusal =
        yourRInvalid
          ? `${R_MESSAGE} No run was started.`
          : n === 0
            ? "Add at least one point to run."
            : n > POINT_LIMIT
              ? `This map has ${n} points. The limit is ${POINT_LIMIT}, so nothing was run.`
              : null;
      if (refusal !== null) {
        showMessage(refusal);
        return;
      }
    }
    deps.sceneWillChange?.(sceneNow, "run");
    showMessage(null);
    const ids = scene.points.map((p) => p.id);
    dynamicLayer.setFocus(-1);
    side.hidden = true;
    running = true;
    sceneNow = "run";
    setFlowHeading();
    updateYourUi();
    runButton.disabled = true;
    runSeed = seedValue;
    seedInput.value = String(seedValue);
    hybridEnd = null;
    finishedShown = false;
    finishedResult = null;
    selectedPlan = "Hybrid";
    runEdges = scene.edges.map((e): [string, string] => [e[0], e[1]]);
    strip.hide();
    legendBox.hidden = true;
    update({ screen: "run", result: null });
    // The panel opens now, all cards "Computing…". Opening it narrows the map,
    // so lay the map out before the first event arrives.
    scoreboard.begin(runSeed, engineModeOf(mode));
    run.begin({ layer: dynamicLayer, ids, announce: (m) => a11y.announce(m) });
    layout(); // after the run bar is shown, so the map height accounts for it
    if (deps.start(buildRequest(choice, seedValue)) === true) run.setWaiting(true);
    deps.sceneDidChange?.("run");
  }

  // ---- the scenes ----
  setYourPointsSource(() => ensureYourState().points);

  function select(slug: MapSlug): void {
    const entry = mapEntry(slug);
    if (!entry) return;
    if (running) deps.cancel?.();
    currentSlug = slug;
    const c = getChips(slug);
    if (slug === "hall") {
      mode = "channel_plan";
      wallsOn = c.walls;
      wallsGroup.setValue(wallsOn ? "on" : "off");
    } else if (slug === "your-map") {
      mode = "your_map";
      if (c.r !== yourR) {
        yourR = c.r;
        yourRInvalid = false;
        yourNote = null;
        yourVersion++; // new edges
      }
      if (!yourRInvalid) rInput.value = String(yourR);
    } else {
      mode = "place";
      walking = c.walking;
      distanceGroup.setValue(walking ? "walking" : "straight");
    }
    sideTitle.textContent = entry.title;
    showMap(false, true);
    render();
  }

  function parts(s: FlowScene): HTMLElement[] {
    if (s === "map") return [sideTitle, labelLine, chipRow, placeSelector.info, howTo, runRow, loadBox, textPanel];
    if (s === "run") return [run.el, scoreboard.el];
    return [run.el, scoreboard.el, strip.el, under];
  }

  runButton.addEventListener("click", () => {
    if (run.active || running) return;
    const seed = parseSeed(seedInput.value);
    if (!seed.ok) {
      showMessage(`${seed.error} No run was started.`);
      seedInput.focus();
      return;
    }
    startRun(seed.value);
  });

  const ro = new ResizeObserver(() => {
    if (Math.round(wrap.clientWidth) !== lastW) layout();
  });
  ro.observe(wrap);
  // The map height depends on the window height, which the wrap observer does not see
  // (it only fires when the wrap itself changes size). Compare both inner sizes.
  let lastInnerW = window.innerWidth;
  let lastInnerH = window.innerHeight;
  window.addEventListener("resize", () => {
    if (!el.isConnected) return;
    if (window.innerWidth === lastInnerW && window.innerHeight === lastInnerH) return;
    lastInnerW = window.innerWidth;
    lastInnerH = window.innerHeight;
    layout();
  });
  reducedQuery?.addEventListener?.("change", (e) => dynamicLayer.setReducedMotion(e.matches));

  // ---- first load of the Hero_Map ----
  render();
  Promise.all([loadHero(), loadWalls()]).then(
    ([hf, wf]) => {
      hero = hf;
      walls = wf.walls;
      render();
    },
    (e: unknown) => {
      loadError = e instanceof Error ? e.message : String(e);
      render();
    },
  );

  return {
    el,
    run,
    showMap,
    competitorDone(competitor) {
      if (!running) return;
      if (competitor === "Hybrid") hybridEnd = buffer.length;
      refreshScoreboard();
    },
    select,
    get slug() {
      return currentSlug;
    },
    get scene() {
      return sceneNow;
    },
    stopRun() {
      if (sceneNow !== "run") return;
      if (running) deps.cancel?.();
      showMap(true);
    },
    heading: () => (sceneNow === "map" ? sideTitle : flowHeading),
    parts,
    mapBox: wrap,
    relayout() {
      lastW = 0;
      layout();
    },
  };
}
