// The lab entrance (experience spec, Requirement 15.2; design "Lab", Entrance): about 1 s, calm, no
// bounce. The screen fades to the lab colour, an Erlenmeyer flask draws its outline, the teal liquid
// rises, three small bubbles float up, and "ENTERING THE LAB" settles in under it. Then the layer
// fades out while the lab panels come in. Web Animations API only; nothing stays animated after.
// With reduced motion there is no entrance: the lab appears at once.

import { EASE_OUT, prefersReducedMotion } from "../scenes/transitions";

const SVG = "http://www.w3.org/2000/svg";
export const LAB_BG = "#07080f";
const ACCENT = "#7f77dd";
const TEAL = "#5dcaa5";

/** The timeline, in ms. */
export const ENTRANCE = {
  cover: 200, // fade to the lab colour
  outlineAt: 150,
  outline: 300,
  liquidAt: 400,
  liquid: 300,
  bubblesAt: 600,
  bubble: 400,
  bubbleGap: 80,
  textAt: 600,
  text: 300,
  leaveAt: 1000, // the layer starts to fade out, the panels come in
  leave: 240,
} as const;

// The flask in a 64 x 64 box: lip, neck, cone with rounded foot.
const FLASK_OUTLINE = "M25 6H39 M27.5 6V24L11.5 51.6A3 3 0 0 0 14.1 56.2H49.9A3 3 0 0 0 52.5 51.6L36.5 24V6";
const FLASK_INSIDE = "M27.5 6V24L11.5 51.6A3 3 0 0 0 14.1 56.2H49.9A3 3 0 0 0 52.5 51.6L36.5 24V6Z";
const BUBBLES: [number, number, number][] = [
  [28.5, 50, 1.7],
  [33, 47, 1.3],
  [36.5, 51, 1.5],
];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const done = (a: Animation): Promise<void> => a.finished.then(() => undefined, () => undefined);
const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * Play the entrance over the page. `onCovered` is called once the screen is the lab colour (at once
 * with reduced motion): it switches the page to the lab underneath. The promise resolves when the
 * layer starts to fade out, so the caller can bring the panels in; the layer removes itself.
 */
export async function playEntrance(onCovered: () => void): Promise<void> {
  if (prefersReducedMotion()) {
    onCovered();
    return;
  }
  const layer = document.createElement("div");
  layer.className = "lab-entrance";
  layer.setAttribute("aria-hidden", "true");
  const svg = el("svg", { viewBox: "0 0 64 64", width: 112, height: 112, fill: "none" });
  const clipId = `lab-flask-${Math.random().toString(36).slice(2, 8)}`;
  const defs = el("defs", {});
  const clip = el("clipPath", { id: clipId });
  clip.append(el("path", { d: FLASK_INSIDE }));
  defs.append(clip);
  const liquidGroup = el("g", { "clip-path": `url(#${clipId})` });
  const liquid = el("rect", { x: 0, y: 36, width: 64, height: 21, fill: TEAL, opacity: 0.85 });
  liquid.style.transformBox = "fill-box";
  liquid.style.transformOrigin = "50% 100%";
  liquidGroup.append(liquid);
  const outline = el("path", {
    d: FLASK_OUTLINE,
    stroke: ACCENT,
    "stroke-width": 1.5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    pathLength: 1,
    "stroke-dasharray": 1,
  });
  const bubbles = BUBBLES.map(([cx, cy, r]) => el("circle", { cx, cy, r, fill: TEAL }));
  svg.append(defs, liquidGroup, ...bubbles, outline);
  const text = document.createElement("p");
  text.className = "lab-entrance-text";
  text.textContent = "ENTERING THE LAB";
  layer.append(svg, text);
  document.body.append(layer);

  const T = ENTRANCE;
  const both = { easing: EASE_OUT, fill: "both" as FillMode };
  const cover = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.cover, easing: "linear", fill: "forwards" });
  outline.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { ...both, duration: T.outline, delay: T.outlineAt });
  liquid.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { ...both, duration: T.liquid, delay: T.liquidAt });
  bubbles.forEach((b, i) =>
    b.animate(
      [
        { opacity: 0, transform: "translateY(0)" },
        { opacity: 1, transform: "translateY(-8px)", offset: 0.3 },
        { opacity: 0, transform: "translateY(-24px)" },
      ],
      { duration: T.bubble, delay: T.bubblesAt + i * T.bubbleGap, easing: "ease-out", fill: "both" },
    ),
  );
  text.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { ...both, duration: T.text, delay: T.textAt });

  // A hidden tab may hold animations back: the timers make sure the lab still opens.
  await Promise.race([done(cover), wait(T.cover + 150)]);
  onCovered();
  await wait(T.leaveAt - T.cover);
  // The layer fades out on its own; the panels come in under it now.
  void done(layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.leave, easing: "ease-in", fill: "forwards" })).then(() => layer.remove());
  setTimeout(() => layer.remove(), T.leave + 400);
}
