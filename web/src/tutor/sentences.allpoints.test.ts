// Step 2 says "All N points" when the rules made no pick before the atoms, and "The other N points" when they did.
// Hand-made Facts, so the wording is checked without a recorded run.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Facts } from "./facts";
import { arbFacts } from "./generators";
import { buildSteps } from "./sentences";

function facts(over: Partial<Facts> & { rulesCount: number; mode?: "channel_plan" | "place"; smallest?: number; biggest?: number }): Facts {
  const mode = over.mode ?? "place";
  return {
    label: "simulation",
    mode,
    seed: 1,
    rulesFirst: { count: over.rulesCount, ring: [] },
    groups: {
      ...(mode === "channel_plan" ? { channel: 1 } : {}),
      pointsLeft: 8,
      count: 1,
      smallest: over.smallest ?? 8,
      biggest: over.biggest ?? 8,
      shots: 100,
      ring: [],
    },
    rounds: [],
  };
}

const step2 = (f: Facts): string => buildSteps(f, "Hybrid").find((s) => s.key === "groups")!.sentences[0];

describe("Step 2 opening", () => {
  it("says All 8 points when the rules made no pick before, in Place and in Channel_Plan, for both group shapes", () => {
    for (const mode of ["place", "channel_plan"] as const) {
      for (const [smallest, biggest] of [[8, 8], [3, 5]]) {
        const text = step2(facts({ rulesCount: 0, mode, smallest, biggest }));
        expect(text.startsWith("All 8 points were too tangled for the rules."), text).toBe(true);
        expect(text).not.toContain("The other");
      }
    }
  });

  it("says The other 8 points when the rules made at least one pick before", () => {
    for (const mode of ["place", "channel_plan"] as const) {
      for (const [smallest, biggest] of [[8, 8], [3, 5]]) {
        const text = step2(facts({ rulesCount: 2, mode, smallest, biggest }));
        expect(text.startsWith("The other 8 points were too tangled for the rules."), text).toBe(true);
        expect(text).not.toContain("All 8");
      }
    }
  });

  it("keeps the rest of the sentence (groups, shots) in both cases", () => {
    expect(step2(facts({ rulesCount: 0 }))).toBe(
      "All 8 points were too tangled for the rules. They were cut into 1 small group of 8 points, and each group ran on the atoms 100 times.",
    );
    expect(step2(facts({ rulesCount: 1 }))).toBe(
      "The other 8 points were too tangled for the rules. They were cut into 1 small group of 8 points, and each group ran on the atoms 100 times.",
    );
  });

  it("uses the old wording when the rules fact is absent, and never says All unless the count is 0", () => {
    const f = facts({ rulesCount: 0 });
    delete f.rulesFirst;
    expect(step2(f).startsWith("The other 8 points")).toBe(true);
    fc.assert(
      fc.property(arbFacts, (g) => {
        for (const s of buildSteps(g, "Hybrid")) {
          for (const text of s.sentences) {
            if (text.startsWith("All ") && text.includes("too tangled")) expect(g.rulesFirst?.count).toBe(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
