// Legend for the final map. Plain words. Every entry has a shape AND a colour,
// and the text names both, so the legend does not rely on colour alone.
// The glyphs match render/sprites.ts and render/dynamic-layer.ts.
// `legendEntries` is pure and tested. `renderLegend` only builds DOM from it.

import { AMBER_COLOUR, GREY_COLOUR, TEAL_COLOUR, TEXT_COLOUR } from "../render/sprites";
import { ACCENT_COLOUR } from "../settings";

export type LegendGlyph =
  | "circle"
  | "triangle"
  | "square"
  | "hollow"
  | "filled"
  | "outlined-lock"
  | "dashed-ring";

export interface LegendEntry {
  glyph: LegendGlyph;
  colour: string;
  /** Plain words, names the shape and the meaning. */
  text: string;
}

export type LegendMode = "channel_plan" | "place";

/** `uncovered`: the plan on the map is atoms alone, which also marks the points it left uncovered. */
export function legendEntries(mode: LegendMode, uncovered = false): LegendEntry[] {
  const out: LegendEntry[] = [];
  if (mode === "channel_plan") {
    out.push(
      { glyph: "circle", colour: ACCENT_COLOUR, text: "Purple circle: channel 1" },
      { glyph: "triangle", colour: AMBER_COLOUR, text: "Amber triangle: channel 6" },
      { glyph: "square", colour: TEAL_COLOUR, text: "Teal square: channel 11" },
      {
        glyph: "hollow",
        colour: GREY_COLOUR,
        text: "Hollow grey circle: 5 GHz only",
      },
    );
  } else {
    out.push(
      { glyph: "circle", colour: ACCENT_COLOUR, text: "Purple circle: picked" },
      { glyph: "hollow", colour: GREY_COLOUR, text: "Hollow grey circle: not picked" },
    );
  }
  out.push(
    {
      glyph: "filled",
      colour: TEXT_COLOUR,
      text: "Filled shape: picked by the atoms",
    },
    {
      glyph: "outlined-lock",
      colour: TEXT_COLOUR,
      text: "Outlined shape, padlock: classical pick, not atoms",
    },
  );
  if (uncovered) {
    out.push({ glyph: "dashed-ring", colour: TEXT_COLOUR, text: "Dashed ring: gap left by atoms alone" });
  }
  return out;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** A 20 x 20 icon. Decorative: the text next to it says the same. */
export function glyphSvg(entry: LegendEntry): SVGSVGElement {
  const svg = svgEl("svg", { width: "20", height: "20", viewBox: "-10 -10 20 20", "aria-hidden": "true" });
  const c = entry.colour;
  const filled = { fill: c, stroke: "none" };
  const outline = { fill: "none", stroke: c, "stroke-width": "1.6" };
  switch (entry.glyph) {
    case "circle":
      svg.append(svgEl("circle", { r: "5", ...filled }));
      break;
    case "triangle":
      // Same proportions as the canvas triangle (height 1.15, half-width 0.95 x 1.15).
      svg.append(svgEl("polygon", { points: "0,-5.75 5.5,4 -5.5,4", ...filled }));
      break;
    case "square":
      svg.append(svgEl("rect", { x: "-4.5", y: "-4.5", width: "9", height: "9", ...filled }));
      break;
    case "hollow":
      svg.append(svgEl("circle", { r: "5", ...outline }));
      break;
    case "filled":
      svg.append(svgEl("circle", { r: "5", ...filled }));
      break;
    case "dashed-ring":
      svg.append(svgEl("circle", { r: "3", fill: c, "fill-opacity": "0.5", stroke: "none" }), svgEl("circle", { r: "7", ...outline, "stroke-width": "1.5", "stroke-dasharray": "3 3" }));
      break;
    case "outlined-lock":
      svg.append(
        svgEl("circle", { r: "4", cx: "-2", cy: "2", ...outline }),
        // Padlock: body and shackle, above and right of the shape.
        svgEl("rect", { x: "2", y: "-4", width: "6", height: "4.5", ...outline, "stroke-width": "1" }),
        svgEl("path", { d: "M3.5,-4 V-5.5 a1.5,1.5 0 0 1 3,0 V-4", ...outline, "stroke-width": "1" }),
      );
      break;
  }
  return svg;
}

/** The legend element: a labelled list, each item has an icon and text. */
export function renderLegend(mode: LegendMode, uncovered = false): HTMLElement {
  const box = document.createElement("section");
  box.className = "map-legend";
  box.setAttribute("aria-label", "Map legend");
  const title = document.createElement("h3");
  title.textContent = "Legend";
  const list = document.createElement("ul");
  for (const entry of legendEntries(mode, uncovered)) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = entry.text;
    li.append(glyphSvg(entry), text);
    list.append(li);
  }
  box.append(title, list);
  return box;
}
