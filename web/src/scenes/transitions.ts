// Scene transitions (experience spec, Requirement 4; steering design.md, Motion).
//
// Web Animations API only, no library. Every animation uses `fill: "backwards"`
// at most (the first frame during its delay), so when it ends the element is in
// its plain CSS state: the final layout is the same as a switch without motion.
//
// Outgoing parts are animated as snapshots: a copy is laid over the real part,
// the real DOM changes at once, and the copy fades out. So the app never has to
// wait for an exit animation before it changes state, and a run can start at once.

export const EXIT_MS = 260;
export const ENTER_MS = 460;
export const STAGGER_MS = 60;
export const CONTAINER_MS = 520;
/** Rise of an entering part, in CSS px. */
export const RISE_PX = 14;
/** Ease-out with no overshoot (all control points within 0..1). */
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Copy the pixels of every canvas of `from` into the matching canvas of `to` (cloneNode leaves them blank). */
function copyCanvases(from: Element, to: Element): void {
  const a = from.querySelectorAll("canvas");
  const b = to.querySelectorAll("canvas");
  if (from instanceof HTMLCanvasElement && to instanceof HTMLCanvasElement) copyCanvas(from, to);
  a.forEach((c, i) => {
    const d = b[i];
    if (d) copyCanvas(c, d);
  });
}

function copyCanvas(a: HTMLCanvasElement, b: HTMLCanvasElement): void {
  b.width = a.width;
  b.height = a.height;
  try {
    b.getContext("2d")?.drawImage(a, 0, 0);
  } catch {
    // An empty canvas (0 x 0) cannot be drawn. The copy stays blank, which is what it showed.
  }
}

/**
 * A copy of `el` laid exactly over it (fixed position), outside the app's flow.
 * The copy keeps the classes of its ancestors (as `display: contents` shells),
 * so the CSS rules that match on them still apply. It takes no input.
 */
export function snapshot(el: HTMLElement): HTMLElement | null {
  if (!visible(el)) return null;
  const rect = el.getBoundingClientRect();
  const copy = el.cloneNode(true) as HTMLElement;
  copyCanvases(el, copy);
  for (const n of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("[id]"))]) n.removeAttribute("id");
  const cs = getComputedStyle(el);
  Object.assign(copy.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    boxSizing: "border-box",
    pointerEvents: "none",
    transformOrigin: "50% 50%",
    zIndex: "40",
    background: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "var(--bg)" : cs.backgroundColor,
  });
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  // Shallow copies of the ancestors, so `.screen.map p` and the like still match.
  let inner: HTMLElement = copy;
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const shell = a.cloneNode(false) as HTMLElement;
    shell.removeAttribute("id");
    shell.removeAttribute("hidden");
    shell.style.cssText = "display: contents";
    shell.setAttribute("aria-hidden", "true");
    shell.append(inner);
    inner = shell;
  }
  inner.classList.add("transition-copy");
  document.body.append(inner);
  // Keep a handle on the outermost shell, so `remove()` takes the whole copy away.
  (copy as HTMLElement & { __root?: HTMLElement }).__root = inner;
  return copy;
}

function removeSnapshot(copy: HTMLElement): void {
  ((copy as HTMLElement & { __root?: HTMLElement }).__root ?? copy).remove();
}

const done = (a: Animation): Promise<void> => a.finished.then(() => undefined, () => undefined);

/** Fade the copies out while they scale down slightly and blur, then remove them. */
export function playExit(copies: (HTMLElement | null)[]): Promise<void> {
  const list = copies.filter((c): c is HTMLElement => c !== null);
  return Promise.all(
    list.map((c) =>
      done(
        c.animate(
          [
            { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
            { opacity: 0, transform: "scale(0.98)", filter: "blur(4px)" },
          ],
          { duration: EXIT_MS, easing: EASE_IN, fill: "forwards" },
        ),
      ).then(() => removeSnapshot(c)),
    ),
  ).then(() => undefined);
}

/** The parts come in one after another: each fades in while it rises, 60 ms apart. */
export function playEnter(parts: HTMLElement[], delayMs = 0): Promise<void> {
  const list = parts.filter(visible);
  return Promise.all(
    list.map((p, i) =>
      done(
        p.animate(
          [
            { opacity: 0, transform: `translateY(${RISE_PX}px)` },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: ENTER_MS, delay: delayMs + i * STAGGER_MS, easing: EASE_OUT, fill: "backwards" },
        ),
      ),
    ),
  ).then(() => undefined);
}

/**
 * Container transform: a copy of the card preview grows from where it is into
 * the box of `target` (the map), then the real map shows and the copy goes.
 * `target` is hidden (visibility) while the copy grows.
 */
export function playContainer(preview: HTMLCanvasElement, from: DOMRect, target: HTMLElement): Promise<void> {
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return Promise.resolve();
  // A panel box with the preview inside, kept at its own aspect (object-fit), so the points
  // never stretch while the box grows.
  const copy = document.createElement("div");
  copy.className = "container-copy";
  copy.setAttribute("aria-hidden", "true");
  const img = document.createElement("img");
  img.alt = "";
  try {
    img.src = preview.toDataURL();
  } catch {
    // No picture (an empty canvas): the box still grows, which is the point of the move.
  }
  copy.append(img);
  const box = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  Object.assign(copy.style, { position: "fixed", pointerEvents: "none", zIndex: "45", ...box(from) });
  document.body.append(copy);
  target.style.visibility = "hidden";
  const grow = copy.animate([box(from), box(to)], { duration: CONTAINER_MS, easing: EASE_OUT, fill: "forwards" });
  return done(grow).then(() => {
    target.style.visibility = "";
    return done(copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" })).then(() =>
      copy.remove(),
    );
  });
}
