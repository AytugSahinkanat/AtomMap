// Scoreboard panel (ui spec, Requirement 4). It sits next to the map and fills in
// card by card while the run goes on. All four cards use one component, one
// look: no winner colour, no crown, no glow on any card (design steering).
// No MIS logic here. Numbers come from scoreboard-model.ts, which copies Stats.
// Text is set with textContent only.

import {
  CITATION,
  ONE_RUN_NOTE,
  TIE_TEXT,
  buildCards,
  type Card,
  type PartialResults,
} from "../scoreboard-model";
import { nextSeed, parseSeed } from "../seed";

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
  art.setAttribute("aria-label", view.title);
  if (view.state === "pending") art.setAttribute("aria-busy", "true");

  art.append(el("h3", "", view.title));

  if (view.message !== null) {
    art.append(el("p", "muted score-message", view.message));
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
export interface ScoreboardDeps {
  /** Start a new run with this valid seed on the same map and settings. */
  onRunAgain(seed: number): void;
  /** Back to the map controls. */
  onBack(): void;
  /** Polite live announcement. */
  announce(message: string): void;
}

export interface ScoreboardView {
  el: HTMLElement;
  /** A run starts: all four cards pending, seed input and buttons off. */
  begin(seed: number, mode: ScoreboardMode): void;
  /** Show what has finished so far (missing key = "Computing…"). */
  update(partial: PartialResults): void;
  /** The run is fully finished (result in, playback done). Enables the controls. */
  finish(partial: PartialResults): void;
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

  const note = document.createElement("p");
  note.className = "score-note-one";
  note.textContent = ONE_RUN_NOTE;
  const cite = document.createElement("p");
  cite.className = "muted score-cite";
  cite.textContent = CITATION;

  const form = document.createElement("form");
  form.className = "score-again";
  form.noValidate = true;
  const seedLabel = document.createElement("label");
  seedLabel.textContent = "Seed for the next run ";
  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.inputMode = "numeric";
  seedLabel.append(seedInput);
  const again = document.createElement("button");
  again.type = "submit";
  again.textContent = "Run again with another seed";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Back to the map";
  const message = document.createElement("p");
  message.className = "error";
  message.setAttribute("role", "alert");
  message.hidden = true;
  form.append(seedLabel, again, back, message);

  el.append(title, seedLine, cardsBox, note, cite, form);

  let mode: ScoreboardMode = "channel_plan";
  let shown = new Set<string>();

  function setControls(enabled: boolean): void {
    seedInput.disabled = !enabled;
    again.disabled = !enabled;
    back.disabled = !enabled;
  }

  function render(partial: PartialResults): void {
    const cards = buildCards(partial);
    cardsBox.replaceChildren(...cards.map((c) => renderCard(describeCard(c, mode))));
    for (const c of cards) {
      if (c.state !== "pending" && !shown.has(c.key)) {
        shown.add(c.key);
        deps.announce(`${c.label} is done.`);
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (again.disabled) return;
    const seed = parseSeed(seedInput.value);
    if (!seed.ok) {
      message.textContent = `${seed.error} No run was started.`;
      message.hidden = false;
      seedInput.focus();
      return;
    }
    message.hidden = true;
    deps.onRunAgain(seed.value);
  });
  back.addEventListener("click", () => {
    if (!back.disabled) deps.onBack();
  });

  return {
    el,
    begin(seed, m) {
      mode = m;
      shown = new Set();
      seedLine.textContent = `Seed of this run: ${seed}`;
      seedInput.value = String(nextSeed(seed));
      message.hidden = true;
      setControls(false);
      render({});
      el.hidden = false;
    },
    update(partial) {
      render(partial);
    },
    finish(partial) {
      render(partial);
      setControls(true);
    },
    hide() {
      el.hidden = true;
      setControls(false);
    },
  };
}
