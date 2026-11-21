import "./style.css";
import { createClient } from "./client";
import { applyLoadProgress, state, subscribe, update } from "./state";
import { createLoadingScreen, plainError } from "./screens/loading";
import { createMapScreen } from "./screens/map";

const root = document.getElementById("app") ?? document.body;

function show(el: HTMLElement): void {
  root.replaceChildren(el);
}

const loading = createLoadingScreen();
show(loading.el);

subscribe((s) => {
  if (s.screen === "loading") loading.setProgress(s.loadPercent, s.loadStage);
});

// The worker starts loading as soon as it is created. The client is kept for the
// Map_Screen (task 7.4), which will call client.start().
export const client = createClient({
  onLoadProgress: (p) => applyLoadProgress(p),
  onReady: () => {
    update({ screen: "map", loadPercent: 100 });
    show(createMapScreen({ start: (payload) => client.start(payload) }));
  },
  onError: (e) => {
    // Only loading errors belong to this screen. Run errors are handled later.
    if (state.screen !== "loading") return;
    const message = plainError(e);
    update({ loadError: message });
    loading.setError(message);
  },
});
