// The lab's own parts (experience spec, Requirements 15, 16 and 18; design "Lab", Layout and
// Controls): the top bar, the instruments column and the readouts column. The map in the middle is
// the map of the Results_Scene; map.ts places these parts around it. DOM only: the ranges and texts
// come from lab-model.ts, the numbers from the shown run. Text is set with textContent only.

import { formatPercent } from "../scoreboard-model";
import { icon, type IconName } from "./icons";
import { EXPERIMENTS } from "./experiments";
import { HISTORY_CAPTION, HISTORY_EMPTY, TOTALS_KEY, totalsText, type HistoryRow } from "./history";
import {
  DEV_COMMAND,
  DEV_INTRO,
  DEV_NOTE,
  DEV_PYTHON,
  LAB_BAR_NOTE,
  README_ENGINE_URL,
  R_NOTE,
  SEED_NOTE,
  SHOTS_NOTE,
  TOP_NOTE,
  labBarText,
  labLabel,
  parseLabR,
  parseLabSeed,
  parseShots,
  parseTopPercent,
  percentText,
  readoutRows,
  walkingRNote,
  type Parse,
} from "./lab-model";

/** The values of a lab run, after every control passed its check. */
export interface LabValues {
  seed: number;
  r: number;
  shots: number;
  top_share: number;
}

/** The run shown in the readouts: its number, r and settings (null settings: the measured defaults). */
export interface ShownRun {
  runNumber: number;
  r: number;
  settings: { shots: number; top_share: number } | null;
  competitors: Record<string, unknown>;
}

export interface LabViewDeps {
  onRun(values: LabValues): void;
  onLeave(): void;
  /** Save the shown run's log; returns a plain message when there is none. */
  onDownloadLog(): string | null;
}

export interface LabView {
  bar: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  /** The lab's heading (focused when the lab opens). */
  heading: HTMLElement;
  /** Where the Shot_Histogram goes while the lab is open. */
  atomsSlot: HTMLElement;
  /** Where the run bar (status, speed, skip) goes while the lab is open. */
  runSlot: HTMLElement;
  /** The map and its r: read-only on walking maps. */
  setMap(name: string, r: { value: number; readOnly: boolean }): void;
  /** Fill the controls (on opening the lab: the shown run's values). Clears the messages. */
  setControls(v: LabValues): void;
  /** The run button: its state while the simulator loads or a run goes on. */
  setRunButton(state: { enabled: boolean; text: string }): void;
  /** The top bar's run number. */
  setRunNumber(n: number | null): void;
  /** The readouts: the shown run, a run in progress, or nothing yet. */
  showReadouts(shown: ShownRun | null, running: number | null): void;
  /** The request text of the shown run (for Copy request) and whether its log can be saved. */
  setTools(t: { request: string | null; log: boolean }): void;
  /** The Lab_History rows, oldest first. */
  setHistory(rows: readonly HistoryRow[]): void;
  /** Focus "Run again" (after a run, so keyboard focus does not drop to the page). */
  focusRun(): void;
  /** True when focus is inside the lab's own parts, or nowhere. */
  holdsFocus(): boolean;
}

function panel(title: string, iconName: IconName, cls: string): { el: HTMLElement; body: HTMLElement } {
  const el = document.createElement("section");
  el.className = `lab-panel ${cls}`;
  const h = document.createElement("h2");
  h.className = "lab-panel-title";
  h.append(icon(iconName), document.createTextNode(title));
  const id = `lab-panel-${cls}`;
  h.id = id;
  el.setAttribute("aria-labelledby", id);
  const body = document.createElement("div");
  body.className = "lab-panel-body";
  el.append(h, body);
  return { el, body };
}

interface Field {
  root: HTMLElement;
  input: HTMLInputElement;
  note: HTMLElement;
  message: HTMLElement;
  check(): Parse<number>;
}

function field(id: string, label: string, noteText: string, parse: (t: string) => Parse<number>, inputMode: string, unit?: string): Field {
  const root = document.createElement("div");
  root.className = "lab-field";
  const lab = document.createElement("label");
  lab.htmlFor = id;
  lab.className = "lab-label";
  lab.textContent = label;
  const row = document.createElement("div");
  row.className = "lab-input-row";
  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.inputMode = inputMode;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.className = "lab-input";
  row.append(input);
  if (unit) {
    const u = document.createElement("span");
    u.className = "lab-unit";
    u.textContent = unit;
    row.append(u);
  }
  const note = document.createElement("p");
  note.className = "lab-note";
  note.id = `${id}-note`;
  note.textContent = noteText;
  const message = document.createElement("p");
  message.className = "lab-message";
  message.id = `${id}-msg`;
  message.setAttribute("role", "status");
  message.hidden = true;
  input.setAttribute("aria-describedby", `${note.id} ${message.id}`);
  root.append(lab, row, note, message);
  const f: Field = {
    root,
    input,
    note,
    message,
    check() {
      const p = parse(input.value);
      message.hidden = p.ok;
      message.textContent = p.ok ? "" : p.error;
      input.setAttribute("aria-invalid", String(!p.ok));
      return p;
    },
  };
  // A message shows while typing only once the value is wrong; it goes as soon as it is right.
  input.addEventListener("input", () => {
    if (!message.hidden || !parse(input.value).ok) f.check();
  });
  return f;
}

export function createLabView(deps: LabViewDeps): LabView {
  // ---- top bar ----
  const bar = document.createElement("header");
  bar.className = "lab-bar";
  const heading = document.createElement("h1");
  heading.className = "lab-title";
  heading.tabIndex = -1;
  const titleText = document.createElement("span");
  heading.append(icon("flask", 18), titleText);
  const barNote = document.createElement("p");
  barNote.className = "lab-bar-note";
  barNote.textContent = LAB_BAR_NOTE;
  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "lab-leave";
  leave.textContent = "Leave the lab";
  leave.setAttribute("aria-keyshortcuts", "Escape");
  leave.addEventListener("click", () => deps.onLeave());
  bar.append(heading, barNote, leave);

  // ---- instruments ----
  const left = document.createElement("div");
  left.className = "lab-col lab-left";
  const inst = panel("Instruments", "sliders", "instruments");
  const seed = field("lab-seed", "Run number (seed)", SEED_NOTE, parseLabSeed, "numeric");
  const r = field("lab-r", "r", R_NOTE, parseLabR, "decimal", "m");
  const shots = field("lab-shots", "Shots per group", SHOTS_NOTE, parseShots, "numeric", "10–200");
  const top = field("lab-top", "Top group", TOP_NOTE, parseTopPercent, "decimal", "%");
  const runBtn = document.createElement("button");
  runBtn.type = "submit";
  runBtn.className = "lab-run";
  runBtn.textContent = "Run again";
  const form = document.createElement("form");
  form.className = "lab-form";
  form.noValidate = true;
  form.append(seed.root, r.root, shots.root, top.root, runBtn);
  inst.body.append(form);
  left.append(inst.el);
  let rNote = R_NOTE;

  function readValues(): LabValues {
    const n = (t: string, d: number) => (Number.isFinite(Number(t.trim().replace("%", ""))) && t.trim() !== "" ? Number(t.trim().replace("%", "")) : d);
    return { seed: Math.trunc(n(seed.input.value, 1)), r: n(r.input.value, 20), shots: Math.trunc(n(shots.input.value, 100)), top_share: n(top.input.value, 40) / 100 };
  }
  function fill(v: LabValues): void {
    seed.input.value = String(v.seed);
    if (!r.input.readOnly) r.input.value = String(v.r);
    shots.input.value = String(v.shots);
    top.input.value = percentText(v.top_share);
    for (const f of [seed, r, shots, top]) f.check();
  }


  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (runBtn.disabled) return;
    const checks = [seed, r, shots, top].map((f) => [f, f.check()] as const);
    const bad = checks.find(([, p]) => !p.ok);
    if (bad) {
      bad[0].input.focus(); // Requirement 16.2: the message, and no run
      return;
    }
    const v = (f: Field) => (checks.find(([g]) => g === f)![1] as { ok: true; value: number }).value;
    deps.onRun({ seed: v(seed), r: v(r), shots: v(shots), top_share: v(top) });
  });

  // ---- experiments (Requirement 16.5): a card fills the instruments, it never starts a run ----
  const exp = panel("Experiments", "tubes", "experiments");
  const expStatus = document.createElement("p");
  expStatus.className = "lab-note lab-exp-status";
  expStatus.setAttribute("role", "status");
  const cards = EXPERIMENTS.map((x) => {
    const card = document.createElement("div");
    card.className = "lab-card";
    const h = document.createElement("h3");
    h.className = "lab-card-title";
    h.textContent = x.title;
    const t = document.createElement("p");
    t.className = "lab-card-text";
    t.textContent = `Try: ${x.tryText}`;
    const l = document.createElement("p");
    l.className = "lab-card-text";
    l.textContent = `Look for: ${x.lookText}`;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lab-card-set";
    b.textContent = "Set it up";
    b.setAttribute("aria-label", `Set it up: ${x.title}`);
    b.addEventListener("click", () => {
      const now = readValues();
      const next = x.set(now, { rReadOnly: r.input.readOnly });
      if (!next.ok) {
        expStatus.textContent = next.error;
        return;
      }
      fill(next.value);
      expStatus.textContent = `${x.title}: the instruments are set. Press Run again to run it.`;
      runBtn.focus();
    });
    card.append(h, t, l, b);
    return card;
  });
  exp.body.append(...cards, expStatus);

  // ---- for developers (Requirement 16.7) ----
  const dev = panel("For developers", "flask", "developers");
  const devIntro = document.createElement("p");
  devIntro.className = "lab-note";
  devIntro.textContent = DEV_INTRO;
  const devCmd = document.createElement("pre");
  devCmd.className = "lab-code";
  devCmd.textContent = DEV_COMMAND;
  const devOr = document.createElement("p");
  devOr.className = "lab-note";
  devOr.textContent = "Or from Python:";
  const devPy = document.createElement("pre");
  devPy.className = "lab-code";
  devPy.textContent = DEV_PYTHON;
  const devNote = document.createElement("p");
  devNote.className = "lab-note";
  devNote.textContent = DEV_NOTE;
  const devLink = document.createElement("a");
  devLink.href = README_ENGINE_URL;
  devLink.rel = "noopener noreferrer";
  devLink.target = "_blank";
  devLink.className = "lab-link";
  devLink.textContent = "Use the engine with your own data (README)";
  dev.body.append(devIntro, devCmd, devOr, devPy, devNote, devLink);
  left.append(exp.el, dev.el);

  // ---- readouts ----
  const right = document.createElement("div");
  right.className = "lab-col lab-right";
  const runSlot = document.createElement("div");
  runSlot.className = "lab-run-slot";
  const read = panel("Readouts", "gauge", "readouts");
  const runLine = document.createElement("p");
  runLine.className = "lab-run-line";
  const labelLine = document.createElement("p");
  labelLine.className = "lab-label-line";
  const table = document.createElement("table");
  table.className = "lab-table";
  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = "The four plans of the shown run";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const [t, cls] of [["plan", ""], ["picks", "n"], ["quantum share", "n"], ["splits", "n"], ["skipped", "n"]]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = t;
    if (cls) th.className = cls;
    hr.append(th);
  }
  thead.append(hr);
  const tbody = document.createElement("tbody");
  table.append(caption, thead, tbody);
  const empty = document.createElement("p");
  empty.className = "lab-empty";
  read.body.append(runLine, labelLine, table, empty);

  // ---- tools: copy the request, download the run log (Requirement 16.6) ----
  const tools = document.createElement("div");
  tools.className = "lab-tools";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy request";
  const logBtn = document.createElement("button");
  logBtn.type = "button";
  logBtn.textContent = "Download run log";
  const toolStatus = document.createElement("p");
  toolStatus.className = "lab-note lab-tool-status";
  toolStatus.setAttribute("role", "status");
  tools.append(copyBtn, logBtn, toolStatus);
  read.body.append(tools);
  let requestText: string | null = null;
  copyBtn.addEventListener("click", async () => {
    if (requestText === null) return;
    const ok = await copyText(requestText);
    toolStatus.textContent = ok
      ? `Copied the request of this run (${requestText.length} characters). Save it as request.json.`
      : "This browser did not allow copying.";
  });
  logBtn.addEventListener("click", () => {
    toolStatus.textContent = deps.onDownloadLog() ?? "Saved the run log.";
  });

  // ---- history (Requirement 16.4) ----
  const hist = panel("History", "tubes", "history");
  const hTable = document.createElement("table");
  hTable.className = "lab-table lab-history";
  const hCaption = document.createElement("caption");
  hCaption.className = "visually-hidden";
  hCaption.textContent = HISTORY_CAPTION;
  const hHead = document.createElement("thead");
  const hRow = document.createElement("tr");
  for (const [t, cls] of [["run", ""], ["r", "n"], ["shots", "n"], ["top", "n"], ["totals", "n"], ["hybrid q", "n"]]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = t;
    if (cls) th.className = cls;
    hRow.append(th);
  }
  hHead.append(hRow);
  const hBody = document.createElement("tbody");
  hTable.append(hCaption, hHead, hBody);
  const hKey = document.createElement("p");
  hKey.className = "lab-note";
  hKey.textContent = TOTALS_KEY;
  const hEmpty = document.createElement("p");
  hEmpty.className = "lab-empty";
  hEmpty.textContent = HISTORY_EMPTY;
  hist.body.append(hEmpty, hTable, hKey);
  hTable.hidden = true;
  hKey.hidden = true;

  const atoms = panel("Atoms", "tubes", "atoms");
  const atomsSlot = atoms.body;
  const atomsHint = document.createElement("p");
  atomsHint.className = "lab-note";
  atomsHint.textContent = "During a run: how often each atom of the group on the simulator was kept in the shots.";
  atomsSlot.append(atomsHint);
  right.append(runSlot, read.el, atoms.el, hist.el);

  let mapName = "";

  return {
    bar,
    left,
    right,
    heading,
    atomsSlot,
    runSlot,
    setMap(name, rInfo) {
      mapName = name;
      titleText.textContent = labBarText(mapName, null);
      r.input.readOnly = rInfo.readOnly;
      r.root.classList.toggle("is-readonly", rInfo.readOnly);
      rNote = rInfo.readOnly ? walkingRNote(rInfo.value) : R_NOTE;
      r.note.textContent = rNote;
    },
    setControls(v) {
      seed.input.value = String(v.seed);
      r.input.value = String(v.r);
      shots.input.value = String(v.shots);
      top.input.value = percentText(v.top_share);
      for (const f of [seed, r, shots, top]) {
        f.message.hidden = true;
        f.message.textContent = "";
        f.input.removeAttribute("aria-invalid");
      }
    },
    setTools(t) {
      requestText = t.request;
      copyBtn.disabled = t.request === null;
      logBtn.disabled = !t.log;
      toolStatus.textContent = "";
    },
    setHistory(rows) {
      hBody.replaceChildren(
        ...rows.map((row) => {
          const tr = document.createElement("tr");
          const cells = [String(row.runNumber), String(row.r), String(row.shots), `${percentText(row.topShare)}%`, totalsText(row), row.hybridShare === null ? "–" : formatPercent(row.hybridShare)];
          cells.forEach((c, i) => {
            const td = document.createElement(i === 0 ? "th" : "td");
            if (i === 0) (td as HTMLTableCellElement).scope = "row";
            else td.className = "n";
            td.textContent = c;
            tr.append(td);
          });
          return tr;
        }),
      );
      hTable.hidden = rows.length === 0;
      hKey.hidden = rows.length === 0;
      hEmpty.hidden = rows.length > 0;
    },
    focusRun() {
      runBtn.focus();
    },
    holdsFocus() {
      const a = document.activeElement;
      return a === null || a === document.body || bar.contains(a) || left.contains(a) || right.contains(a);
    },
    setRunButton(s) {
      runBtn.disabled = !s.enabled;
      runBtn.textContent = s.text;
    },
    setRunNumber(n) {
      titleText.textContent = labBarText(mapName, n);
    },
    showReadouts(shown, running) {
      tbody.replaceChildren();
      if (running !== null) {
        runLine.textContent = `RUN ${running} · running…`;
        labelLine.textContent = "";
        empty.textContent = "The numbers come when all four plans have finished.";
        empty.hidden = false;
        table.hidden = true;
        return;
      }
      if (shown === null) {
        runLine.textContent = "No run yet.";
        labelLine.textContent = "";
        empty.textContent = "Set the instruments and press Run.";
        empty.hidden = false;
        table.hidden = true;
        return;
      }
      const s = shown.settings;
      runLine.textContent = `RUN ${shown.runNumber} · r ${shown.r} m · shots ${s ? s.shots : 100} · top group ${s ? percentText(s.top_share) : 40}%`;
      labelLine.textContent = s ? labLabel(s) : "This run used the measured defaults.";
      labelLine.classList.toggle("is-lab", s !== null);
      empty.hidden = true;
      table.hidden = false;
      for (const row of readoutRows(shown.competitors)) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = row.label;
        tr.append(th);
        const cells =
          row.problem !== null
            ? [row.problem, "", "", ""]
            : [String(row.total ?? "–"), row.quantumShare === null ? "–" : formatPercent(row.quantumShare), String(row.splits ?? "–"), String(row.skipped ?? "–")];
        for (const c of cells) {
          const td = document.createElement("td");
          td.className = "n";
          td.textContent = c;
          tr.append(td);
        }
        tbody.append(tr);
      }
    },
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Without the clipboard API (or its permission): a hidden text area and the copy command.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
