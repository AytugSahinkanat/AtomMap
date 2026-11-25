// Feature: ui, Property 4: Your_Map request edges are exactly the pairs closer than r
// Validates: Requirements 8.6, 8.8 (task 13.6)
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { YOUR_R_MAX, YOUR_R_MIN } from "../settings";
import { buildRequest } from "./map-request";

const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The reference: every pair with distance strictly below r, found by brute force. */
function closePairs(pts: { id: string; x: number; y: number }[], r: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < r) out.add(key(pts[i].id, pts[j].id));
  return out;
}

const pointsArb = fc
  .array(fc.record({ x: fc.integer({ min: 0, max: 900 }), y: fc.integer({ min: 0, max: 600 }) }), { maxLength: 40 })
  .map((raw) => raw.map((p, i) => ({ id: `p${String(i + 1).padStart(3, "0")}`, x: p.x / 10, y: p.y / 10 })));

describe("Your_Map request", () => {
  it("Property 4: the request edges are exactly the pairs closer than r, each once", () => {
    fc.assert(
      fc.property(pointsArb, fc.integer({ min: YOUR_R_MIN * 10, max: YOUR_R_MAX * 10 }), (points, r10) => {
        const r = r10 / 10;
        const req = buildRequest({ mode: "your_map", points, r }, 1);
        const edges = req.graph.edges ?? [];
        const got = edges.map(([a, b]) => key(a, b));
        expect(new Set(got).size).toBe(got.length); // each pair once
        expect(new Set(got)).toEqual(closePairs(points, r));
      }),
      { numRuns: 200 },
    );
  });

  it("a pair at exactly r is not an edge, a pair just below r is", () => {
    const at = buildRequest({ mode: "your_map", points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 20, y: 0 }], r: 20 }, 1);
    expect(at.graph.edges).toEqual([]);
    const below = buildRequest({ mode: "your_map", points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 19.9, y: 0 }], r: 20 }, 1);
    expect(below.graph.edges).toEqual([["a", "b"]]);
  });

  it("sends the Place mode, the seed, r and only id, x and y of each point", () => {
    const req = buildRequest(
      { mode: "your_map", points: [{ id: "a", x: 1, y: 2, lon: 29, lat: 41 } as never], r: 35 },
      7,
    );
    expect(req.mode).toBe("place");
    expect(req.seed).toBe(7);
    expect(req.graph.r).toBe(35);
    expect(req.points).toEqual([{ id: "a", x: 1, y: 2 }]);
  });
});
