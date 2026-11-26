// Boot and routing (experience spec, Requirements 1, 4 and 23).
//
// The Choose_Scene shows at once and the simulator loads in the background: the cards need
// only the map files, not the worker. The run button waits for the worker (state.ready).
// `#/results` (What we measured) keeps working without the worker and never starts it.

import "./style.css";
import { buffer, createClient, doneCompetitors, type WorkerClient } from "./client";
import { applyLoadProgress, onFinished, state, update } from "./state";
import { plainError } from "./screens/loading";
import { createMapScreen, type FlowScene, type MapScreen } from "./screens/map";
import { showResults } from "./screens/results";
import { createChooseScene } from "./scenes/choose";
import { isListed, mapEntry } from "./scenes/maps";
import { formatRoute, parseRoute, type MapSlug, type Route } from "./scenes/router";
import { createStage } from "./scenes/stage";

const root = document.getElementById("app") ?? document.body;
const stage = createStage();

// ---- the worker: started the first time the app (not the results page) is shown ----
let client: WorkerClient | null = null;
let flow: MapScreen | null = null;

function startWorker(): void {
  if (client) return;
  client = createClient({
    onLoadProgress: (p) => applyLoadProgress(p),
    onRunEvent: () => flow?.run.wake(),
    onCompetitorDone: (name) => flow?.competitorDone(name),
    onResult: (result) => flow?.run.result(result),
    onReady: () => update({ ready: true, loadPercent: 100, loadError: null }),
    onError: (e) => {
      // Before the simulator is ready, an error is a loading error: shown next to the run button.
      if (!state.ready) {
        update({ loadError: plainError(e) });
        return;
      }
      // A run error goes to the Run_Scene, with its back button.
      if (flow?.scene === "run") flow.run.error(e);
    },
  });
}

/**
 * The back button during a run (Requirement 1.5): the worker cannot stop a run halfway, so it is
 * replaced. The old one is terminated at once, a new one loads (the run button shows its percent
 * again), and nothing of the stopped run reaches the page.
 */
function restartWorker(): void {
  if (!client) return;
  client.terminate();
  client = null;
  buffer.length = 0;
  for (const k of Object.keys(doneCompetitors)) delete doneCompetitors[k];
  update({ ready: false, loadPercent: 0, loadStage: null, loadError: null });
  startWorker();
}

// ---- the scenes ----
type Top = "none" | "choose" | "flow";
let top: Top = "none";
/** True while the router itself changes the flow, so the flow's own scene hooks stay quiet. */
let routing = false;
/** A card was just clicked: its preview grows into the map box. */
let fromCard: { slug: MapSlug; canvas: HTMLCanvasElement; rect: DOMRect } | null = null;

const choose = createChooseScene({
  onOpen: (slug, canvas) => {
    if (stage.locked) return;
    fromCard = { slug, canvas, rect: canvas.getBoundingClientRect() };
    location.hash = formatRoute({ scene: "map", map: slug });
  },
});

function titleOf(slug: MapSlug): string {
  return mapEntry(slug)?.title ?? "the map";
}

const ANNOUNCE: Record<FlowScene, string> = { map: "Read the map", run: "Run", results: "Results" };

function ensureFlow(): MapScreen {
  if (flow) return flow;
  let prepared: ReturnType<typeof stage.prepare> | null = null;
  let entering: HTMLElement[] = [];
  const f = createMapScreen({
    start: (payload) => client?.start(payload),
    // Only a run still in the worker needs a new worker; a finished one is just left.
    cancel: () => {
      if (client?.busy) restartWorker();
    },
    onFinished,
    sceneWillChange: (from, to) => {
      if (routing) return;
      const before = f.parts(from);
      const after = f.parts(to);
      prepared = stage.prepare(before.filter((p) => !after.includes(p)));
      entering = after.filter((p) => !before.includes(p));
    },
    sceneDidChange: (to) => {
      if (routing) return;
      // The address follows the scene: a run is a new entry (back stops it), results replace it.
      const want = formatRoute({ scene: to, map: f.slug });
      if (to === "run") {
        if (location.hash !== want) location.hash = want;
      } else if (location.hash !== want) {
        replaceHash(want);
      }
      stage.setStep(to);
      const finish = prepared;
      prepared = null;
      void finish?.(entering, f.heading(), `${ANNOUNCE[to]}: ${titleOf(f.slug)}`);
    },
  });
  flow = f;
  return f;
}

/** The address the router has handled last (an address change to it again is no news). */
let lastHash: string | null = null;

function replaceHash(hash: string): void {
  history.replaceState(null, "", hash);
  lastHash = location.hash;
}

function replaceRoute(r: Route): void {
  replaceHash(formatRoute(r));
}

function mountApp(): void {
  if (stage.el.parentElement !== root) root.replaceChildren(stage.el);
}

function showChoose(): Promise<void> {
  const f = flow;
  return stage.swap({
    exit: top === "flow" && f ? [f.el] : [],
    apply: () => {
      if (f && f.scene === "run") {
        routing = true;
        f.stopRun();
        routing = false;
      }
      stage.slot.replaceChildren(choose.el);
      top = "choose";
      stage.setStep(null);
      choose.refresh();
    },
    enter: () => choose.enterParts(),
    heading: () => choose.heading,
    announce: "Choose a map",
  });
}

function openMap(slug: MapSlug): Promise<void> {
  const f = ensureFlow();
  const card = fromCard && fromCard.slug === slug && top === "choose" ? fromCard : null;
  fromCard = null;
  return stage.swap({
    exit: top === "choose" ? [choose.el] : top === "flow" ? [f.el] : [],
    apply: () => {
      routing = true;
      f.select(slug);
      routing = false;
      stage.slot.replaceChildren(f.el);
      top = "flow";
      stage.setStep("map");
    },
    afterApply: () => f.relayout(),
    // With the container transform the map box grows from the card; otherwise it comes in too.
    enter: () => (card ? f.parts("map") : [f.mapBox, ...f.parts("map")]),
    heading: () => f.heading(),
    announce: `${ANNOUNCE.map}: ${titleOf(slug)}`,
    container: card ? { from: card.canvas, rect: card.rect, to: () => f.mapBox } : undefined,
  });
}

async function route(): Promise<void> {
  if (stage.locked) {
    // Applied when the transition ends: only the latest address counts.
    stage.whenUnlocked(() => void route());
    return;
  }
  const hash = location.hash;
  lastHash = hash;
  const r = parseRoute(hash);
  if (r.scene === "measured") {
    const container = document.createElement("div");
    root.replaceChildren(container);
    await showResults(container);
    const h = container.querySelector<HTMLElement>("h1");
    if (h && location.hash === hash) {
      h.tabIndex = -1;
      h.focus();
    }
    return;
  }
  startWorker();
  ensureFlow();
  mountApp();
  if (r.scene === "choose") {
    // Every address that ends on the cards reads #/ (an unknown one like #/map/nonsense or #/lab too).
    if (hash !== "" && hash !== "#/") replaceHash("#/");
    if (top !== "choose") await showChoose();
    return;
  }
  if (!isListed(r.map)) {
    // Not a map of the Choose_Scene (yet): back to the cards.
    replaceRoute({ scene: "choose" });
    if (top !== "choose") await showChoose();
    return;
  }
  const f = ensureFlow();
  if (top !== "flow" || f.slug !== r.map) {
    await openMap(r.map);
    // A run, results or lab address without a run of this visit shows the Map_Scene (Requirement 1.4).
    if (r.scene !== "map") replaceRoute({ scene: "map", map: r.map });
    return;
  }
  if (r.scene === "map") {
    if (f.scene === "run") f.stopRun(); // the back button during a run (Requirement 1.5)
    else if (f.scene === "results") f.showMap();
    return;
  }
  if (r.scene !== f.scene) replaceRoute({ scene: f.scene, map: r.map });
}

function onAddress(): void {
  if (location.hash === lastHash) return;
  void route();
}
window.addEventListener("hashchange", onAddress);
window.addEventListener("popstate", onAddress);
void route();
