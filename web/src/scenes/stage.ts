// The stage (experience spec, Requirements 1, 4 and 21): the app bar with the Scene_Steps, one
// scene at a time, the input lock while a transition runs, focus and the polite announcements.

import {
  CONTAINER_MS,
  ENTER_MS,
  EXIT_MS,
  playContainer,
  playEnter,
  playExit,
  prefersReducedMotion,
  snapshot,
  STAGGER_MS,
} from "./transitions";

export type StepScene = "choose" | "map" | "run" | "results";

export const STEPS: readonly { scene: StepScene; label: string }[] = [
  { scene: "choose", label: "Choose a map" },
  { scene: "map", label: "Read the map" },
  { scene: "run", label: "Run" },
  { scene: "results", label: "Results" },
];

/** The input lock ends after this long even if an animation never settles. */
export const LOCK_GUARD_MS = 1200;

export interface Swap {
  /** Elements on screen now that go away (they are copied and faded out). */
  exit: HTMLElement[];
  /** Change the DOM to the new scene. Runs at once, before any animation. */
  apply(): void;
  /** Elements of the new scene that come in, in order (read after `apply`). */
  enter(): HTMLElement[];
  /** The heading to focus and the name to announce. */
  heading(): HTMLElement | null;
  announce: string;
  /** Optional container transform: the card preview grows into this box. */
  container?: { from: HTMLCanvasElement; rect: DOMRect; to: () => HTMLElement };
  /** Called after `apply`, before measuring for the container transform (lay the map out). */
  afterApply?(): void;
}

export interface Stage {
  /** The app shell to mount into the page. */
  el: HTMLElement;
  /** Where the scene element goes. */
  slot: HTMLElement;
  /** True while a transition runs; input that would start another one or a run is ignored. */
  readonly locked: boolean;
  /** Run a scene change, with motion unless the visitor asked for reduced motion. */
  swap(s: Swap): Promise<void>;
  /**
   * Two steps, for a change that someone else makes to the DOM: copy the outgoing parts now,
   * then, after the change, call the returned function with the parts that came in.
   */
  prepare(exit: HTMLElement[]): (enter: HTMLElement[], heading: HTMLElement | null, announce: string) => Promise<void>;
  /** Called once when the current transition has ended (at once when none runs). */
  whenUnlocked(fn: () => void): void;
  /** Show the Scene_Steps with this step current, or hide them (Choose_Scene). */
  setStep(scene: StepScene | null): void;
  announce(text: string): void;
}

export function createStage(): Stage {
  const el = document.createElement("div");
  el.className = "app";

  const bar = document.createElement("header");
  bar.className = "app-bar";
  const brand = document.createElement("a");
  brand.className = "app-brand";
  brand.href = "#/";
  brand.textContent = "AtomMap";
  const steps = document.createElement("nav");
  steps.className = "scene-steps";
  steps.setAttribute("aria-label", "Steps");
  const ol = document.createElement("ol");
  const items = STEPS.map((s, i) => {
    const li = document.createElement("li");
    li.dataset.scene = s.scene;
    const num = document.createElement("span");
    num.className = "step-num";
    num.textContent = String(i + 1);
    // Step 1 is a link back to the Choose_Scene. The others say where the visit is.
    const label = s.scene === "choose" ? document.createElement("a") : document.createElement("span");
    if (label instanceof HTMLAnchorElement) label.href = "#/";
    label.className = "step-label";
    label.textContent = s.label;
    li.append(num, " ", label);
    ol.append(li);
    return li;
  });
  steps.append(ol);
  steps.hidden = true;
  const results = document.createElement("a");
  results.className = "results-link";
  results.href = "#/results";
  results.textContent = "What we measured";
  bar.append(brand, steps, results);

  const slot = document.createElement("div");
  slot.className = "stage";

  const live = document.createElement("div");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");

  // Takes clicks and taps while a transition runs (Requirement 4.4).
  const shield = document.createElement("div");
  shield.className = "stage-shield";
  shield.hidden = true;

  el.append(bar, slot, live, shield);

  let locked = false;
  // Enter and Space would start another transition or a run: ignored while locked.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!locked) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  function announce(text: string): void {
    // Cleared first, so the same text is read again.
    live.textContent = "";
    requestAnimationFrame(() => (live.textContent = text));
  }

  function focus(h: HTMLElement | null): void {
    if (!h) return;
    if (h.tabIndex < 0 && !h.hasAttribute("tabindex")) h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }

  let waiting: (() => void)[] = [];
  function unlock(): void {
    locked = false;
    shield.hidden = true;
    const fns = waiting;
    waiting = [];
    for (const fn of fns) fn();
  }

  async function play(
    copies: (HTMLElement | null)[],
    parts: HTMLElement[],
    container: Swap["container"] | undefined,
  ): Promise<void> {
    locked = true;
    shield.hidden = false;
    const guard = new Promise<void>((ok) => setTimeout(ok, LOCK_GUARD_MS));
    const jobs: Promise<void>[] = [playExit(copies)];
    const delay = copies.some((c) => c !== null) ? EXIT_MS : 0;
    jobs.push(playEnter(parts, delay));
    if (container) jobs.push(playContainer(container.from, container.rect, container.to()));
    await Promise.race([Promise.all(jobs), guard]);
    unlock();
  }

  async function swap(s: Swap): Promise<void> {
    const motion = !prefersReducedMotion();
    const copies = motion ? s.exit.map(snapshot) : [];
    s.apply();
    s.afterApply?.();
    focus(s.heading());
    announce(s.announce);
    if (!motion) return;
    await play(copies, s.enter(), s.container);
  }

  function prepare(exit: HTMLElement[]) {
    const motion = !prefersReducedMotion();
    const copies = motion ? exit.map(snapshot) : [];
    return async (enter: HTMLElement[], heading: HTMLElement | null, text: string): Promise<void> => {
      focus(heading);
      announce(text);
      if (!motion) return;
      await play(copies, enter, undefined);
    };
  }

  return {
    el,
    slot,
    get locked() {
      return locked;
    },
    swap,
    prepare,
    whenUnlocked(fn) {
      if (locked) waiting.push(fn);
      else fn();
    },
    setStep(scene) {
      steps.hidden = scene === null || scene === "choose";
      for (const li of items) {
        const current = li.dataset.scene === scene;
        li.classList.toggle("is-current", current);
        if (current) li.setAttribute("aria-current", "step");
        else li.removeAttribute("aria-current");
      }
    },
    announce,
  };
}

/** The longest a transition takes with `n` entering parts (for tests and the layout check). */
export function transitionLength(n: number, container = false): number {
  return Math.max(EXIT_MS + ENTER_MS + STAGGER_MS * Math.max(0, n - 1), container ? CONTAINER_MS + 120 : 0);
}
