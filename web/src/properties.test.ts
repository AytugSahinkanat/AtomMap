// The UI properties of the experience spec (task 15; design, Correctness Properties 5 to 10),
// each with fast-check on random inputs, in the words of the design.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAP_SLUGS, formatRoute, parseRoute, type Route } from "./scenes/router";
import { handPickStats } from "./hand-pick";
import { foldGlow } from "./render/shot-replay";
import { createPlayer, initialState, lastShotsView, type PlaybackEvent } from "./render/playback";
import { buildDailyMap, reachableCounts, adjacencyMasks, type DailyMap } from "./daily/daily-map";
import { dailySeed } from "./run-number";
import { POINT_LIMIT } from "./settings";
import {
  MAX_DAYS,
  PROGRESS_KEY,
  emptyProgress,
  loadProgress,
  recordDaily,
  saveProgress,
  streak,
  type Progress,
  type ProgressStorage,
} from "./daily/progress";

// ---------------------------------------------------------------------------
// Property 9: Routes round-trip (task 15.1; Requirements 1.2, 1.4)

const routeArb: fc.Arbitrary<Route> = fc.oneof(
  fc.constant<Route>({ scene: "choose" }),
  fc.constant<Route>({ scene: "measured" }),
  fc.record({
    scene: fc.constantFrom("map" as const, "run" as const, "results" as const, "lab" as const),
    map: fc.constantFrom(...MAP_SLUGS),
  }).map((r): Route => ({ scene: r.scene, map: r.map })), // a plain object (fast-check records have no prototype)
);

describe("Property 9: routes round-trip", () => {
  it("parseRoute(formatRoute(route)) equals the route, for any valid route", () => {
    fc.assert(fc.property(routeArb, (r) => { expect(parseRoute(formatRoute(r))).toEqual(r); }));
  });
  it("for any string, parseRoute gives a valid route, and unknown input gives the Choose_Scene", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string().map((s) => `#/map/${s}`), fc.string().map((s) => `#/${s}`)), (s) => {
        const r = parseRoute(s);
        expect(parseRoute(formatRoute(r))).toEqual(r); // valid: it formats and parses back
        if (r.scene !== "choose") expect(formatRoute(r).replace(/\/$/, "")).toBe(s.replace(/^#?/, "#").replace(/\/$/, ""));
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Hand_Pick numbers equal a brute-force count (task 15.2; Requirements 9.3, 9.7, 22.3)

describe("Property 5: Hand_Pick numbers equal a brute-force count", () => {
  it("on any map of up to 12 Points with random edges and any Hand_Pick", () => {
    const arb = fc.integer({ min: 0, max: 12 }).chain((n) => {
      const ids = Array.from({ length: n }, (_, i) => `q${i}`);
      const pair = n < 2 ? fc.constant<[string, string] | null>(null) : fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...ids));
      return fc.record({ ids: fc.constant(ids), edges: fc.array(pair, { maxLength: 40 }), picked: fc.subarray(ids) });
    });
    fc.assert(
      fc.property(arb, ({ ids, edges, picked }) => {
        const es = edges.filter((e): e is [string, string] => e !== null && e[0] !== e[1]);
        const set = new Set(picked);
        const joined = (a: string, b: string) => es.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        let clashPairs = 0;
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) if (set.has(ids[i]) && set.has(ids[j]) && joined(ids[i], ids[j])) clashPairs++;
        const valid = ids.filter((a) => set.has(a) && ids.every((b) => b === a || !set.has(b) || !joined(a, b))).length;
        const free = ids.filter((a) => !set.has(a) && ids.every((b) => !set.has(b) || !joined(a, b))).length;
        const s = handPickStats(ids, es, set);
        expect(s.clashes.length).toBe(clashPairs);
        expect(s.valid).toBe(valid);
        expect(s.free).toBe(free);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: The shot replay ends at the real frequencies (task 15.3; Requirements 7.3, 7.4, 7.7, 22.6)

const groupArb = fc.integer({ min: 1, max: 10 }).chain((n) =>
  fc.tuple(
    fc.constant(n),
    fc.array(fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), { maxLength: n }).map((k) => k.sort((a, b) => a - b)), { minLength: 1, maxLength: 40 }),
  ),
);

describe("Property 7: the shot replay ends at the real frequencies", () => {
  it("folding every replay step gives each Point exactly its share of kept lists", () => {
    fc.assert(
      fc.property(groupArb, ([n, kept]) => {
        const glow = foldGlow(n, kept, kept.length);
        for (let j = 0; j < n; j++) expect(glow[j]).toBeCloseTo(kept.filter((k) => k.includes(j)).length / kept.length, 12);
      }),
    );
  });

  it("the glow after skip equals the glow after a full replay", () => {
    fc.assert(
      fc.property(groupArb, fc.integer({ min: 0, max: 4 }), ([n, kept], skipAfter) => {
        const ids = Array.from({ length: n }, (_, i) => `g${i}`);
        const freqs = Object.fromEntries(ids.map((id, j) => [id, kept.filter((k) => k.includes(j)).length / kept.length]));
        const ev = (e: Partial<PlaybackEvent>): PlaybackEvent => ({ type: "run", kind: "pick", competitor: "Hybrid", round: 1, step: 0, ...e });
        const events: PlaybackEvent[] = [
          ev({ kind: "simulate", tile: ids }),
          ev({ kind: "frequencies", tile: ids, frequencies: freqs }),
          ev({ kind: "shots", tile: ids, kept }),
        ];
        const play = (skipAt: number | null) => {
          let t = 0;
          const box: { cb: ((t: number) => void) | null } = { cb: null };
          const p = createPlayer({
            buffer: events,
            initial: initialState(ids),
            eventsPerSecond: () => 25,
            resultReceived: () => true,
            draw: () => {},
            replay: true,
            isAnimating: () => false,
            raf: (f) => ((box.cb = f), 1),
            caf: () => { box.cb = null; },
            now: () => t,
          });
          p.wake();
          for (let i = 0; i < 20000 && p.running; i++) {
            if (skipAt !== null && i === skipAt) {
              p.skip();
              break;
            }
            t += 16;
            const f = box.cb;
            box.cb = null;
            f?.(t);
          }
          return p.state;
        };
        const full = play(null);
        const skipped = play(skipAfter);
        expect(Array.from(skipped.glowTarget)).toEqual(Array.from(full.glowTarget));
        expect(lastShotsView(skipped)).toEqual(lastShotsView(full));
        const view = lastShotsView(full)!;
        view.group.forEach((_, j) => expect(view.glow[j]).toBeCloseTo(freqs[ids[j]], 12));
      }),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: The Daily_Map is fixed by its date and has all three kinds of parts
// (task 15.4; Requirements 11.1, 11.2, 11.3, 11.7, 22.4)

function partChecks(m: DailyMap): { chain: boolean; ring: boolean; clusters: number; clusterOk: boolean; crossEdges: number } {
  const nb = new Map(m.points.map((p) => [p.id, new Set<string>()]));
  for (const [a, b] of m.edges) {
    nb.get(a)!.add(b);
    nb.get(b)!.add(a);
  }
  const partOf = new Map<string, number>();
  m.parts.forEach((p, i) => p.ids.forEach((id) => partOf.set(id, i)));
  const simplicial = (id: string, ids: Set<string>) => {
    const ns = [...nb.get(id)!].filter((x) => ids.has(x));
    return ns.every((a, i) => ns.slice(i + 1).every((b) => nb.get(a)!.has(b)));
  };
  const edgesIn = (ids: Set<string>) => [...ids].reduce((s, id) => s + [...nb.get(id)!].filter((x) => ids.has(x)).length, 0) / 2;
  let chain = false;
  let ring = false;
  let clusters = 0;
  let clusterOk = true;
  for (const part of m.parts) {
    const ids = new Set(part.ids);
    const k = ids.size;
    const anySimplicial = part.ids.some((id) => simplicial(id, ids));
    if (k >= 2 && anySimplicial && edgesIn(ids) === k - 1) chain = true; // a tree with a simplicial Point
    if (k >= 4 && k <= 6 && !anySimplicial) ring = true;
    if (part.kind === "cluster") {
      clusters++;
      const pts = part.ids.map((id) => m.points.find((p) => p.id === id)!).map((p) => [p.x, p.y] as [number, number]);
      clusterOk &&= k >= 8 && k <= 12 && reachableCounts(adjacencyMasks(pts, m.r)).size >= 2;
    }
  }
  const crossEdges = m.edges.filter(([a, b]) => partOf.get(a) !== partOf.get(b)).length;
  return { chain, ring, clusters, clusterOk, crossEdges };
}

describe("Property 6: the Daily_Map is fixed by its date and has all three kinds of parts", () => {
  it("for any UTC date in 2020 to 2040", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 11, 31, 23, 59) }), (t) => {
        const seed = dailySeed(new Date(t));
        const m = buildDailyMap(seed);
        expect(buildDailyMap(seed)).toEqual(m);
        expect(m.points.length >= 30 && m.points.length <= 40 && m.points.length <= POINT_LIMIT).toBe(true);
        const c = partChecks(m);
        expect(c).toEqual({ chain: true, ring: true, clusters: 1, clusterOk: true, crossEdges: 0 });
      }),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: The reachable counts are right (task 15.5; Requirement 11.7)

/** The Rule_Pick_Process with every order of non-rule picks, no memo: the set of final counts. */
function bruteCounts(adj: number[]): Set<number> {
  const n = adj.length;
  const out = new Set<number>();
  const clique = (mask: number) => {
    for (let a = 0; a < n; a++) {
      if (!(mask & (1 << a))) continue;
      const others = mask & ~(1 << a);
      if ((adj[a] & others) !== others) return false;
    }
    return true;
  };
  const walk = (mask: number, picks: number) => {
    // The rules first, in index order, restart after each action.
    let changed = true;
    while (changed) {
      changed = false;
      for (let p = 0; p < n; p++) {
        if (!(mask & (1 << p))) continue;
        if (!clique(adj[p] & mask)) continue;
        mask &= ~(adj[p] | (1 << p));
        picks++;
        changed = true;
        break;
      }
    }
    if (mask === 0) {
      out.add(picks);
      return;
    }
    for (let v = 0; v < n; v++) if (mask & (1 << v)) walk(mask & ~(adj[v] | (1 << v)), picks + 1);
  };
  walk(n === 0 ? 0 : (1 << n) - 1, 0);
  if (n === 0) out.add(0);
  return out;
}

/** The size of a maximum independent set, trying every subset. */
function maxIndependent(adj: number[]): number {
  const n = adj.length;
  let best = 0;
  for (let s = 0; s < 1 << n; s++) {
    let ok = true;
    for (let v = 0; v < n && ok; v++) if (s & (1 << v) && adj[v] & s) ok = false;
    if (ok) best = Math.max(best, s.toString(2).split("1").length - 1);
  }
  return best;
}

describe("Property 10: the reachable counts are right", () => {
  it("for any graph of up to 8 Points: the brute-force counts, and the largest is the maximum independent set", () => {
    const graph = fc.integer({ min: 0, max: 8 }).chain((n) =>
      fc.array(fc.boolean(), { minLength: (n * (n - 1)) / 2, maxLength: (n * (n - 1)) / 2 }).map((bits) => {
        const adj = new Array<number>(n).fill(0);
        let k = 0;
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++)
            if (bits[k++]) {
              adj[i] |= 1 << j;
              adj[j] |= 1 << i;
            }
        return adj;
      }),
    );
    fc.assert(
      fc.property(graph, (adj) => {
        const fast = reachableCounts(adj);
        const slow = bruteCounts(adj);
        expect([...fast].sort((a, b) => a - b)).toEqual([...slow].sort((a, b) => a - b));
        expect(Math.max(...fast)).toBe(maxIndependent(adj));
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Local_Progress never breaks the app (task 15.6; Requirements 12.3, 12.5, 22.5)

const dateArb = fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 11, 31) }).map((t) => new Date(t).toISOString().slice(0, 10));

function storageArb(): fc.Arbitrary<ProgressStorage | null> {
  return fc.oneof(
    fc.constant(null),
    fc.constant<ProgressStorage>({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } }),
    fc.constant<ProgressStorage>({ getItem: () => null, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } }),
    fc.string().map((raw): ProgressStorage => ({ getItem: () => raw, setItem: () => {} })),
    fc.jsonValue().map((v): ProgressStorage => ({ getItem: () => JSON.stringify(v), setItem: () => {} })),
  );
}

describe("Property 8: Local_Progress never breaks the app", () => {
  it("with any broken, odd or missing storage, nothing throws", () => {
    fc.assert(
      fc.property(storageArb(), dateArb, fc.integer({ min: -5, max: 100 }), (storage, date, valid) => {
        expect(() => {
          const p = loadProgress(storage);
          const q = recordDaily(p, date, valid);
          streak(q, date);
          saveProgress(storage, q);
        }).not.toThrow();
        expect(loadProgress(storage).v).toBe(1);
      }),
      { numRuns: 300 },
    );
  });

  it("a well-formed progress saved to a working storage loads back equal (the last 60 dates)", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(dateArb, fc.integer({ min: 0, max: 40 })), { maxLength: 90 }), (entries) => {
        const data = new Map<string, string>();
        const storage: ProgressStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
        let p: Progress = emptyProgress();
        for (const [d, v] of entries) p = recordDaily(p, d, v);
        saveProgress(storage, p);
        const back = loadProgress(storage);
        const kept = Object.keys(p.days).sort().slice(-MAX_DAYS);
        expect(Object.keys(back.days).sort()).toEqual(kept);
        for (const d of kept) expect(back.days[d]).toEqual(p.days[d]);
        expect(data.has(PROGRESS_KEY)).toBe(entries.length >= 0);
      }),
      { numRuns: 200 },
    );
  });
});
