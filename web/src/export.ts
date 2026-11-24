// Export of the plan selected in the Plan_Selector (ui spec, Requirement 7).
//
// Pure functions build the CSV text, the GeoJSON object and the file name from
// a result. The only DOM code is `downloadText`, at the bottom, so everything
// else can be tested without a browser. No MIS logic here: the round of each
// point is read from the chosen competitor's `rounds` in the result.

import { CARD_LABELS, CARD_ORDER, type EngineName } from "./scoreboard-model";

export type ExportMode = "channel_plan" | "place";

/** One map point. `lon` and `lat` exist only on place maps (PlaceFixture points). */
export interface ExportPoint {
  id: string;
  x: number;
  y: number;
  lon?: number;
  lat?: number;
}

/** Everything the export needs. The caller (task 11.3) fills it from state. */
export interface ExportInput {
  /** The run result: `{competitors: {Hybrid: {rounds, label, ...}, ...}}`. */
  result: unknown;
  /** The plan selected in the Plan_Selector. */
  plan: EngineName;
  mode: ExportMode;
  /** Map name for the file name, e.g. "hero", "kadikoy". */
  map: string;
  seed: number;
  /** Points of the map in display order. */
  points: readonly ExportPoint[];
}

export const CSV_HEADER = "id,x,y,round,result_label,seed";
export const FIVE_GHZ_ONLY = "5 GHz only";
export const NOT_PICKED = "not picked";

export type ExportResultLabel = "simulation" | "real hardware";

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The selected competitor entry, or throws a plain sentence if it has no plan. */
function competitorOf(input: ExportInput): Record<string, any> {
  const comp = isRecord(input.result) && isRecord(input.result.competitors) ? input.result.competitors[input.plan] : undefined;
  if (!isRecord(comp) || "error" in comp || !Array.isArray(comp.rounds)) {
    throw new Error(`There is no finished plan for "${CARD_LABELS[input.plan]}" to export.`);
  }
  return comp;
}

/** "simulation" unless the result says "real hardware". */
export function resultLabelOf(input: ExportInput): ExportResultLabel {
  return competitorOf(input).label === "real hardware" ? "real hardware" : "simulation";
}

/** Round value per point id for the selected plan: the channel, or the unpicked text. */
export function roundValues(input: ExportInput): Map<string, number | string> {
  const comp = competitorOf(input);
  const picked = new Map<string, number | string>();
  for (const r of comp.rounds as any[]) {
    const channel = typeof r?.channel === "number" ? r.channel : 1;
    for (const id of Array.isArray(r?.picks) ? r.picks : []) {
      if (!picked.has(String(id))) picked.set(String(id), input.mode === "place" ? 1 : channel);
    }
  }
  const unpicked = input.mode === "place" ? NOT_PICKED : FIVE_GHZ_ONLY;
  const out = new Map<string, number | string>();
  for (const p of input.points) out.set(p.id, picked.get(p.id) ?? unpicked);
  return out;
}

/** Quote a field when it holds a comma, a quote or a line break. */
export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text: header, then one row per point, each line ending in "\n". */
export function buildCsv(input: ExportInput): string {
  const label = resultLabelOf(input);
  const rounds = roundValues(input);
  const lines = [CSV_HEADER];
  for (const p of input.points) {
    lines.push([p.id, p.x, p.y, rounds.get(p.id)!, label, input.seed].map(csvField).join(","));
  }
  return lines.join("\n") + "\n";
}

export const UNITS_LON_LAT = "degrees: geometry is [lon, lat]; x and y are local metres";
export const UNITS_METRES = "metres: geometry is [x, y] in local metres";

export interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    x: number;
    y: number;
    round: number | string;
    result_label: ExportResultLabel;
    seed: number;
  };
}

export interface ExportGeoJson {
  type: "FeatureCollection";
  result_label: ExportResultLabel;
  seed: number;
  units: string;
  features: PointFeature[];
}

function hasLonLat(p: ExportPoint): boolean {
  return Number.isFinite(p.lon) && Number.isFinite(p.lat);
}

/**
 * GeoJSON FeatureCollection. Geometry is [lon, lat] when every point has a
 * lon and a lat (place maps), otherwise [x, y] in local metres. `units` says which.
 */
export function buildGeoJson(input: ExportInput): ExportGeoJson {
  const label = resultLabelOf(input);
  const rounds = roundValues(input);
  const geo = input.points.length > 0 && input.points.every(hasLonLat);
  return {
    type: "FeatureCollection",
    result_label: label,
    seed: input.seed,
    units: geo ? UNITS_LON_LAT : UNITS_METRES,
    features: input.points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: geo ? [p.lon!, p.lat!] : [p.x, p.y] },
      properties: { id: p.id, x: p.x, y: p.y, round: rounds.get(p.id)!, result_label: label, seed: input.seed },
    })),
  };
}

/** Lower case, letters and digits, other runs become one "-". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `atommap-<map>-<plan>-seed<seed>.<ext>`, e.g. atommap-hero-atoms-rules-hybrid-seed1.csv */
export function exportFileName(map: string, plan: EngineName, seed: number, ext: "csv" | "geojson"): string {
  const m = slugify(map) || "map";
  const p = slugify(CARD_LABELS[plan]) || slugify(plan);
  const s = String(seed).replace("-", "m"); // seed -5 -> seedm5, keeps the name free of odd characters
  return `atommap-${m}-${p}-seed${s}.${ext}`;
}

/** True for a plan name the export knows. */
export function isPlan(name: string): name is EngineName {
  return (CARD_ORDER as readonly string[]).includes(name);
}

// ---- DOM: the only part that needs a browser ----

/** Save text as a file through a Blob and an `<a download>` link. */
export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(input: ExportInput): void {
  downloadText(exportFileName(input.map, input.plan, input.seed, "csv"), buildCsv(input), "text/csv;charset=utf-8");
}

export function downloadGeoJson(input: ExportInput): void {
  downloadText(
    exportFileName(input.map, input.plan, input.seed, "geojson"),
    JSON.stringify(buildGeoJson(input), null, 2) + "\n",
    "application/geo+json",
  );
}
