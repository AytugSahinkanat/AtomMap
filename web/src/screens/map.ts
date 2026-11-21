// Map_Screen: Hero_Map in Channel_Plan, a place map in Place, the toggle, the seed and the run button.
// It draws with the static, dynamic and a11y layers and sends the run request to the worker.
// It holds no MIS logic.

import { loadHero, loadPlace, loadWalls, type HeroFixture } from "../data/fixtures";
import { buildStraightEdges } from "../edges/straight";
import type { Wall } from "../edges/walls";
import { createA11y, type A11yLayer } from "../render/a11y";
import { DynamicLayer } from "../render/dynamic-layer";
import { StaticLayer, toScreenX, toScreenY, type StaticScene } from "../render/static-layer";
import { DEFAULT_SEED, PLACES, type PlaceName } from "../settings";
import { state, subscribe, update } from "../state";
import { buildRequest, DEFAULT_PLACE, parseSeed, placeView, type MapChoice } from "./map-request";

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

  const inputs = new Map<PlaceName, HTMLInputElement>();
  for (const place of PLACES) {
    const label = document.createElement("label");
    label.className = "place-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "place";
    input.value = place.name;
    input.addEventListener("change", () => void select(place.name));
    inputs.set(place.name, input);
    label.append(input, " ", place.label);
    fieldset.append(label);
  }
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
    for (const [name, input] of inputs) input.checked = state.placeName === name;
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
  start(payload: StartPayload): void;
}

type Mode = "channel_plan" | "place";

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

export function createMapScreen(deps: MapScreenDeps): HTMLElement {
  const el = document.createElement("main");
  el.className = "screen map";
  const h = document.createElement("h1");
  h.textContent = "AtomMap";

  // ---- controls ----
  let mode: Mode = "channel_plan";
  let wallsOn = false; // off by default: the first run matches the measured hero numbers
  let walking = true;
  let placeRequested = false;

  const modeGroup = radioGroup(
    "Mode",
    "mode",
    [
      { value: "channel_plan", label: "Channel plan (3 rounds)" },
      { value: "place", label: "Place (1 round)" },
    ],
    mode,
    (v) => {
      mode = v as Mode;
      onMapOrToggleChanged();
    },
  );
  const wallsGroup = radioGroup(
    "Walls",
    "walls",
    [
      { value: "on", label: "Walls on" },
      { value: "off", label: "Walls off" },
    ],
    "off",
    (v) => {
      wallsOn = v === "on";
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
      onMapOrToggleChanged();
    },
  );
  const placeSelector = createPlaceSelector();

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

  const message = document.createElement("p");
  message.className = "error";
  message.setAttribute("role", "alert");
  message.hidden = true;

  const label = document.createElement("p");
  label.className = "muted";

  // ---- map area ----
  const wrap = document.createElement("div");
  wrap.className = "map-wrap";
  const staticCanvas = document.createElement("canvas");
  const dynamicCanvas = document.createElement("canvas");
  wrap.append(staticCanvas, dynamicCanvas);
  const staticLayer = new StaticLayer(staticCanvas);
  const dynamicLayer = new DynamicLayer(dynamicCanvas);
  const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  dynamicLayer.setReducedMotion(reducedQuery?.matches ?? false);

  let indexById = new Map<string, number>();
  const a11y: A11yLayer = createA11y(wrap, {
    onFocusChange: (id) => {
      dynamicLayer.setFocus(id === null ? -1 : (indexById.get(id) ?? -1));
      dynamicLayer.draw();
    },
  });

  const tagline = document.createElement("p");
  tagline.className = "muted tagline";
  tagline.textContent = "two close atoms can't both light up, two close sites can't both be picked";

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.append(modeGroup.el, wallsGroup.el, distanceGroup.el, placeSelector.el, seedLabel, runButton);

  const noData = document.createElement("p");
  noData.className = "error no-data";
  noData.setAttribute("role", "status");
  noData.hidden = true;

  el.append(h, tagline, toolbar, placeSelector.info, label, message, noData, wrap);

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
    message.hidden = text === null;
    message.textContent = text ?? "";
  }

  function rebuildScene(): void {
    scene = null;
    choice = null;
    sceneKey = "";
    if (mode === "channel_plan") {
      if (hero === null) return;
      const edgesChoice: MapChoice = { mode, points: hero.points, walls, wallsOn, r: hero.graph.r };
      choice = edgesChoice;
      const edges = buildRequest(edgesChoice, 0).graph.edges ?? [];
      scene = { points: hero.points, edges, walls: wallsOn ? walls : [] };
      sceneKey = `channel:${wallsOn}`;
      label.textContent = `Wifi hall, ${hero.points.length} access points. Results are a simulation.`;
    } else {
      const f = state.placeFixture;
      if (f === null) return;
      choice = { mode, points: f.points, walkingEdges: f.walking_edges, walking };
      const edges = walking ? f.walking_edges : buildStraightEdges(f.points, f.r);
      scene = { points: f.points, edges, streets: f.streets };
      sceneKey = `place:${f.name}:${walking}`;
      label.textContent = `${f.name}, ${f.points.length} cafes. Results are a simulation.`;
    }
  }

  function layout(): void {
    if (scene === null) return;
    const width = Math.max(240, Math.round(wrap.clientWidth || 640));
    const xs = scene.points.map((p) => p.x);
    const ys = scene.points.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs) || 1;
    const spanY = Math.max(...ys) - Math.min(...ys) || 1;
    // Keep the map and the toolbar on one laptop screen (about 1366x768).
    const maxH = Math.max(240, Math.min(640, window.innerHeight - 250));
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
      indexById = new Map(scene.points.map((p, i) => [p.id, i]));
      a11y.setPoints(screen);
      dynamicLayer.draw(true);
    }
  }

  function render(): void {
    modeGroup.setValue(mode);
    wallsGroup.el.hidden = mode !== "channel_plan";
    distanceGroup.el.hidden = mode !== "place";
    placeSelector.el.hidden = mode !== "place";
    placeSelector.info.hidden = mode !== "place";

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

    const key = mode === "channel_plan" ? `channel:${wallsOn}` : `place:${state.placeFixture?.name}:${walking}`;
    const ready = mode === "channel_plan" ? hero !== null : state.placeFixture !== null;
    if (!ready) {
      scene = null;
      choice = null;
      sceneKey = "";
      label.textContent = mode === "place" ? "" : "Loading the wifi hall…";
    } else if (scene === null || key !== sceneKey) {
      rebuildScene();
      a11y.setMapLabel(
        mode === "channel_plan" ? "Wifi hall" : (state.placeFixture?.name ?? "Place"),
        scene?.points.length ?? 0,
        mode === "channel_plan" ? "channel plan" : "place",
      );
      lastW = 0; // force the dynamic layer to take the new points
    }
    // Place mode: a map only for a valid place. Never the hall, never an empty canvas.
    if (mode === "place") {
      const view = placeView(state);
      noData.hidden = view.kind === "ready";
      noData.textContent = view.text;
      wrap.hidden = view.kind !== "ready";
    } else {
      noData.hidden = true;
      wrap.hidden = hero === null;
    }
    runButton.disabled = choice === null;
    layout();
  }

  function onMapOrToggleChanged(): void {
    render();
  }

  // Place selection (and its loading) updates the shared state.
  subscribe(() => {
    if (mode === "place") render();
  });

  // ---- run ----
  runButton.addEventListener("click", () => {
    const seed = parseSeed(seedInput.value);
    if (seed === null) {
      showMessage("The seed must be a whole number, such as 1 or -7. No run was started.");
      seedInput.focus();
      return;
    }
    if (choice === null) return;
    showMessage(null);
    a11y.announce(`Run started with seed ${seed}.`);
    deps.start(buildRequest(choice, seed));
  });

  const ro = new ResizeObserver(() => {
    if (Math.round(wrap.clientWidth) !== lastW) layout();
  });
  ro.observe(wrap);
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

  return el;
}
