// Your map: the pure editor logic (ui spec, requirement 8). No DOM, no randomness of its own.
// The random generator is an argument, so tests can pin it.

import { RANDOM_SEED_BASE, YOUR_MAP_AREA_M, YOUR_R_MAX, YOUR_R_MIN } from "../settings";

export interface YourPoint {
  id: string;
  x: number;
  y: number;
  /** Only for points that came from GeoJSON. Used for the GeoJSON export. */
  lon?: number;
  lat?: number;
}

export interface EditorState {
  points: YourPoint[];
  /** The number of the next generated id. Only grows until Clear. */
  nextId: number;
}

export interface EditResult {
  state: EditorState;
  /** A plain-words message, or null when the edit just worked. */
  message: string | null;
}

/** `p001`, `p002`, ... `p999`, `p1000`. */
export function formatId(n: number): string {
  return `p${String(n).padStart(3, "0")}`;
}

/** Round to 0.1 m. Never returns -0. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10 || 0;
}

export function limitMessage(limit: number): string {
  return `The limit is ${limit} points. Remove some to add more.`;
}

export function emptyMap(): EditorState {
  return { points: [], nextId: 1 };
}

export function insideArea(x: number, y: number): boolean {
  return x >= 0 && x <= YOUR_MAP_AREA_M.width && y >= 0 && y <= YOUR_MAP_AREA_M.height;
}

/** Add a point at x, y metres (rounded to 0.1 m). Refused outside the area and at the limit. */
export function addPoint(s: EditorState, x: number, y: number, limit: number): EditResult {
  if (s.points.length >= limit) return { state: s, message: limitMessage(limit) };
  const px = round1(x);
  const py = round1(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !insideArea(px, py)) {
    return {
      state: s,
      message: `That spot is outside the ${YOUR_MAP_AREA_M.width} m by ${YOUR_MAP_AREA_M.height} m area.`,
    };
  }
  return {
    state: { points: [...s.points, { id: formatId(s.nextId), x: px, y: py }], nextId: s.nextId + 1 },
    message: null,
  };
}

/** Remove the point with this id and no other. */
export function removePoint(s: EditorState, id: string): EditorState {
  return { points: s.points.filter((p) => p.id !== id), nextId: s.nextId };
}

/** Remove every point. The id counter starts again. */
export function clearMap(_s: EditorState): EditorState {
  return emptyMap();
}

/** Add up to n random points inside the area. Adds fewer when the limit is near, and says so. */
export function addRandom(s: EditorState, n: number, rng: () => number, limit: number): EditResult {
  const room = limit - s.points.length;
  const k = Math.min(n, room);
  if (k <= 0) return { state: s, message: limitMessage(limit) };
  const points = [...s.points];
  let nextId = s.nextId;
  for (let i = 0; i < k; i++) {
    const x = round1(rng() * YOUR_MAP_AREA_M.width);
    const y = round1(rng() * YOUR_MAP_AREA_M.height);
    points.push({ id: formatId(nextId), x, y });
    nextId++;
  }
  const message = k < n ? `Added ${k} of ${n} points. The limit is ${limit} points.` : null;
  return { state: { points, nextId }, message };
}

/** A map from a good Map_Text. The id counter stays clear of imported `p<number>` ids. */
export function replaceMap(points: readonly YourPoint[]): EditorState {
  let top = 0;
  for (const p of points) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return { points: points.map((p) => ({ ...p })), nextId: top + 1 };
}

/** A click on the map: remove the point that was hit, or add one at x, y. */
export function clickAt(
  s: EditorState,
  x: number,
  y: number,
  hitId: string | null,
  limit: number,
): EditResult {
  if (hitId !== null) return { state: removePoint(s, hitId), message: null };
  return addPoint(s, x, y, limit);
}

export type RParse = { ok: true; value: number } | { ok: false; error: string };

export const R_MESSAGE = `r must be a number from ${YOUR_R_MIN} to ${YOUR_R_MAX} metres.`;

/** The typed r in metres, or the plain message. */
export function parseR(text: string): RParse {
  const t = text.trim();
  if (t === "") return { ok: false, error: R_MESSAGE };
  const v = Number(t);
  if (!Number.isFinite(v) || v < YOUR_R_MIN || v > YOUR_R_MAX) return { ok: false, error: R_MESSAGE };
  return { ok: true, value: v };
}

/** Small fixed-seed generator (mulberry32). Same seed, same numbers, in the browser and in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generator for press number n of "Add random points" (n = 0 is the starting map). */
export function randomFor(press: number): () => number {
  return mulberry32(RANDOM_SEED_BASE + press);
}
