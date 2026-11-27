// Choose_Scene (experience spec, Requirement 2): the title, the question every map asks, and one
// card per map with a live preview, a one-line description and its chips. A click on the card
// (outside its chips) opens the map. Text is set with textContent only.

import { YOUR_R_MAX, YOUR_R_MIN } from "../settings";
import { parseR } from "../your-map/editor";
import { drawPreview } from "./card-preview";
import { getChips, MAPS, MapGateError, onChips, setChips, type ChipState, type MapEntry } from "./maps";
import type { MapSlug } from "./router";
import { readToday } from "../daily/today";

export const CHOOSE_TITLE = "Choose a map";
export const CHOOSE_QUESTION =
  "Every map asks the same question: how many points can you pick, when no two that are too close may both be picked?";

export interface ChooseDeps {
  /** The visitor opened a map. `preview` is the card's preview canvas, for the container transform. */
  onOpen(slug: MapSlug, preview: HTMLCanvasElement): void;
}

export interface ChooseScene {
  el: HTMLElement;
  heading: HTMLElement;
  /** Parts that come in one after another when the scene opens. */
  enterParts(): HTMLElement[];
  /** Redraw every card (its data may have changed, for example Your map's points). */
  refresh(): void;
}

interface Card {
  entry: MapEntry;
  el: HTMLElement;
  open: HTMLButtonElement;
  desc: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  /** The note line (Local_Progress on Today's map), hidden when empty. */
  note: HTMLElement;
  setChipValue(s: ChipState): void;
  token: number;
}

function radioChip(
  legend: string,
  name: string,
  options: { value: string; label: string }[],
  initial: string,
  onChange: (v: string) => void,
): { el: HTMLFieldSetElement; set(v: string): void } {
  const fs = document.createElement("fieldset");
  fs.className = "chip-group";
  const lg = document.createElement("legend");
  lg.textContent = legend;
  fs.append(lg);
  const inputs: HTMLInputElement[] = [];
  for (const o of options) {
    const label = document.createElement("label");
    label.className = "chip";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = o.value;
    input.checked = o.value === initial;
    input.addEventListener("change", () => input.checked && onChange(o.value));
    const text = document.createElement("span");
    text.textContent = o.label;
    label.append(input, text);
    inputs.push(input);
    fs.append(label);
  }
  return { el: fs, set: (v) => inputs.forEach((i) => (i.checked = i.value === v)) };
}

export function createChooseScene(deps: ChooseDeps): ChooseScene {
  const el = document.createElement("main");
  el.className = "scene choose";
  el.setAttribute("aria-labelledby", "choose-title");
  const heading = document.createElement("h1");
  heading.id = "choose-title";
  heading.tabIndex = -1;
  heading.textContent = CHOOSE_TITLE;
  const question = document.createElement("p");
  question.className = "choose-question";
  question.textContent = CHOOSE_QUESTION;
  const grid = document.createElement("div");
  grid.className = "map-cards";
  el.append(heading, question, grid);

  const cards: Card[] = MAPS.map((entry) => buildCard(entry));
  for (const c of cards) grid.append(c.el);

  function buildCard(entry: MapEntry): Card {
    const art = document.createElement("article");
    art.className = "map-card";
    art.dataset.slug = entry.slug;
    const title = document.createElement("h2");
    title.className = "map-card-title";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "map-card-open";
    open.textContent = entry.name;
    open.setAttribute("aria-label", `Open ${entry.name}`);
    title.append(open);
    const desc = document.createElement("p");
    desc.className = "map-card-desc";
    const box = document.createElement("div");
    box.className = "map-card-preview";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const status = document.createElement("span");
    status.className = "map-card-status";
    status.textContent = "Loading the map…";
    box.append(canvas, status);
    const chipBox = document.createElement("div");
    chipBox.className = "map-card-chips";
    const s0 = getChips(entry.slug);
    let setChipValue: (s: ChipState) => void = () => {};
    if (entry.chip === "walls") {
      const g = radioChip("Walls", `chip-${entry.slug}-walls`, [
        { value: "off", label: "Walls off" },
        { value: "on", label: "Walls on" },
      ], s0.walls ? "on" : "off", (v) => setChips(entry.slug, { walls: v === "on" }));
      chipBox.append(g.el);
      setChipValue = (s) => g.set(s.walls ? "on" : "off");
    } else if (entry.chip === "distance") {
      const g = radioChip("Distance", `chip-${entry.slug}-distance`, [
        { value: "walking", label: "Walking" },
        { value: "straight", label: "Straight line" },
      ], s0.walking ? "walking" : "straight", (v) => setChips(entry.slug, { walking: v === "walking" }));
      chipBox.append(g.el);
      setChipValue = (s) => g.set(s.walking ? "walking" : "straight");
    } else if (entry.chip === "r") {
      const label = document.createElement("label");
      label.className = "chip chip-number";
      const text = document.createElement("span");
      text.textContent = "r (metres)";
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(YOUR_R_MIN);
      input.max = String(YOUR_R_MAX);
      input.step = "any";
      input.inputMode = "decimal";
      input.value = String(s0.r);
      const msg = document.createElement("span");
      msg.className = "chip-message";
      msg.setAttribute("role", "status");
      input.addEventListener("input", () => {
        const r = parseR(input.value);
        msg.textContent = r.ok ? "" : r.error;
        if (r.ok) setChips(entry.slug, { r: r.value });
      });
      label.append(text, input);
      chipBox.append(label, msg);
      setChipValue = (s) => {
        if (document.activeElement !== input) input.value = String(s.r);
      };
    }
    const note = document.createElement("p");
    note.className = "map-card-note muted";
    note.hidden = true;
    art.append(title, desc, box, chipBox, note);
    if (entry.credit) {
      const credit = document.createElement("p");
      credit.className = "map-card-credit";
      credit.textContent = entry.credit;
      art.append(credit);
    }
    const card: Card = { entry, el: art, open, desc, canvas, status, note, setChipValue, token: 0 };
    open.addEventListener("click", () => {
      if (!open.disabled) deps.onOpen(entry.slug, canvas);
    });
    // The whole card opens the map, except its chips (they are their own controls).
    art.addEventListener("click", (e) => {
      const t = e.target as Element;
      if (t.closest(".map-card-chips") || t.closest(".map-card-open")) return;
      open.click();
    });
    return card;
  }

  async function draw(card: Card): Promise<void> {
    const token = ++card.token;
    const s = getChips(card.entry.slug);
    card.setChipValue(s);
    const line = card.entry.note?.() ?? null;
    card.note.textContent = line ?? "";
    card.note.hidden = line === null;
    try {
      const data = await card.entry.load(s);
      if (token !== card.token) return;
      card.desc.textContent = data.description;
      card.open.setAttribute("aria-label", `Open ${card.entry.name}, ${data.count} points`);
      card.open.disabled = false;
      card.status.hidden = true;
      drawPreview(card.canvas, data);
    } catch (e) {
      if (token !== card.token) return;
      // A US map whose Map_Check is for another version of its data is not offered (Requirement 13.5).
      if (e instanceof MapGateError) {
        card.el.hidden = true;
        card.open.disabled = true;
        return;
      }
      // The map cannot be opened without its data. The other cards are not touched.
      card.status.hidden = false;
      card.status.textContent = `This map could not be loaded. ${e instanceof Error ? e.message : String(e)}`;
      card.open.disabled = true;
    }
  }

  onChips((slug) => {
    const c = cards.find((k) => k.entry.slug === slug);
    if (c) void draw(c);
  });
  // The previews take their size from the layout, so draw again when the cards change size.
  const ro = new ResizeObserver(() => {
    if (el.isConnected) for (const c of cards) void draw(c);
  });
  ro.observe(grid);

  return {
    el,
    heading,
    enterParts: () => [heading, question, ...cards.map((c) => c.el)],
    refresh() {
      readToday(); // "today" is read once each time the Choose_Scene opens
      for (const c of cards) void draw(c);
    },
  };
}
