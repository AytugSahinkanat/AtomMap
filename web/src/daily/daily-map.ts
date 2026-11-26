// Daily_Map (experience spec, Requirement 11; design "Daily_Map"): one small map per UTC date,
// the same for every visitor. Pure: the map follows from the Daily_Seed alone.
//
// The area is 120 x 80 m with r = 10 m, cut into 4 x 3 slots. Each slot holds at most one part
// (a chain, a ring, a square or a single Point), placed at least r/2 from the slot border, so no
// edge joins two parts. One Tangled_Cluster of 8 to 12 Points takes two neighbouring slots of a row.
//
// reachableCounts is not an MIS solver for the app: it is the test the generator uses to keep a
// cluster on which the order of non-rule picks can change the final count (Requirement 11.7).

import { buildStraightEdges } from "../edges/straight";
import { mulberry32 } from "../your-map/editor";

export const DAILY_AREA_M = { width: 120, height: 80 } as const;
export const DAILY_R_M = 10;
export const DAILY_MIN_POINTS = 30;
export const DAILY_MAX_POINTS = 40;
const COLS = 4;
const ROWS = 3;
const SLOT_W = DAILY_AREA_M.width / COLS; // 30 m
const SLOT_H = DAILY_AREA_M.height / ROWS; // 26.7 m
/**
 * Distance kept from the slot border: r/2, plus 0.1 m because the coordinates are rounded to
 * 0.1 m afterwards (two parts stay at least r apart after rounding).
 */
const MARGIN = DAILY_R_M / 2 + 0.1;
const BOX_W = SLOT_W - 2 * MARGIN;
const BOX_H = SLOT_H - 2 * MARGIN;
const CLUSTER_BOX_W = 2 * SLOT_W - 2 * MARGIN;
const CLUSTER_MIN_GAP_M = 4;
/** Width of the part of the cluster box the cluster's Points are drawn in. */
const CLUSTER_DRAW_W = 25;
const CLUSTER_DRAWS = 400;

export type PartKind = "chain" | "ring" | "square" | "single" | "cluster";

export interface DailyPoint {
  id: string;
  x: number;
  y: number;
}

export interface DailyMap {
  seed: number;
  r: number;
  points: DailyPoint[];
  edges: [string, string][];
  area: { width: number; height: number };
  /** Each part's kind and ids, in slot order. `fallback` is set on a cluster that is the fixed one. */
  parts: { kind: PartKind; ids: string[]; fallback?: boolean }[];
}

type Xy = [number, number];

// ---------------------------------------------------------------------------
// The Rule_Pick_Process on a small graph (at most 12 Points, adjacency as bit masks).

/**
 * Every final count the Rule_Pick_Process can reach on this graph: the simplicial rule runs in
 * index order (restart after each action, as engine/rules.py), and then every Point left is tried
 * as the next non-rule pick. Memo on the mask of the Points left. `adj[i]` is the bit mask of the
 * neighbours of Point i.
 */
export function reachableCounts(adj: readonly number[]): Set<number> {
  const n = adj.length;
  if (n > 16) throw new Error("reachableCounts is for small graphs only");
  const memo = new Map<number, Set<number>>();
  const isClique = (mask: number): boolean => {
    for (let a = 0; a < n; a++) {
      if (!(mask & (1 << a))) continue;
      const others = mask & ~(1 << a);
      if ((adj[a] & others) !== others) return false;
    }
    return true;
  };
  const rules = (mask: number): [number, number] => {
    let picks = 0;
    let changed = true;
    while (changed) {
      changed = false;
      for (let p = 0; p < n; p++) {
        if (!(mask & (1 << p))) continue;
        const nb = adj[p] & mask;
        if (!isClique(nb)) continue;
        mask &= ~(nb | (1 << p));
        picks++;
        changed = true;
        break;
      }
    }
    return [mask, picks];
  };
  const go = (mask: number): Set<number> => {
    const hit = memo.get(mask);
    if (hit) return hit;
    const [left, picks] = rules(mask);
    const out = new Set<number>();
    if (left === 0) out.add(picks);
    else {
      for (let v = 0; v < n; v++) {
        if (!(left & (1 << v))) continue;
        for (const c of go(left & ~(adj[v] | (1 << v)))) out.add(picks + 1 + c);
      }
    }
    memo.set(mask, out);
    return out;
  };
  return go(n >= 31 ? -1 : (1 << n) - 1);
}

/** Adjacency masks of points under the strict `distance < r` rule (the app's edges). */
export function adjacencyMasks(pts: readonly Xy[], r: number): number[] {
  const adj = new Array<number>(pts.length).fill(0);
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0];
      const dy = pts[i][1] - pts[j][1];
      if (dx * dx + dy * dy < r * r) {
        adj[i] |= 1 << j;
        adj[j] |= 1 << i;
      }
    }
  return adj;
}

function connected(adj: readonly number[]): boolean {
  if (adj.length === 0) return false;
  const all = (1 << adj.length) - 1;
  let seen = 1;
  let frontier = 1;
  while (frontier) {
    let next = 0;
    for (let i = 0; i < adj.length; i++) if (frontier & (1 << i)) next |= adj[i];
    next &= ~seen;
    seen |= next;
    frontier = next;
  }
  return seen === all;
}

/** A cluster the generator may keep: connected, and two or more reachable counts. */
export function clusterOk(pts: readonly Xy[], r = DAILY_R_M): boolean {
  if (pts.length < 8 || pts.length > 12) return false;
  const adj = adjacencyMasks(pts, r);
  return connected(adj) && reachableCounts(adj).size >= 2;
}

/**
 * The fixed cluster used when 400 draws find none: 10 Points, relative coordinates in metres
 * inside a 25 x 16.4 m box. Found once by a seeded search (draws like the generator's) and
 * written here. Its reachable counts are 3 and 4, and every pair is at least 0.6 m away from
 * r, so rounding cannot change an edge. A test checks it with `clusterOk` after placement.
 */
export const FALLBACK_CLUSTER: readonly Xy[] = [
  [1, 13.5], [12.2, 12.2], [19.9, 7.2], [3.7, 5.7], [5.1, 16.4],
  [1.1, 1.5], [20.2, 2.8], [18.9, 13.6], [23.8, 8.1], [11.8, 4],
];

// ---------------------------------------------------------------------------
// The parts.

function rotate(pts: readonly Xy[], a: number): Xy[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

function box(pts: readonly Xy[]): { x0: number; y0: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** Chain: a zigzag with 7.5 m steps and 100 degrees at each turn (second neighbours 11.5 m apart). */
function chainShape(n: number): Xy[] {
  const step = 7.5;
  const a = (40 * Math.PI) / 180;
  const out: Xy[] = [[0, 0]];
  for (let i = 1; i < n; i++) {
    const [x, y] = out[i - 1];
    out.push([x + step * Math.cos(a), y + (i % 2 === 1 ? 1 : -1) * step * Math.sin(a)]);
  }
  return out;
}

/** Ring: 5 Points on radius 6.8 m or 6 Points on radius 8 m (an 8 m chord). */
function ringShape(n: 5 | 6): Xy[] {
  const rad = n === 5 ? 6.8 : 8;
  return Array.from({ length: n }, (_, i) => [rad * Math.cos((2 * Math.PI * i) / n), rad * Math.sin((2 * Math.PI * i) / n)] as Xy);
}

/** Square: 4 Points with an 8 m side (diagonal 11.3 m). */
function squareShape(): Xy[] {
  return [[0, 0], [8, 0], [8, 8], [0, 8]];
}

interface Part {
  kind: PartKind;
  shape: Xy[];
  fallback?: boolean;
}

function partOf(kind: "chain3" | "chain4" | "ring5" | "ring6" | "square" | "single"): Part {
  if (kind === "chain3") return { kind: "chain", shape: chainShape(3) };
  if (kind === "chain4") return { kind: "chain", shape: chainShape(4) };
  if (kind === "ring5") return { kind: "ring", shape: ringShape(5) };
  if (kind === "ring6") return { kind: "ring", shape: ringShape(6) };
  if (kind === "square") return { kind: "square", shape: squareShape() };
  return { kind: "single", shape: [[0, 0]] };
}
const SIZE = { chain3: 3, chain4: 4, ring5: 5, ring6: 6, square: 4, single: 1 } as const;
type SmallKind = keyof typeof SIZE;

/** A random rotation whose box fits w x h; rotation 0 after 8 tries. */
function fitRotation(shape: readonly Xy[], w: number, h: number, rnd: () => number): Xy[] {
  for (let t = 0; t < 8; t++) {
    const s = rotate(shape, rnd() * 2 * Math.PI);
    const b = box(s);
    if (b.w <= w && b.h <= h) return s;
  }
  return shape.slice();
}

/** Place a shape at a random spot of the rectangle [x, x+w] x [y, y+h]. */
function placeIn(shape: readonly Xy[], x: number, y: number, w: number, h: number, rnd: () => number): Xy[] {
  const b = box(shape);
  const ox = x + rnd() * Math.max(0, w - b.w) - b.x0;
  const oy = y + rnd() * Math.max(0, h - b.h) - b.y0;
  return shape.map(([px, py]) => [px + ox, py + oy]);
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * One cluster draw in the cluster box at (x0, y0), in final map coordinates (rounded to 0.1 m),
 * or null when the 4 m gaps could not be kept. The check runs on these same coordinates.
 */
function drawCluster(rnd: () => number, x0: number, y0: number): Xy[] | null {
  const n = 8 + Math.floor(rnd() * 5);
  // The Points fill a 25 m wide part of the two-slot box, at a random spot. Spread over the
  // full 50 m the graph is a thin string, and almost no draw reaches two counts.
  const left = x0 + rnd() * (CLUSTER_BOX_W - CLUSTER_DRAW_W);
  const pts: Xy[] = [];
  for (let tries = 0; pts.length < n && tries < 400; tries++) {
    const p: Xy = [r1(left + rnd() * CLUSTER_DRAW_W), r1(y0 + rnd() * BOX_H)];
    if (pts.every(([x, y]) => (x - p[0]) ** 2 + (y - p[1]) ** 2 >= CLUSTER_MIN_GAP_M ** 2)) pts.push(p);
  }
  return pts.length === n ? pts : null;
}

/** The fixed cluster placed in the cluster box at (x0, y0), rounded like every other Point. */
export function placedFallback(x0: number, y0: number): Xy[] {
  return FALLBACK_CLUSTER.map(([x, y]) => [r1(x0 + x), r1(y0 + y)] as Xy);
}

/** The Daily_Map of a Daily_Seed (YYYYMMDD). Same seed, same map. */
export function buildDailyMap(seed: number): DailyMap {
  const rnd = mulberry32(seed);

  // The cluster's two neighbouring slots of one row.
  const row = Math.floor(rnd() * ROWS);
  const col = Math.floor(rnd() * (COLS - 1));
  const cx = col * SLOT_W + MARGIN;
  const cy = row * SLOT_H + MARGIN;

  // The Tangled_Cluster.
  let cluster: Part | null = null;
  for (let d = 0; d < CLUSTER_DRAWS && cluster === null; d++) {
    const pts = drawCluster(rnd, cx, cy);
    if (pts !== null && clusterOk(pts)) cluster = { kind: "cluster", shape: pts };
  }
  if (cluster === null) cluster = { kind: "cluster", shape: placedFallback(cx, cy), fallback: true };

  // The other parts: one chain, one ring or square, then more until 30 to 40 Points in all.
  const target = DAILY_MIN_POINTS + Math.floor(rnd() * (DAILY_MAX_POINTS - DAILY_MIN_POINTS + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const kinds: SmallKind[] = [pick(["chain3", "chain4"] as const), pick(["ring5", "ring6", "square"] as const)];
  let total = cluster.shape.length + SIZE[kinds[0]] + SIZE[kinds[1]];
  const SLOTS_FREE = COLS * ROWS - 2;
  while (total < target && kinds.length < SLOTS_FREE) {
    const left = target - total;
    const slotsAfter = SLOTS_FREE - kinds.length - 1;
    const options = (Object.keys(SIZE) as SmallKind[]).filter((k) => SIZE[k] <= left && left - SIZE[k] <= slotsAfter * 6);
    if (options.length === 0) break;
    const k = pick(options);
    kinds.push(k);
    total += SIZE[k];
  }

  // The slots: the cluster has its two; the parts go to the others in a shuffled order.
  const free: number[] = [];
  for (let s = 0; s < COLS * ROWS; s++) if (!(Math.floor(s / COLS) === row && (s % COLS === col || s % COLS === col + 1))) free.push(s);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const bySlot = new Map<number, Part>();
  bySlot.set(row * COLS + col, cluster);
  kinds.forEach((k, i) => bySlot.set(free[i], partOf(k)));

  const points: DailyPoint[] = [];
  const parts: DailyMap["parts"] = [];
  for (let s = 0; s < COLS * ROWS; s++) {
    const part = bySlot.get(s);
    if (!part) continue;
    const x = (s % COLS) * SLOT_W + MARGIN; // the part's box starts r/2 (+0.1 m) inside its slot
    const y = Math.floor(s / COLS) * SLOT_H + MARGIN;
    const placed =
      part.kind === "cluster"
        ? part.shape // drawn in its box already, in map coordinates
        : placeIn(fitRotation(part.shape, BOX_W, BOX_H, rnd), x, y, BOX_W, BOX_H, rnd);
    const ids: string[] = [];
    for (const [px, py] of placed) {
      const id = `d${String(points.length + 1).padStart(2, "0")}`;
      points.push({ id, x: r1(px), y: r1(py) });
      ids.push(id);
    }
    parts.push(part.fallback ? { kind: part.kind, ids, fallback: true } : { kind: part.kind, ids });
  }
  return { seed, r: DAILY_R_M, points, edges: buildStraightEdges(points, DAILY_R_M), area: { ...DAILY_AREA_M }, parts };
}
