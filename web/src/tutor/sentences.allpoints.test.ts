// Step 2 says "All N points" when the rules made no pick before the atoms, and "The other N points" when they did.
// The choice is the fact `groups.allOpen`, a fact of Step 2's own: no other missing fact can change Step 2.
// Hand-made Facts and events, so the wording is checked without a recorded run.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { deriveFacts, type Facts, type TutorEvent } from "./facts";
import { arbFacts } from "./generators";
import { buildSteps } from "./sentences";

function facts(over: { allOpen?: boolean; rulesCount?: number; mode?: "channel_plan" | "place"; smallest?: number; biggest?: number }): Facts {
  const mode = over.mode ?? "place";
  const f: Facts = {
    label: "simulation",
    mode,
    seed: 1,
    groups: {
      ...(mode === "channel_plan" ? { channel: 1 } : {}),
      pointsLeft: 8,
      allOpen: over.allOpen ?? true,
      count: 1,
      smallest: over.smallest ?? 8,
      biggest: over.biggest ?? 8,
      shots: 100,
      ring: [],
    },
    rounds: [],
  };
  if (over.rulesCount !== undefined) f.rulesFirst = { count: over.rulesCount, ring: [] };
  return f;
}

const step2 = (f: Facts): string[] => buildSteps(f, "Hybrid").find((s) => s.key === "groups")?.sentences ?? [];

describe("Step 2 opening", () => {
  it("says All 8 points when allOpen is true, in Place and in Channel_Plan, for both group shapes", () => {
    for (const mode of ["place", "channel_plan"] as const) {
      for (const [smallest, biggest] of [[8, 8], [3, 5]]) {
        const text = step2(facts({ allOpen: true, mode, smallest, biggest }))[0];
        expect(text.startsWith("All 8 points were too tangled for the rules."), text).toBe(true);
        expect(text).not.toContain("The other");
      }
    }
  });

  it("says The other 8 points when allOpen is false", () => {
    for (const mode of ["place", "channel_plan"] as const) {
      for (const [smallest, biggest] of [[8, 8], [3, 5]]) {
        const text = step2(facts({ allOpen: false, mode, smallest, biggest }))[0];
        expect(text.startsWith("The other 8 points were too tangled for the rules."), text).toBe(true);
        expect(text).not.toContain("All 8");
      }
    }
  });

  it("keeps the rest of the sentence (groups, shots) in both cases", () => {
    expect(step2(facts({ allOpen: true }))[0]).toBe(
      "All 8 points were too tangled for the rules. They were cut into 1 small group of 8 points, and each group ran on the atoms 100 times.",
    );
    expect(step2(facts({ allOpen: false }))[0]).toBe(
      "The other 8 points were too tangled for the rules. They were cut into 1 small group of 8 points, and each group ran on the atoms 100 times.",
    );
  });

  it("does not read the rulesFirst fact: with or without it, with any count, Step 2 is the same", () => {
    for (const allOpen of [true, false]) {
      const alone = step2(facts({ allOpen }));
      for (const rulesCount of [undefined, 0, 1, 20]) {
        expect(step2(facts({ allOpen, rulesCount })), `allOpen ${allOpen}, rulesFirst.count ${rulesCount}`).toEqual(alone);
      }
    }
  });

  it("drops the Step 2 sentence of the groups when allOpen is missing, and never guesses a wording", () => {
    const f = facts({ allOpen: true, rulesCount: 0 });
    delete (f.groups as Partial<NonNullable<Facts["groups"]>>).allOpen;
    const sentences = step2(f);
    expect(sentences.join(" ")).not.toMatch(/too tangled/);
    // The sentence that names the label is not about the groups and stays.
    expect(sentences).toEqual(["This is a simulation."]);
  });

  it("never says All unless allOpen is true", () => {
    fc.assert(
      fc.property(arbFacts, (g) => {
        for (const s of buildSteps(g, "Hybrid")) {
          for (const text of s.sentences) {
            if (text.startsWith("All ") && text.includes("too tangled")) expect(g.groups?.allOpen).toBe(true);
            if (text.startsWith("The other ") && text.includes("too tangled")) expect(g.groups?.allOpen).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("deriveFacts sets allOpen", () => {
  const sim = (tile: string[]): TutorEvent => ({ type: "run", kind: "simulate", competitor: "Hybrid", round: 1, step: 1, tile });
  const freq = (tile: string[]): TutorEvent => ({
    type: "run",
    kind: "frequencies",
    competitor: "Hybrid",
    round: 1,
    step: 1,
    tile,
    frequencies: Object.fromEntries(tile.map((id, i) => [id, 1 - i / 10])),
    shots: 100,
  });
  const atomPick = (id: string, remaining: number): TutorEvent => ({
    type: "run",
    kind: "pick",
    competitor: "Hybrid",
    round: 1,
    step: 1,
    tile: null,
    picked: [id],
    removed: [],
    source: "atoms",
    remaining,
    top_group: 2,
    rank: 1,
    frequency: 0.9,
    shots: 100,
  });
  const rulePick = (id: string): TutorEvent => ({
    type: "run",
    kind: "pick",
    competitor: "Hybrid",
    round: 1,
    step: 0,
    tile: null,
    picked: [id],
    removed: [],
    source: "rule",
  });
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const derive = (events: TutorEvent[]) =>
    deriveFacts({
      mode: "place",
      seed: 1,
      ids,
      edges: [["p2", "p3"], ["p3", "p4"], ["p4", "p5"], ["p5", "p6"], ["p6", "p2"]],
      events,
      result: { competitors: {} },
    });

  it("is true when the first atoms ran with no rule pick before them", () => {
    const f = derive([sim(["p2", "p3", "p4"]), freq(["p2", "p3", "p4"]), atomPick("p2", 6)]);
    expect(f.groups?.allOpen).toBe(true);
    expect(f.rulesFirst?.count).toBe(0);
  });

  it("is false when a rule pick came before the atoms", () => {
    const f = derive([rulePick("p1"), sim(["p2", "p3", "p4"]), freq(["p2", "p3", "p4"]), atomPick("p2", 5)]);
    expect(f.groups?.allOpen).toBe(false);
    expect(f.rulesFirst?.count).toBe(1);
  });
});
