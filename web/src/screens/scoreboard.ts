// Scoreboard panel (ui spec, Requirement 4). It sits next to the map and fills in
// card by card while the run goes on. All four cards use one component, one
// look: no winner colour, no crown, no glow on any card (design steering).
// No MIS logic here. Numbers come from scoreboard-model.ts, which copies Stats.
// Text is set with textContent only.

import {
  CITATION,
  ONE_RUN_NOTE,
  type EngineName,
  TIE_TEXT,
  buildCards,
  type Card,
  type PartialResults,
} from "../scoreboard-model";

export type ScoreboardMode = "channel_plan" | "place";

/** Plain description of one card, so the DOM code is trivial and the text is testable. */
export interface CardView {
  key: string;
  title: string;
  state: Card["state"];
  /** Pending or error sentence. null for ready cards. */
  message: string | null;
  /** Ready cards: the big total, e.g. "35". */
  total: string | null;
  /** Ready cards: picks per round, e.g. "11 / 11 / 9". One number in Place mode. */
  perRound: string | null;
  /** Spoken/plain meaning of perRound. */
  perRoundCaption: string | null;
  /** Ready cards, second level ("Details"): splits, skipped, mismatches, gaps. */
  rows: { label: string; value: string }[];
  /** Ready cards: quantum share, always present. */
  share: { text: string; detail: string; percent: number } | null;
  /** Short lines: "atoms weren't needed on this map" (hybrid only),
   *  "This method doesn't use atoms." (annealing, coin flip), "tie". */
  notes: string[];
  /** "simulation" or "real hardware" for ready cards. */
  resultLabel: string | null;
}

export function describeCard(card: Card, mode: ScoreboardMode): CardView {
  if (card.state !== "ready") {
    return {
      key: card.key,
      title: card.label,
      state: card.state,
      message: card.text,
      total: null,
      perRound: null,
      perRoundCaption: null,
      rows: [],
      share: null,
      notes: [],
      resultLabel: null,
    };
  }
  const rows: { label: string; value: string }[] = [
    { label: "Groups split in two", value: String(card.splits) },
    { label: "Groups skipped", value: String(card.skippedTiles) },
    { label: "Layout mismatches", value: String(card.mismatches) },
  ];
  if (card.gapsCount !== null) rows.push({ label: "Points left uncovered", value: String(card.gapsCount) });
  const notes: string[] = [];
  if (card.atomsNotNeededText) notes.push(card.atomsNotNeededText);
  if (card.noAtomsText) notes.push(card.noAtomsText);
  if (card.tieText) notes.push(card.tieText);
  const channelPlan = mode === "channel_plan";
  return {
    key: card.key,
    title: card.label,
    state: "ready",
    message: null,
    total: String(card.total),
    perRound: card.rounds.map((r) => r.picks).join(channelPlan ? " / " : ""),
    perRoundCaption: channelPlan
      ? `picks per channel (${card.rounds.map((r, i) => r.channel ?? i + 1).join(" / ")})`
      : "picks in one round",
    rows,
    share: {
      text: `Quantum share: ${card.quantumShareText}`,
      detail: card.quantumDetailText,
      percent: Math.min(100, Math.max(0, card.quantumShare * 100)),
    },
    notes,
    resultLabel: card.resultLabel,
  };
}

/** True when a card must be redrawn: first draw, or its content differs. Pure. */
export function cardChanged(prev: CardView | null | undefined, next: CardView): boolean {
  if (prev === null || prev === undefined) return true;
  return JSON.stringify(prev) !== JSON.stringify(next);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderCard(view: CardView): HTMLElement {
  const art = document.createElement("article");
  art.className = "score-card";
  art.dataset.state = view.state;
  // The card is a plain wrapper: the radio inside must belong to the radiogroup.
  art.setAttribute("role", "none");
  if (view.state === "pending") art.setAttribute("aria-busy", "true");

  // The card title is the Plan_Selector radio (ui design, Plan_Selector). Its
  // state (checked, disabled, tab stop) is set by the scoreboard view.
  const radio = el("div", "score-title", view.title);
  radio.setAttribute("role", "radio");
  radio.setAttribute("aria-checked", "false");
  radio.setAttribute("aria-disabled", "true");
  radio.tabIndex = -1;
  radio.dataset.plan = view.key;
  art.append(radio);

  if (view.message !== null) {
    const msg = el("p", "muted score-message", view.message);
    msg.id = `plan-msg-${view.key}`;
    radio.setAttribute("aria-describedby", msg.id);
    art.append(msg);
    return art;
  }

  art.append(el("p", "score-total num", view.total ?? ""));
  if (view.perRound !== null) {
    const p = el("p", "score-rounds num", view.perRound);
    if (view.perRoundCaption) {
      p.title = view.perRoundCaption;
      p.append(el("span", "visually-hidden", ` ${view.perRoundCaption}`));
    }
    art.append(p);
  }
  // Text tag for the plan on the map: not colour alone, and no "winner" wording.
  const tag = el("span", "plan-tag", PLAN_TAG_TEXT);
  tag.hidden = true;
  art.append(tag);

  if (view.share) {
    const track = el("div", "bar share-bar");
    track.setAttribute("aria-hidden", "true");
    const fill = el("div", "bar-fill share-fill");
    fill.style.width = `${view.share.percent}%`;
    track.append(fill);
    art.append(el("p", "score-share num", view.share.text), track, el("p", "muted score-detail num", view.share.detail));
  }
  const tie = view.notes.includes(TIE_TEXT);
  for (const n of view.notes) {
    if (n === TIE_TEXT) continue;
    art.append(el("p", "score-note", n));
  }

  const det = el("details", "score-details");
  det.append(el("summary", "", "Details"));
  const dl = el("dl", "score-rows num");
  for (const r of view.rows) dl.append(el("dt", "", r.label), el("dd", "", r.value));
  det.append(dl);
  art.append(det);

  if (view.resultLabel) {
    art.append(el("p", "muted score-label", tie ? `${view.resultLabel} \u00b7 ${TIE_TEXT}` : view.resultLabel));
  }
  return art;
}
export type ExportKind = "csv" | "geojson";
export const EXPORT_CSV_LABEL = "Download CSV";
export const EXPORT_GEOJSON_LABEL = "Download GeoJSON";
export const PLAN_TAG_TEXT = "on the map";
export const PLAN_GROUP_LABEL = "plan on the map";
export const REPEAT_LABEL = "Repeat this run";
export const RUN_AGAIN_LABEL = "Run again";
/** "Run #N": the Run_Number, which is the Seed of the run (Requirement 5.3). */
export function runNumberText(n: number): string {
  return `Run #${n}`;
}

export interface ScoreboardDeps {
  /** The visitor chose the plan shown on the map (after the result is in). */
  onSelectPlan?(plan: EngineName): void;
  /** Export the plan selected now. Returns a plain message when nothing could be exported, else null. */
  onExport?(kind: ExportKind, plan: EngineName): string | null;
  /** "Repeat this run": the same Run_Number, map and settings. */
  onRepeat(): void;
  /** "Run again": a new Run_Number on the same map and settings. */
  onRunAgain(): void;
  /** Back to the map controls. */
  onBack(): void;
  /** Polite live announcement. */
  announce(message: string): void;
}

export interface ScoreboardView {
  el: HTMLElement;
  /** A run starts: all four cards pending, buttons off. On the Daily_Map there is no "Run again". */
  begin(runNumber: number, mode: ScoreboardMode, opts?: { daily?: boolean }): void;
  /** Show what has finished so far (missing key = "Computing…"). */
  update(partial: PartialResults): void;
  /** The run is fully finished (result in, playback done). Enables the controls. */
  finish(partial: PartialResults): void;
  /** The plan on the map: Hybrid at the start of each run. */
  readonly selectedPlan: EngineName;
  /** True when focus sits on a control that `begin` disables (repeat, run again). */
  holdsRunFocus(): boolean;
  /** The run stopped with an error: panel hidden, nothing partial stays. */
  hide(): void;
}

export function createScoreboard(deps: ScoreboardDeps): ScoreboardView {
  const el = document.createElement("aside");
  el.className = "finished-panel scoreboard";
  el.hidden = true;
  el.setAttribute("aria-label", "Scoreboard");

  const title = document.createElement("h2");
  title.textContent = "Scoreboard";
  const seedLine = document.createElement("p");
  seedLine.className = "muted num score-seed";
  const cardsBox = document.createElement("div");
  cardsBox.className = "score-cards";
  cardsBox.setAttribute("role", "radiogroup");
  cardsBox.setAttribute("aria-label", PLAN_GROUP_LABEL);

  const note = document.createElement("p");
  note.className = "score-note-one";
  note.textContent = ONE_RUN_NOTE;
  const noteLink = document.createElement("a");
  noteLink.href = "#/results";
  noteLink.className = "results-link";
  noteLink.textContent = "See what we measured.";
  note.append(" ", noteLink);
  const cite = document.createElement("p");
  cite.className = "muted score-cite";
  cite.textContent = CITATION;

  const form = document.createElement("form");
  form.className = "score-again";
  form.noValidate = true;
  // The Run_Number controls (experience spec, Requirement 5). No seed input outside the Lab.
  const repeat = document.createElement("button");
  repeat.type = "button";
  repeat.textContent = REPEAT_LABEL;
  const again = document.createElement("button");
  again.type = "submit";
  again.textContent = RUN_AGAIN_LABEL;
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Back to the map";
  const message = document.createElement("p");
  message.className = "error";
  message.setAttribute("role", "alert");
  message.hidden = true;
  const csvButton = document.createElement("button");
  csvButton.type = "button";
  csvButton.textContent = EXPORT_CSV_LABEL;
  const geoButton = document.createElement("button");
  geoButton.type = "button";
  geoButton.textContent = EXPORT_GEOJSON_LABEL;
  form.append(repeat, again, back, csvButton, geoButton, message);

  el.append(title, seedLine, cardsBox, note, cite, form);

  let mode: ScoreboardMode = "channel_plan";
  let shown = new Set<string>();
  let views: CardView[] = [];
  let nodes: HTMLElement[] = [];

  // ---- Plan_Selector: the card titles are the radios ----
  let selected: EngineName = "Hybrid";
  let planEnabled = false;

  function radios(): HTMLElement[] {
    return [...cardsBox.querySelectorAll<HTMLElement>('[role="radio"]')];
  }
  function usable(r: HTMLElement): boolean {
    return planEnabled && r.closest("[data-state]")?.getAttribute("data-state") === "ready";
  }

  /** Apply checked, disabled, tab stop, border and tag to the current cards. */
  function syncPlan(): void {
    const all = radios();
    const stopRadio = all.find((r) => usable(r) && r.dataset.plan === selected) ?? all.find(usable);
    for (const r of all) {
      const card = r.closest<HTMLElement>("[data-state]");
      const isSel = r.dataset.plan === selected;
      const ok = usable(r);
      r.setAttribute("aria-checked", String(isSel));
      r.setAttribute("aria-disabled", String(!ok));
      r.tabIndex = r === stopRadio ? 0 : -1;
      if (card) {
        card.dataset.selected = String(isSel && card.dataset.state === "ready");
        const tag = card.querySelector<HTMLElement>(".plan-tag");
        if (tag) tag.hidden = !(isSel && card.dataset.state === "ready");
      }
    }
  }

  function choose(r: HTMLElement, focus: boolean): void {
    if (!usable(r)) return;
    const plan = r.dataset.plan as EngineName;
    if (focus) r.focus();
    if (plan === selected) return;
    selected = plan;
    syncPlan();
    deps.onSelectPlan?.(plan);
  }

  cardsBox.addEventListener("click", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (r) choose(r, true);
  });
  cardsBox.addEventListener("keydown", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (!r) return;
    if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
      e.preventDefault();
      choose(r, false);
      return;
    }
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const list = radios().filter(usable);
    const at = list.indexOf(r);
    if (list.length === 0 || at < 0) return;
    choose(list[(at + delta + list.length) % list.length], true);
  });

  function setControls(enabled: boolean): void {
    repeat.disabled = !enabled;
    again.disabled = !enabled;
    back.disabled = !enabled;
    csvButton.disabled = !enabled;
    geoButton.disabled = !enabled;
  }

  function exportNow(kind: ExportKind): void {
    const button = kind === "csv" ? csvButton : geoButton;
    if (button.disabled || !deps.onExport) return;
    // The plan is read now, at click time.
    const problem = deps.onExport(kind, selected);
    message.textContent = problem ?? "";
    message.hidden = problem === null;
  }
  csvButton.addEventListener("click", () => exportNow("csv"));
  geoButton.addEventListener("click", () => exportNow("geojson"));

  function render(partial: PartialResults): void {
    const cards = buildCards(partial);
    const next = cards.map((c) => describeCard(c, mode));
    if (nodes.length !== next.length) {
      nodes = next.map(renderCard);
      cardsBox.replaceChildren(...nodes);
    } else {
      next.forEach((v, i) => {
        if (!cardChanged(views[i], v)) return;
        const old = nodes[i];
        const fresh = renderCard(v);
        const oldDet = old.querySelector("details");
        const newDet = fresh.querySelector("details");
        const keepFocus = oldDet !== null && oldDet.contains(document.activeElement);
        if (oldDet?.open && newDet) newDet.open = true;
        old.replaceWith(fresh);
        if (keepFocus) fresh.querySelector("summary")?.focus();
        nodes[i] = fresh;
      });
    }
    views = next;
    syncPlan();
    for (const c of cards) {
      if (c.state !== "pending" && !shown.has(c.key)) {
        shown.add(c.key);
        deps.announce(`${c.label} is done.`);
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (again.disabled || again.hidden) return;
    message.hidden = true;
    deps.onRunAgain();
  });
  repeat.addEventListener("click", () => {
    if (repeat.disabled) return;
    message.hidden = true;
    deps.onRepeat();
  });
  back.addEventListener("click", () => {
    if (!back.disabled) deps.onBack();
  });

  return {
    el,
    begin(runNumber, m, opts) {
      mode = m;
      shown = new Set();
      views = [];
      nodes = [];
      selected = "Hybrid";
      planEnabled = false;
      seedLine.textContent = runNumberText(runNumber);
      // Today's map always runs with its Daily_Seed: only "Repeat this run" (Requirement 5.5).
      again.hidden = opts?.daily === true;
      message.hidden = true;
      setControls(false);
      render({});
      el.hidden = false;
    },
    update(partial) {
      render(partial);
    },
    finish(partial) {
      planEnabled = true;
      render(partial);
      setControls(true);
    },
    get selectedPlan() {
      return selected;
    },
    holdsRunFocus() {
      return document.activeElement === again || document.activeElement === repeat;
    },
    hide() {
      el.hidden = true;
      planEnabled = false;
      setControls(false);
      syncPlan();
    },
  };
}
