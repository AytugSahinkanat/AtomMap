// Answer_Box on the Results_Scene (experience spec, Requirement 24). DOM only: every text comes
// from answer.ts, which reads the run. Text is set with textContent only.

import { SHOW_LIST_LABEL, SHOW_ON_MAP_LABEL, answerList, type Answer } from "../answer";

export interface AnswerBoxDeps {
  /** "Show them on the map": select the Answer_Set's plan (or draw the Hand_Pick). */
  onShow(answer: Answer): void;
  /** The box changed height (the list opened, a which line came): lay the map out again. */
  onResize(): void;
}

export interface AnswerBox {
  el: HTMLElement;
  show(answer: Answer, names?: ReadonlyMap<string, string>): void;
  /** The line for a clicked Point, or null to clear it. */
  setWhich(text: string | null): void;
  hide(): void;
}

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
  list.append(summary, listBody);
  row.append(showBtn, list);
  el.append(lab, headline, body, problems, which, row);

  let current: Answer | null = null;
  showBtn.addEventListener("click", () => {
    if (current?.source) deps.onShow(current);
  });
  list.addEventListener("toggle", () => deps.onResize());

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
      listBody.replaceChildren(
        ...answerList(answer, names).map((line) => {
          const p = document.createElement("p");
          p.textContent = line;
          return p;
        }),
      );
      el.hidden = false;
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
