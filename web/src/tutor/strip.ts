// Tutor strip (tutor spec, task 5.4). The only DOM code of the Tutor.
// It shows text built by sentences.ts and tells the map which Points to ring.
// No algorithm and no sentence text beyond labels: all wording comes from
// sentences.ts. Text is set with textContent, never innerHTML.
// "Why this point": showWhy and leaveWhy (task 6.3).

import type { EngineName } from "../scoreboard-model";
import { whyFacts, type Facts } from "./facts";
import { buildSteps, buildWhy, NON_HYBRID_SENTENCE, type Step } from "./sentences";

export interface StripDeps {
  /** Ids of the Points to ring. An empty list clears the ring. */
  onRing(ids: string[]): void;
}

export interface Strip {
  el: HTMLElement;
  /** Before a run: the label first, then the sentences. */
  showIdle(label: string, text: string[]): void;
  /** After a run: the finished line first, then one Step at a time. */
  showFinished(firstLine: string, facts: Facts, plan: EngineName, focus: boolean): void;
  /** Explain one Point in place of the Step. Only while Steps are shown. */
  showWhy(id: string): void;
  /** Leave the Why_Answer and restore the Step and its ring. */
  leaveWhy(): void;
  /** During a run: the run bar is shown in the place of the Tutor. */
  hide(): void;
}

export function createStrip(deps: StripDeps): Strip {
  const el = document.createElement("section");
  el.className = "tutor-strip";
  el.setAttribute("aria-label", "Tutor");
  el.hidden = true;

  const textCol = document.createElement("div");
  textCol.className = "tutor-text";
  const first = document.createElement("p");
  first.className = "tutor-first";
  first.tabIndex = -1;
  const body = document.createElement("p");
  body.className = "tutor-body";
  textCol.append(first, body);

  const controls = document.createElement("div");
  controls.className = "tutor-controls";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "tutor-back";
  back.textContent = "Back";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "tutor-next";
  next.textContent = "Next";
  const counter = document.createElement("span");
  counter.className = "tutor-counter";
  const backToStep = document.createElement("button");
  backToStep.type = "button";
  backToStep.className = "tutor-back-to-step";
  backToStep.hidden = true;
  controls.append(back, next, backToStep, counter);

  // Visually hidden live region. The visible text is not live, so nothing is read twice.
  const live = document.createElement("div");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  el.append(textCol, controls, live);

  let steps: Step[] = [];
  let index = 0;
  let currentFacts: Facts | null = null;
  let whyId: string | null = null;

  function ring(ids: string[]): void {
    deps.onRing(ids);
  }

  function renderStep(announce: boolean): void {
    const step = steps[index];
    const text = step.sentences.join(" ");
    body.textContent = text;
    counter.textContent = `step ${index + 1} of ${steps.length}`;
    back.setAttribute("aria-disabled", String(index === 0));
    next.setAttribute("aria-disabled", String(index === steps.length - 1));
    if (announce) live.textContent = text;
    ring(step.ring);
  }

  function go(delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= steps.length) return;
    index = to;
    renderStep(true);
  }

  back.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));

  function showControls(on: boolean): void {
    controls.hidden = !on;
  }

  function showStepButtons(on: boolean): void {
    back.hidden = !on;
    next.hidden = !on;
    backToStep.hidden = on;
  }

  function leave(): void {
    if (whyId === null) return;
    whyId = null;
    showStepButtons(true);
    if (steps.length > 0) renderStep(true);
  }

  backToStep.addEventListener("click", leave);

  return {
    el,

    showIdle(label, text) {
      whyId = null;
      showStepButtons(true);
      currentFacts = null;
      steps = [];
      index = 0;
      el.hidden = false;
      first.textContent = label;
      body.textContent = text.join(" ");
      live.textContent = "";
      showControls(false);
      ring([]);
    },

    showFinished(firstLine, facts, plan, focus) {
      whyId = null;
      showStepButtons(true);
      currentFacts = facts;
      el.hidden = false;
      first.textContent = firstLine;
      live.textContent = "";
      index = 0;
      if (plan !== "Hybrid") {
        // Requirement 3.2: the first line and one sentence, no Steps, no ring.
        steps = [];
        body.textContent = NON_HYBRID_SENTENCE;
        showControls(false);
        ring([]);
      } else {
        steps = buildSteps(facts, plan);
        if (steps.length === 0) {
          body.textContent = "";
          showControls(false);
          ring([]);
        } else {
          showControls(true);
          renderStep(false);
        }
      }
      if (focus) first.focus();
    },

    showWhy(id) {
      if (!currentFacts || steps.length === 0) return;
      const answer = buildWhy(whyFacts(currentFacts, id));
      const text = answer.sentences.join(" ");
      whyId = id;
      body.textContent = text;
      backToStep.textContent = `back to step ${index + 1}`;
      counter.textContent = `about ${id}`;
      showStepButtons(false);
      live.textContent = text;
      ring(answer.ring);
    },

    leaveWhy: leave,

    hide() {
      whyId = null;
      showStepButtons(true);
      currentFacts = null;
      steps = [];
      index = 0;
      el.hidden = true;
      live.textContent = "";
      ring([]);
    },
  };
}
