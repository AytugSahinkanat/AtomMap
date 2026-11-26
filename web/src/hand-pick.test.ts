// Property 5: Hand_Pick numbers equal a brute-force count (Requirements 9.3, 9.7, 10.3).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BANNED_YOU_WORDS, handPickReadout, handPickStats, youLine } from "./hand-pick";

const mapArb = fc.integer({ min: 1, max: 12 }).chain((n) => {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const pair = fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }));
  return fc.record({
    ids: fc.constant(ids),
    edges: fc.array(pair, { maxLength: 30 }).map((ps) => ps.filter(([a, b]) => a !== b).map(([a, b]) => [ids[a], ids[b]] as [string, string])),
    picked: fc.subarray(ids),
  });
});

describe("handPickStats", () => {
  it("equals a brute-force check of every pair and every point", () => {
    fc.assert(
      fc.property(mapArb, ({ ids, edges, picked }) => {
        const set = new Set(picked);
        const adj = (a: string, b: string) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        const clashes: [string, string][] = [];
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const [a, b] = [ids[i], ids[j]].sort();
            if (set.has(a) && set.has(b) && adj(a, b)) clashes.push([a, b]);
          }
        const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
        clashes.sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]));
        const valid = ids.filter((a) => set.has(a) && !ids.some((b) => b !== a && set.has(b) && adj(a, b))).length;
        const freeIds = ids.filter((a) => !set.has(a) && !ids.some((b) => set.has(b) && adj(a, b)));
        const s = handPickStats(ids, edges, set);
        expect(s.valid).toBe(valid);
        expect(s.clashes).toEqual(clashes);
        expect(s.freeIds).toEqual(freeIds);
        expect(s.free).toBe(freeIds.length);
      }),
    );
  });
});

describe("texts", () => {
  it("the readout hint follows Requirement 9.3", () => {
    const ids = ["a", "b", "c"];
    expect(handPickReadout(handPickStats(ids, [["a", "b"]], new Set(["a"]))).hint).toBe("You could still add 1 more without a clash.");
    expect(handPickReadout(handPickStats(ids, [["a", "b"], ["a", "c"]], new Set(["a"]))).hint).toBe("No point can be added without a clash.");
  });
  it("the You_Line uses neutral words only", () => {
    fc.assert(
      fc.property(mapArb, ({ ids, edges, picked }) => {
        const s = handPickStats(ids, edges, new Set(picked));
        const r = handPickReadout(s);
        for (const text of [youLine(s), r.count, r.hint]) {
          const words = text.toLowerCase().split(/[^a-z]+/);
          for (const w of BANNED_YOU_WORDS) expect(words).not.toContain(w);
        }
      }),
    );
    const s = handPickStats(["a", "b"], [["a", "b"]], new Set(["a", "b"]));
    expect(youLine(s)).toBe("You: 0 (1 clash not counted)");
  });
});
