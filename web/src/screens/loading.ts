// Loading_Screen: progress bar and a plain-words sentence per stage.
// All dynamic text is set with textContent.

export const STAGE_SENTENCES: Record<LoadStage, string> = {
  pyodide: "Starting Python in your browser.",
  engine: "Loading the AtomMap engine.",
  packages: "Loading a quantum simulator into your browser.",
  boot: "Getting the simulator ready.",
  warmup: "Running a tiny test so the first run is quick.",
};

export function stageSentence(stage: LoadStage | null): string {
  return stage ? STAGE_SENTENCES[stage] : "Getting started.";
}

/** Turn a worker error into a short plain-words message. */
export function plainError(e: ErrorPayload): string {
  const where = e.stage ? ` while loading (${stage_name(e.stage)})` : "";
  const dep = e.dependency ? ` The problem is with "${e.dependency}".` : "";
  return `Something went wrong${where}.${dep} ${e.message}`.trim();
}

function stage_name(stage: LoadStage): string {
  return stage === "pyodide" ? "Python" : stage;
}

export interface LoadingView {
  el: HTMLElement;
  setProgress(percent: number, stage: LoadStage | null): void;
  setError(message: string): void;
}

export function createLoadingScreen(): LoadingView {
  const el = document.createElement("main");
  el.className = "screen loading";

  const h = document.createElement("h1");
  h.textContent = "AtomMap";

  const label = document.createElement("label");
  label.id = "load-label";
  label.textContent = "Loading progress";

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-labelledby", "load-label");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", "0");
  const fill = document.createElement("div");
  fill.className = "bar-fill";
  fill.style.width = "0%";
  bar.appendChild(fill);

  const pct = document.createElement("p");
  pct.className = "muted num";
  pct.textContent = "0%";

  const sentence = document.createElement("p");
  sentence.className = "stage";
  sentence.setAttribute("aria-live", "polite");
  sentence.textContent = stageSentence(null);

  const err = document.createElement("p");
  err.className = "error";
  err.setAttribute("role", "alert");
  err.hidden = true;

  el.append(h, label, bar, pct, sentence, err);

  return {
    el,
    setProgress(percent, stage) {
      const p = Math.round(Math.min(100, Math.max(0, percent)));
      bar.setAttribute("aria-valuenow", String(p));
      fill.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      sentence.textContent = stageSentence(stage);
    },
    setError(message) {
      err.textContent = message;
      err.hidden = false;
      sentence.textContent = "Loading stopped.";
    },
  };
}
