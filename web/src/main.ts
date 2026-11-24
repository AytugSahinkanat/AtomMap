import "./style.css";
import { createClient } from "./client";
import { applyLoadProgress, onFinished, state, subscribe, update } from "./state";
import { createLoadingScreen, plainError } from "./screens/loading";
import { createMapScreen, type MapScreen } from "./screens/map";
import { showResults } from "./screens/results";

const root = document.getElementById("app") ?? document.body;

function show(el: HTMLElement): void {
  root.replaceChildren(el);
}

const loading = createLoadingScreen();

subscribe((s) => {
  if (s.screen === "loading") loading.setProgress(s.loadPercent, s.loadStage);
});

let mapScreen: MapScreen | null = null;

// The worker starts loading as soon as it is created. The client is kept for the
// Map_Screen (task 7.4), which will call client.start().
export const client = createClient({
  onLoadProgress: (p) => applyLoadProgress(p),
  onRunEvent: () => mapScreen?.run.wake(),
  onCompetitorDone: (name) => mapScreen?.competitorDone(name),
  onResult: (result) => mapScreen?.run.result(result),
  onReady: () => {
    update({ screen: "map", loadPercent: 100 });
    mapScreen = createMapScreen({
      start: (payload) => client.start(payload),
      onFinished,
    });
    // Only swap the screen in when the map flow is the one being shown.
    if (!isResultsRoute()) show(mapScreen.el);
  },
  onError: (e) => {
    // Run errors go to the Run_Screen, with a back button.
    if (state.screen === "run") {
      mapScreen?.run.error(e);
      return;
    }
    if (state.screen !== "loading") return;
    const message = plainError(e);
    update({ loadError: message });
    loading.setError(message);
  },
});

// Hash route. `#/results` shows the Results_Page at once, without waiting for
// the Worker. Anything else shows the map flow. The Worker, the loading state
// and a finished run live outside the route, so going back loses nothing.
function isResultsRoute(): boolean {
  return location.hash === "#/results";
}

let routeToken = 0;

function focusHeading(el: HTMLElement): void {
  const h = el.querySelector<HTMLElement>("h1");
  if (!h) return;
  h.tabIndex = -1;
  h.focus({ preventScroll: false });
}

async function route(moveFocus: boolean): Promise<void> {
  const token = ++routeToken;
  if (isResultsRoute()) {
    const container = document.createElement("div");
    show(container);
    await showResults(container);
    if (token === routeToken && moveFocus) focusHeading(container);
    return;
  }
  const el = mapScreen ? mapScreen.el : loading.el;
  show(el);
  if (moveFocus) focusHeading(el);
}

void route(false);
window.addEventListener("hashchange", () => void route(true));
