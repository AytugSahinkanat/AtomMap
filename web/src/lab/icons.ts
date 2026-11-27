// The lab's four line icons (experience spec, Requirement 15.4; design "Lab", Icons): flask, sliders,
// test tubes and gauge. Drawn by hand for this app as 16 x 16 inline SVG paths, stroke currentColor,
// so they take the colour of their text. No icon set is copied, so no licence file is needed.

const SVG = "http://www.w3.org/2000/svg";

export type IconName = "flask" | "sliders" | "tubes" | "gauge";

interface Shape {
  /** Stroked paths. */
  paths: string[];
  /** Small filled circles [cx, cy, r] (knobs, the gauge's hub). */
  dots?: [number, number, number][];
}

const SHAPES: Record<IconName, Shape> = {
  // An Erlenmeyer flask: lip, neck, cone, and the liquid line.
  flask: {
    paths: ["M5.5 1.75H10.5", "M6.6 1.75V6.1L2.7 12.9A1 1 0 0 0 3.55 14.4H12.45A1 1 0 0 0 13.3 12.9L9.4 6.1V1.75", "M4.4 10.4H11.6"],
  },
  // Three slider rails with their knobs.
  sliders: {
    paths: ["M2 4H14", "M2 8H14", "M2 12H14"],
    dots: [[5.5, 4, 1.6], [10.5, 8, 1.6], [7, 12, 1.6]],
  },
  // Two test tubes with their lips and the liquid level.
  tubes: {
    paths: ["M3.6 2.25V11.4A1.6 1.6 0 0 0 6.8 11.4V2.25", "M9.2 2.25V11.4A1.6 1.6 0 0 0 12.4 11.4V2.25", "M2.6 2.25H7.8", "M8.2 2.25H13.4", "M3.6 8.2H6.8", "M9.2 5.8H12.4"],
  },
  // A gauge: the dial arc, three ticks and the needle.
  gauge: {
    paths: ["M2.4 11.6A5.8 5.8 0 1 1 13.6 11.6", "M8 4.1V5.3", "M3.9 6.6L4.8 7.3", "M12.1 6.6L11.2 7.3", "M8 11.2L10.9 6.9"],
    dots: [[8, 11.2, 1.1]],
  },
};

/** One icon as an SVG element, hidden from screen readers (the text next to it says what it is). */
export function icon(name: IconName, size = 16, className = "lab-icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  const s = SHAPES[name];
  for (const d of s.paths) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  for (const [cx, cy, r] of s.dots ?? []) {
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", "currentColor");
    c.setAttribute("stroke", "none");
    svg.append(c);
  }
  return svg;
}
