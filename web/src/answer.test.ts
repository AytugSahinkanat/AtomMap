// Answer_Box (experience spec, task 11.7; Requirements 24.3 to 24.7).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HONESTY_LINE, answerList, buildAnswer, checkPlan, whichLine, type AnswerInput } from "./answer";
import { loadRecorded } from "./tutor/recorded";

const WALK = { noun: "cafés", pair: "within a 150 m walk", near: "within a 150 m walk of" };
const BANNED = ["beat", "beats", "win", "wins", "winner", "won", "lose", "lost", "better", "worse", "best", "faster", "speed"];
const bannedIn = (t: string) => BANNED.filter((w) => t.toLowerCase().split(/[^a-z]+/).includes(w));

/** A path a-b-c-d-e: the largest set is {a, c, e}. */
const ids = ["a", "b", "c", "d", "e"];
const edges: [string, string][] = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]];
const plan = (picks: string[], total = picks.length) => ({ rounds: [{ picks }], stats: { total_picks: total } });
const base = (competitors: Record<string, unknown>, hand: string[] | null = null): AnswerInput => ({
  mode: "place",
  words: WALK,
  ids,
  edges,
  competitors,
  hand,
});

describe("buildAnswer, one round", () => {
  it("takes the most picks of the plans that pass, and names who found it", () => {
    const a = buildAnswer(base({
      Atoms_Alone: plan(["b", "d"]),
      Hybrid: plan(["a", "c", "e"]),
      Annealing_Rules: plan(["a", "c", "e"]),
      Coin_Flip_Rules: plan(["a", "d"]),
    }));
    expect(a.headline).toBe("Answer: you can pick 3 of these 5 cafés, with no two within a 150 m walk.");
    expect(a.found).toBe("Found by atoms + rules (hybrid) and annealing + rules. Atoms alone found 2, coin flip + rules 2.");
    expect(a.source).toEqual({ kind: "plan", plan: "Hybrid" }); // the Hybrid when it found N
    expect(a.maximal).toBe("Every other one is within a 150 m walk of one of them. Click a point to see which.");
    expect(a.honesty).toBe(HONESTY_LINE);
    expect(answerList(a)).toEqual(["a, c, e"]);
  });

  it("shows the first plan in card order when the Hybrid did not find N", () => {
    const a = buildAnswer(base({
      Atoms_Alone: plan(["b", "d"]),
      Hybrid: plan(["a", "d"]),
      Annealing_Rules: plan(["a", "c", "e"]),
      Coin_Flip_Rules: plan(["b", "e"]),
    }));
    expect(a.source).toEqual({ kind: "plan", plan: "Annealing_Rules" });
    expect(a.found).toBe("Found by annealing + rules. Atoms alone found 2, atoms + rules (hybrid) 2, coin flip + rules 2.");
  });

  it("all four found N", () => {
    const p = plan(["a", "c", "e"]);
    const a = buildAnswer(base({ Atoms_Alone: p, Hybrid: p, Annealing_Rules: p, Coin_Flip_Rules: p }));
    expect(a.found).toBe("Found by all four plans.");
  });

  it("the maximality line only when it is true", () => {
    // {a, e} leaves c with no neighbour in the set: not maximal (atoms alone can leave gaps).
    const a = buildAnswer(base({ Atoms_Alone: plan(["a", "e"]) }));
    expect(a.count).toBe(2);
    expect(a.maximal).toBeNull();
    expect(a.problems).toEqual([
      "Atoms + rules (hybrid) did not finish, so it is not counted.",
      "Annealing + rules did not finish, so it is not counted.",
      "Coin flip + rules did not finish, so it is not counted.",
    ]);
  });

  it("a plan whose set fails the check is named and not counted", () => {
    const a = buildAnswer(base({
      Atoms_Alone: plan(["a", "b", "d"]), // a-b clash
      Hybrid: plan(["a", "c"]),
      Annealing_Rules: plan(["a", "c", "e"], 4), // wrong total
      Coin_Flip_Rules: { error: { message: "x" } },
    }));
    expect(a.count).toBe(2);
    expect(a.problems).toEqual([
      "Atoms alone returned a set with a clash (a and b), so it is not counted.",
      "Annealing + rules reports 4 picks but returned 3, so it is not counted.",
      "Coin flip + rules did not finish, so it is not counted.",
    ]);
    expect(a.found).toBe("Found by atoms + rules (hybrid).");
  });

  it("a larger Hand_Pick is the answer; a tie is not", () => {
    const comps = { Atoms_Alone: plan(["b", "d"]), Hybrid: plan(["a", "d"]), Annealing_Rules: plan(["b", "e"]), Coin_Flip_Rules: plan(["a", "d"]) };
    const a = buildAnswer(base(comps, ["a", "c", "e"]));
    expect(a.source).toEqual({ kind: "hand" });
    expect(a.count).toBe(3);
    expect(a.found).toBe(
      "Your own pick has 3 points with no clash, more than the plans found in this run. " +
        "Atoms alone found 2, atoms + rules (hybrid) 2, annealing + rules 2, coin flip + rules 2.",
    );
    expect(buildAnswer(base(comps, ["a", "c"])).source).toEqual({ kind: "plan", plan: "Hybrid" });
  });

  it("the which line names the neighbours in the answer", () => {
    const input = base({ Hybrid: plan(["a", "c", "e"]) });
    const a = buildAnswer(input);
    expect(whichLine(a, input, "b")).toEqual({ text: "b is within a 150 m walk of a and c.", ring: ["a", "c"] });
    expect(whichLine(a, input, "c")).toEqual({ text: "c is one of the 3.", ring: [] });
    const names = new Map([["b", "Kahve Durağı"], ["a", "Moda Café"]]);
    expect(whichLine(a, { ...input, names }, "b")?.text).toBe("Kahve Durağı is within a 150 m walk of Moda Café and c.");
  });

  it("no plan and no hand pick", () => {
    const a = buildAnswer(base({}));
    expect(a.source).toBeNull();
    expect(a.headline).toBe("No plan finished in this run, so there is no answer to show.");
  });
});

describe("buildAnswer, channel plan", () => {
  // A triangle x-y-z plus w joined to x: three channels.
  const cids = ["w", "x", "y", "z", "v"];
  const cedges: [string, string][] = [["x", "y"], ["y", "z"], ["x", "z"], ["w", "x"], ["v", "x"], ["v", "y"], ["v", "z"]];
  const chan = (r1: string[], r6: string[], r11: string[]) => ({
    rounds: [{ channel: 1, picks: r1 }, { channel: 6, picks: r6 }, { channel: 11, picks: r11 }],
    stats: { total_picks: r1.length + r6.length + r11.length },
  });
  const input = (c: Record<string, unknown>, hand: string[] | null = null): AnswerInput => ({
    mode: "channel_plan",
    words: { noun: "access points", pair: "", near: "" },
    ids: cids,
    edges: cedges,
    competitors: c,
    hand,
  });
  it("the headline counts the channels and the 5 GHz rest", () => {
    const a = buildAnswer(input({ Hybrid: chan(["x"], ["y", "w"], ["z"]) }));
    expect(a.headline).toBe("Answer: 4 of 5 access points get a 2.4 GHz channel: 1 on channel 1, 2 on 6 and 1 on 11. The other 1 use 5 GHz only.");
    expect(a.maximal).toBe("Each of the other 1 clashes with an access point on every channel. Click a point to see which.");
    expect(answerList(a)).toEqual(["Channel 1: x", "Channel 6: y, w", "Channel 11: z"]);
    expect(whichLine(a, input({}), "v")?.text).toBe("v clashes with x on channel 1, y on channel 6 and z on channel 11.");
  });
  it("a point in two rounds fails the check; the Hand_Pick is never compared", () => {
    const a = buildAnswer(input({ Hybrid: chan(["x"], ["x"], []), Annealing_Rules: chan(["x"], ["y"], []) }, ["w", "y", "z", "v"]));
    expect(a.problems).toContain("Atoms + rules (hybrid) picked x twice, so it is not counted.");
    expect(a.source).toEqual({ kind: "plan", plan: "Annealing_Rules" });
  });
});

describe("the recorded hero run", () => {
  const run = loadRecorded("hero_seed1");
  it.skipIf(run === null)("gives the numbers of that run", () => {
    const r = run!;
    const a = buildAnswer({
      mode: "channel_plan",
      words: { noun: "access points", pair: "", near: "" },
      ids: r.request.points.map((p) => p.id),
      edges: ((r.request.graph as { edges?: [string, string][] } | undefined)?.edges ?? []),
      competitors: r.result.competitors as Record<string, unknown>,
      hand: null,
    });
    const totals = Object.fromEntries(Object.entries(r.result.competitors as Record<string, any>).map(([k, c]) => [k, c.stats.total_picks]));
    expect(a.problems).toEqual([]);
    expect(a.count).toBe(Math.max(...(Object.values(totals) as number[])));
    expect(a.headline).toMatch(/^Answer: \d+ of 70 access points get a 2\.4 GHz channel: /);
  });
});

describe("the answer texts use neutral words only", () => {
  it("on random small maps and random plan sets", () => {
    const arb = fc.record({
      sets: fc.array(fc.subarray(ids), { minLength: 4, maxLength: 4 }),
      hand: fc.option(fc.subarray(ids), { nil: null }),
      click: fc.constantFrom(...ids),
    });
    fc.assert(fc.property(arb, ({ sets, hand, click }) => {
      const names = ["Atoms_Alone", "Hybrid", "Annealing_Rules", "Coin_Flip_Rules"];
      const comps = Object.fromEntries(names.map((n, i) => [n, plan(sets[i])]));
      const input = base(comps, hand);
      const a = buildAnswer(input);
      const all = [a.headline, a.found, a.maximal ?? "", a.honesty, ...a.problems, whichLine(a, input, click)?.text ?? ""];
      for (const t of all) expect(bannedIn(t), t).toEqual([]);
    }));
  });
});

describe("checkPlan", () => {
  it("passes a clean plan", () => {
    const adj = new Map(ids.map((id) => [id, new Set<string>()]));
    for (const [x, y] of edges) { adj.get(x)!.add(y); adj.get(y)!.add(x); }
    expect(checkPlan("Hybrid", plan(["a", "c"]), "place", new Set(ids), adj).problem).toBeNull();
    expect(checkPlan("Hybrid", plan(["a", "zz"]), "place", new Set(ids), adj).problem).toMatch(/not on this map/);
  });
});
