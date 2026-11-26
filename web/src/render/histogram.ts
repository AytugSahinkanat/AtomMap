// Shot_Histogram (experience spec, Requirement 7.3): one bar per atom of the Group on the atoms,
// with how many of the replayed shots kept it. The counts come from the AtomsView, so the bars
// and the glow on the map always show the same numbers. DOM only, no canvas. Text via textContent.

import type { AtomsView } from "./shot-replay";

export interface Histogram {
  el: HTMLElement;
  /** Show the Group of this view, or keep the last Group when `view` is null. */
  update(view: AtomsView | null, ids: readonly string[]): void;
  /** Clear it (a new run). */
  clear(): void;
}

/** The accessible label: every bar in words. */
export function histogramLabel(view: AtomsView, ids: readonly string[]): string {
  if (view.total === 0) return `Shot histogram: ${view.group.length} atoms, no shots replayed yet.`;
  const bars = view.group.map((p, k) => `${ids[p] ?? p} ${view.counts[k]} of ${view.shown}`).join(", ");
  return `Shot histogram, ${view.shown} of ${view.total} shots replayed: ${bars}.`;
}

export function createHistogram(): Histogram {
  const el = document.createElement("figure");
  el.className = "shot-hist";
  el.hidden = true;
  const caption = document.createElement("figcaption");
  caption.className = "shot-hist-caption";
  const bars = document.createElement("div");
  bars.className = "shot-hist-bars";
  bars.setAttribute("role", "img");
  el.append(caption, bars);

  let key = "";
  let cells: { fill: HTMLElement; num: HTMLElement; col: HTMLElement }[] = [];
  let lastLabel = "";

  function build(group: readonly number[]): void {
    bars.replaceChildren();
    cells = group.map(() => {
      const col = document.createElement("div");
      col.className = "shot-hist-col";
      const track = document.createElement("div");
      track.className = "shot-hist-track";
      const fill = document.createElement("div");
      fill.className = "shot-hist-fill";
      track.append(fill);
      const num = document.createElement("span");
      num.className = "shot-hist-num";
      col.append(track, num);
      bars.append(col);
      return { fill, num, col };
    });
  }

  return {
    el,
    update(view, ids) {
      if (view === null) return; // the last Group stays until the next one starts
      const k = view.group.join(",");
      if (k !== key) {
        key = k;
        build(view.group);
      }
      el.hidden = false;
      const n = view.shown;
      view.group.forEach((_, i) => {
        const c = view.counts[i] ?? 0;
        const share = n === 0 ? 0 : c / n;
        cells[i].fill.style.height = `${Math.round(share * 100)}%`;
        cells[i].num.textContent = String(c);
        cells[i].col.title = `${c} of ${n}`;
      });
      caption.textContent =
        view.total === 0
          ? `Atoms on the simulator: ${view.group.length}`
          : `Shots that kept each atom: ${n} of ${view.total} replayed`;
      // The label is only rewritten when the text changes, which is a few times a second at most.
      const label = histogramLabel(view, ids);
      if (label !== lastLabel) {
        lastLabel = label;
        bars.setAttribute("aria-label", label);
      }
    },
    clear() {
      key = "";
      cells = [];
      lastLabel = "";
      bars.replaceChildren();
      bars.removeAttribute("aria-label");
      el.hidden = true;
    },
  };
}
