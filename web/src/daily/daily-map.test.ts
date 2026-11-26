// Daily_Map (experience spec, Property 6 and task 10.3; Requirements 11.3, 11.4, 11.7, 22.4).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DAILY_AREA_M,
  DAILY_R_M,
  FALLBACK_CLUSTER,
  adjacencyMasks,
  buildDailyMap,
  clusterOk,
  placedFallback,
  reachableCounts,
  type DailyMap,
} from "./daily-map";
import { dailySeed } from "../run-number";
import { POINT_LIMIT } from "../settings";

/** Neighbour sets of the map's edges. */
function neighbours(m: DailyMap): Map<string, Set<string>> {
  const nb = new Map(m.points.map((p) => [p.id, new Set<string>()]));
  for (const [a, b] of m.edges) {
    nb.get(a)!.add(b);
    nb.get(b)!.add(a);
  }
  return nb;
}

/** A Point is simplicial when its neighbours (inside `ids`) are all joined. */
function simplicial(id: string, ids: Set<string>, nb: Map<string, Set<string>>): boolean {
  const ns = [...nb.get(id)!].filter((x) => ids.has(x));
  return ns.every((a, i) => ns.slice(i + 1).every((b) => nb.get(a)!.has(b)));
}

function edgeCount(ids: Set<string>, nb: Map<string, Set<string>>): number {
  let e = 0;
  for (const id of ids) for (const x of nb.get(id)!) if (ids.has(x)) e++;
  return e / 2;
}

function isConnected(ids: string[], nb: Map<string, Set<string>>): boolean {
  const set = new Set(ids);
  const seen = new Set([ids[0]]);
  const todo = [ids[0]];
  while (todo.length) for (const x of nb.get(todo.pop()!)!) if (set.has(x) && !seen.has(x)) { seen.add(x); todo.push(x); }
  return seen.size === ids.length;
}

/** Every rule of Requirements 11.3 and 11.7 on one map. Returns the problems found. */
function problems(m: DailyMap): string[] {
  const out: string[] = [];
  const n = m.points.length;
  if (n < 30 || n > 40 || n > POINT_LIMIT) out.push(`${n} points`);
  if (m.r !== DAILY_R_M || m.area.width !== DAILY_AREA_M.width || m.area.height !== DAILY_AREA_M.height) out.push("area or r");
  for (const p of m.points) if (p.x < 0 || p.y < 0 || p.x > DAILY_AREA_M.width || p.y > DAILY_AREA_M.height) out.push(`${p.id} outside`);
  const nb = neighbours(m);
  const partOf = new Map<string, number>();
  m.parts.forEach((part, i) => part.ids.forEach((id) => partOf.set(id, i)));
  if (partOf.size !== n) out.push("parts do not cover the points");
  for (const [a, b] of m.edges) if (partOf.get(a) !== partOf.get(b)) out.push(`edge ${a}-${b} joins two parts`);
  let chains = 0;
  let rings = 0;
  let clusters = 0;
  for (const part of m.parts) {
    const ids = new Set(part.ids);
    const k = ids.size;
    if (!isConnected(part.ids, nb)) out.push(`${part.kind} not connected`);
    const anySimplicial = part.ids.some((id) => simplicial(id, ids, nb));
    const tree = edgeCount(ids, nb) === k - 1;
    if (part.kind === "chain") {
      // A path the rules solve: a tree with a simplicial end.
      if (tree && anySimplicial && k >= 3) chains++;
      else out.push("bad chain");
    } else if (part.kind === "ring" || part.kind === "square") {
      // A cycle of 4 to 6 Points with no simplicial Point.
      if (k >= 4 && k <= 6 && !anySimplicial && edgeCount(ids, nb) === k) rings++;
      else out.push(`bad ${part.kind}`);
    } else if (part.kind === "cluster") {
      clusters++;
      if (k < 8 || k > 12) out.push(`cluster of ${k}`);
      const pts = part.ids.map((id) => m.points.find((p) => p.id === id)!).map((p) => [p.x, p.y] as [number, number]);
      if (reachableCounts(adjacencyMasks(pts, m.r)).size < 2) out.push("cluster has one reachable count");
    } else if (part.kind === "single" && k !== 1) out.push("bad single");
  }
  if (chains < 1) out.push("no chain");
  if (rings < 1) out.push("no ring or square");
  if (clusters !== 1) out.push(`${clusters} clusters`);
  return out;
}

const key = (m: DailyMap) => JSON.stringify(m.points.map((p) => [p.x, p.y]));

describe("buildDailyMap", () => {
  it("every day of 2028 meets Requirements 11.3 and 11.7, and at most one pair of days is equal", () => {
    const seen = new Map<string, number>();
    let equalPairs = 0;
    for (let d = 0; d < 366; d++) {
      const date = new Date(Date.UTC(2028, 0, 1 + d));
      const m = buildDailyMap(dailySeed(date));
      expect(problems(m), date.toISOString().slice(0, 10)).toEqual([]);
      const k = key(m);
      equalPairs += seen.get(k) ?? 0;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(equalPairs).toBeLessThanOrEqual(1);
  });

  it("the ten Daily_Check dates (2026-12-01 to 2026-12-10)", () => {
    for (let day = 1; day <= 10; day++) {
      const seed = 20261200 + day;
      expect(problems(buildDailyMap(seed)), String(seed)).toEqual([]);
    }
  });

  it("is the same map on every call, for any date from 2020 to 2040 (Property 6)", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 11, 31) }), (t) => {
        const seed = dailySeed(new Date(t));
        const a = buildDailyMap(seed);
        expect(buildDailyMap(seed)).toEqual(a);
        expect(problems(a)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("the fallback cluster passes the same test, wherever it is placed", () => {
    expect(FALLBACK_CLUSTER.length).toBeGreaterThanOrEqual(8);
    for (const [x, y] of [[5.1, 5.1], [35.1, 31.8], [65.1, 58.5], [5.1, 58.5]]) expect(clusterOk(placedFallback(x, y))).toBe(true);
    expect([...reachableCounts(adjacencyMasks(FALLBACK_CLUSTER.slice(), DAILY_R_M))].sort()).toEqual([3, 4]);
  });

  it("a ring alone and a chain alone each have one reachable count (the reason for the cluster)", () => {
    // 6-ring with an 8 m chord, 4-chain with 7.5 m steps (the shapes of the generator).
    const ring = Array.from({ length: 6 }, (_, i) => [8 * Math.cos((Math.PI * i) / 3), 8 * Math.sin((Math.PI * i) / 3)] as [number, number]);
    const chain: [number, number][] = [[0, 0], [5.75, 4.82], [11.49, 0], [17.24, 4.82]];
    expect(reachableCounts(adjacencyMasks(ring, DAILY_R_M)).size).toBe(1);
    expect(reachableCounts(adjacencyMasks(chain, DAILY_R_M)).size).toBe(1);
  });
});
