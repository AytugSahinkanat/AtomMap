// Answer_Box on the Results_Scene (experience spec, Requirement 24). DOM only: every text comes
// from answer.ts, which reads the run. Text is set with textContent only.

import { SHOW_LIST_LABEL, SHOW_ON_MAP_LABEL, answerGroups, type Answer } from "../answer";

export interface AnswerBoxDeps {
  /** "Show them on the map": select the Answer_Set's plan (or draw the Hand_Pick). */
  onShow(answer: Answer): void;
  /** The box changed height (the list opened, a which line came): lay the map out again. */
  onResize(): void;
}

export interface AnswerBox {
  el: HTMLElement;
  show(answer: Answer, names?: ReadonlyMap<string, string>): void;
  /**
   * The page is overflow px taller than the window with the list open: make the list that much
   * shorter (it scrolls), but not below about three lines. 0 or less resets it to its CSS height.
   */
  fitList(overflow: number): void;
  /** True while "Show the list" is open. */
  readonly listOpen: boolean;
  /** The line for a clicked Point, or null to clear it. */
  setWhich(text: string | null): void;
  hide(): void;
}

/** The opened list never gets shorter than about three lines. */
const LIST_MIN_PX = 52;

export function createAnswerBox(deps: AnswerBoxDeps): AnswerBox {
  const el = document.createElement("section");
  el.className = "answer-box";
  el.setAttribute("aria-label", "Answer");
  el.hidden = true;
  const lab = document.createElement("p");
  lab.className = "answer-lab";
  const headline = document.createElement("p");
  headline.className = "answer-headline num";
  const body = document.createElement("p");
  body.className = "answer-body num";
  const found = document.createElement("span");
  const maximal = document.createElement("span");
  const honesty = document.createElement("span");
  honesty.className = "muted";
  body.append(found, " ", maximal, " ", honesty);
  const problems = document.createElement("p");
  problems.className = "answer-problems";
  const which = document.createElement("p");
  which.className = "answer-which num";
  which.setAttribute("role", "status");
  const row = document.createElement("div");
  row.className = "answer-row";
  const showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.textContent = SHOW_ON_MAP_LABEL;
  const list = document.createElement("details");
  list.className = "answer-list";
  const summary = document.createElement("summary");
  summary.textContent = SHOW_LIST_LABEL;
  const listBody = document.createElement("div");
  listBody.className = "answer-list-body num";
  listBody.setAttribute("role", "region");
  listBody.tabIndex = 0;
  list.append(summary, listBody);
  row.append(showBtn, list);
  el.append(lab, headline, body, problems, which, row);

  let current: Answer | null = null;
  showBtn.addEventListener("click", () => {
    if (current?.source) deps.onShow(current);
  });
  list.addEventListener("toggle", () => {
    if (!list.open) listBody.style.maxHeight = "";
    deps.onResize();
  });

  return {
    el,
    show(answer, names) {
      current = answer;
      lab.textContent = answer.labLabel ?? "";
      lab.hidden = !answer.labLabel;
      headline.textContent = answer.headline;
      found.textContent = answer.found;
      maximal.textContent = answer.maximal ?? "";
      honesty.textContent = answer.honesty;
      problems.textContent = answer.problems.join(" ");
      problems.hidden = answer.problems.length === 0;
      which.textContent = "";
      which.hidden = true;
      row.hidden = answer.source === null;
      list.open = false;
      // One list item per point, so a screen reader can step through and count them. The area
      // scrolls on its own and takes focus, so the keyboard can scroll it too.
      listBody.setAttribute("aria-label", `The ${answer.count} points of the answer`);
      listBody.replaceChildren(
        ...answerGroups(answer, names).flatMap((g) => {
          const ul = document.createElement("ul");
          ul.className = "answer-list-items";
          for (const item of g.items) {
            const li = document.createElement("li");
            li.textContent = item;
            ul.append(li);
          }
          if (g.title === null) return [ul];
          const h = document.createElement("p");
          h.className = "answer-list-head";
          h.textContent = `${g.title} (${g.items.length})`;
          ul.setAttribute("aria-label", g.title);
          return [h, ul];
        }),
      );
      el.hidden = false;
    },
    get listOpen() {
      return !el.hidden && list.open;
    },
    fitList(overflow) {
      if (overflow <= 0 || !list.open) {
        if (overflow <= 0 && !list.open) listBody.style.maxHeight = "";
        return;
      }
      const now = listBody.getBoundingClientRect().height;
      listBody.style.maxHeight = `${Math.max(LIST_MIN_PX, Math.floor(now - overflow))}px`;
    },
    setWhich(text) {
      const was = which.hidden;
      which.textContent = text ?? "";
      which.hidden = text === null;
      if (was !== which.hidden) deps.onResize();
    },
    hide() {
      current = null;
      el.hidden = true;
      list.open = false;
    },
  };
}
