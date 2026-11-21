import "./style.css";
import { createClient } from "./client";
import { applyLoadProgress, onFinished, state, subscribe, update } from "./state";
import { createLoadingScreen, plainError } from "./screens/loading";
import { createMapScreen, type MapScreen } from "./screens/map";

const root = document.getElementById("app") ?? document.body;

function show(el: HTMLElement): void {
  root.replaceChildren(el);
}

const loading = createLoadingScreen();
show(loading.el);

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
    show(mapScreen.el);
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
