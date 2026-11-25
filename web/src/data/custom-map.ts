// Your map: read the "Points as text" box or a file (ui spec, requirement 8.9 to 8.12).
// CSV with the columns id, x, y in metres, or GeoJSON points. Pure functions, no DOM, never throw.
// A failure returns one plain-words reason and no points, so the caller keeps the current map.

import { MAX_TEXT_BYTES } from "../settings";
import { formatId, type YourPoint } from "../your-map/editor";

export type MapTextKind = "csv" | "geojson";

export type ParseResult = { ok: true; points: YourPoint[]; kind: MapTextKind } | { ok: false; reason: string };

/** Same numbers as scripts/fetch_place.py (EARTH_RADIUS_M, project, centroid). */
const EARTH_RADIUS_M = 6371008.8;
/** Coordinates beyond this many metres are refused (typos, wrong units). */
const MAX_ABS_M = 1_000_000;

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export function tooLargeReason(): string {
  return `The text is larger than ${MAX_TEXT_BYTES / 1_000_000} MB.`;
}

export const NO_POINTS_REASON = "There are no points in this text.";
export const NOT_MAP_TEXT_REASON = "This is neither CSV nor GeoJSON.";

function tooManyReason(count: number, limit: number): string {
  return `There are ${count} points. The limit is ${limit}.`;
}

function duplicateReason(dups: string[]): string {
  const shown = dups.slice(0, 3).join(", ");
  return dups.length === 1 ? `The id ${shown} is used twice.` : `These ids are used more than once: ${shown}.`;
}

/** Choose the kind from the file name when there is one, else from the first character of the text. */
export function detectKind(text: string, fileName?: string): MapTextKind {
  const name = (fileName ?? "").toLowerCase();
  if (name.endsWith(".geojson") || name.endsWith(".json")) return "geojson";
  if (name.endsWith(".csv")) return "csv";
  const first = text.replace(/^\uFEFF/, "").trimStart().charAt(0);
  return first === "{" ? "geojson" : "csv";
}

/** Read the text as CSV or GeoJSON. `limit` is the Point_Limit. */
export function parseMapText(text: string, kind: MapTextKind, limit: number): ParseResult {
  if (text.length > MAX_TEXT_BYTES) return fail(tooLargeReason());
  try {
    return kind === "geojson" ? parseGeoJson(text, limit) : parseCsv(text, limit);
  } catch {
    return fail(NOT_MAP_TEXT_REASON);
  }
}

// ---------------------------------------------------------------- CSV

interface Row {
  line: number;
  cells: string[];
}

/** Split text into rows of cells (quotes as in RFC 4180). `line` is the physical line where a row starts. */
function splitRows(text: string, delimiter: string): Row[] {
  const rows: Row[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = (): void => {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += c;
    }
  }
  if (cell !== "" || cells.length > 0) endRow();
  return rows;
}

/** The delimiter (comma, semicolon or tab) that appears most in the first non-empty line, outside quotes. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim() !== "") ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const c of firstLine) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in counts) counts[c]++;
  }
  let best = ",";
  for (const d of [",", ";", "\t"]) if (counts[d] > counts[best]) best = d;
  return best;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COMMA_DECIMAL = /^[+-]?\d+,\d+$/;

function readNumber(raw: string, line: number, column: string): number | string {
  const t = raw.trim();
  if (t === "") return `Line ${line}: there is no value for ${column}.`;
  const v = NUMBER.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(v)) {
    const hint = COMMA_DECIMAL.test(t) ? " Write decimals with a dot." : "";
    return `Line ${line}: ${column} is not a number ("${t}").${hint}`;
  }
  if (Math.abs(v) > MAX_ABS_M) return `Line ${line}: ${column} is farther than 1,000,000 m from the origin.`;
  return v;
}

function parseCsv(text: string, limit: number): ParseResult {
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") return fail(NO_POINTS_REASON);
  const rows = splitRows(body, detectDelimiter(body)).filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (rows.length === 0) return fail(NO_POINTS_REASON);
  const header = rows[0].cells.map((c) => c.trim().toLowerCase());
  const col = { id: header.indexOf("id"), x: header.indexOf("x"), y: header.indexOf("y") };
  if (col.id < 0 || col.x < 0 || col.y < 0) {
    const names = rows[0].cells.map((c) => c.trim()).filter((c) => c !== "");
    return fail(`The first line must name the columns id, x and y. It has: ${names.join(", ") || "nothing"}.`);
  }
  const data = rows.slice(1);
  if (data.length === 0) return fail(NO_POINTS_REASON);
  if (data.length > limit) return fail(tooManyReason(data.length, limit));
  const points: YourPoint[] = [];
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const row of data) {
    const id = (row.cells[col.id] ?? "").trim();
    if (id === "") return fail(`Line ${row.line}: the id is empty.`);
    const x = readNumber(row.cells[col.x] ?? "", row.line, "x");
    if (typeof x === "string") return fail(x);
    const y = readNumber(row.cells[col.y] ?? "", row.line, "y");
    if (typeof y === "string") return fail(y);
    if (seen.has(id)) {
      if (!dups.includes(id)) dups.push(id);
    }
    seen.add(id);
    points.push({ id, x, y });
  }
  if (dups.length > 0) return fail(duplicateReason(dups));
  return { ok: true, points, kind: "csv" };
}

// ---------------------------------------------------------------- GeoJSON

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f || 0;
}

/** Equirectangular projection around origin (lat0, lon0), metres rounded to 0.1 (as `project` in fetch_place.py). */
export function projectLatLon(lat: number, lon: number, lat0: number, lon0: number): { x: number; y: number } {
  const x = ((lon - lon0) * Math.PI) / 180 * Math.cos((lat0 * Math.PI) / 180) * EARTH_RADIUS_M;
  const y = ((lat - lat0) * Math.PI) / 180 * EARTH_RADIUS_M;
  return { x: round(x, 1), y: round(y, 1) };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseGeoJson(text: string, limit: number): ParseResult {
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") return fail(NO_POINTS_REASON);
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return fail("This looks like GeoJSON, but it is not valid JSON.");
  }
  if (!isObject(doc) || typeof doc.type !== "string") return fail(NOT_MAP_TEXT_REASON);

  let features: unknown[];
  if (doc.type === "FeatureCollection") {
    if (!Array.isArray(doc.features)) return fail("The FeatureCollection has no list of features.");
    features = doc.features;
  } else if (doc.type === "Feature") {
    features = [doc];
  } else if (doc.type === "Point") {
    features = [{ type: "Feature", geometry: doc, properties: {} }];
  } else {
    return fail(`This GeoJSON is a ${doc.type}, not points. Only points can be used.`);
  }
  if (features.length === 0) return fail(NO_POINTS_REASON);
  if (features.length > limit) return fail(tooManyReason(features.length, limit));

  // First pass: check every feature and read its coordinates and explicit id.
  const read: { lon: number; lat: number; id: string | null }[] = [];
  for (let i = 0; i < features.length; i++) {
    const n = i + 1;
    const f = features[i];
    if (!isObject(f) || f.type !== "Feature") return fail(`Feature ${n} is not a GeoJSON Feature.`);
    const g = f.geometry;
    if (g === null || g === undefined) return fail(`Feature ${n} has no geometry. Only points can be used.`);
    if (!isObject(g) || typeof g.type !== "string") return fail(`Feature ${n} has no readable geometry.`);
    if (g.type !== "Point") return fail(`Feature ${n} is a ${g.type}, not a Point. Only points can be used.`);
    const c = g.coordinates;
    if (
      !Array.isArray(c) ||
      c.length < 2 ||
      typeof c[0] !== "number" ||
      typeof c[1] !== "number" ||
      !Number.isFinite(c[0]) ||
      !Number.isFinite(c[1]) ||
      Math.abs(c[0]) > 180 ||
      Math.abs(c[1]) > 90
    ) {
      return fail(`Feature ${n} does not have a longitude and a latitude.`);
    }
    const props = isObject(f.properties) ? f.properties : {};
    let id: string | null = null;
    if (typeof props.id === "string" && props.id.trim() !== "") id = props.id.trim();
    else if (typeof props.id === "number" && Number.isFinite(props.id)) id = String(props.id);
    read.push({ lon: c[0], lat: c[1], id });
  }

  // Explicit ids must be unique. Generated ids skip the ones already used.
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of read) {
    if (r.id === null) continue;
    if (seen.has(r.id) && !dups.includes(r.id)) dups.push(r.id);
    seen.add(r.id);
  }
  if (dups.length > 0) return fail(duplicateReason(dups));

  // Origin: mean latitude and longitude, rounded to 6 decimals (the centroid of fetch_place.py).
  const lat0 = round(read.reduce((s, r) => s + r.lat, 0) / read.length, 6);
  const lon0 = round(read.reduce((s, r) => s + r.lon, 0) / read.length, 6);

  let next = 1;
  const points: YourPoint[] = read.map((r) => {
    let id = r.id;
    if (id === null) {
      while (seen.has(formatId(next))) next++;
      id = formatId(next);
      seen.add(id);
      next++;
    }
    const { x, y } = projectLatLon(r.lat, r.lon, lat0, lon0);
    return { id, x, y, lon: r.lon, lat: r.lat };
  });
  return { ok: true, points, kind: "geojson" };
}
