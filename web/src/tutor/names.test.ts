// Point names in the Tutor (place maps): the text names the Points, the rings stay ids, and
// without names nothing changes (hall and Your map).
import { describe, expect, it } from "vitest";
import { deriveFacts, whyFacts, type TutorEvent } from "./facts";
import { buildSteps, buildWhy } from "./sentences";
import { labelFrom, nameFacts, nameWhy } from "./names";
import { loadRecorded } from "./recorded";

const run = loadRecorded("hero_seed1");

describe("names in the Tutor", () => {
  it.skipIf(run === null)("every written-out id becomes a name; the rings stay ids", () => {
    const r = run!;
    const ids = r.request.points.map((p) => p.id);
    const facts = deriveFacts({
      mode: "channel_plan",
      seed: r.request.seed,
      ids,
      edges: ((r.request.graph as { edges?: [string, string][] } | undefined)?.edges ?? []),
      events: r.events as unknown as TutorEvent[],
      result: r.result as never,
    });
    // A name for every Point, with no id inside it.
    const names = new Map(ids.map((id, i) => [id, `Place number ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`]));
    const label = labelFrom(names);
    const idToken = /\bap\d+\b/;
    const plain = buildSteps(facts, "Hybrid");
    const named = buildSteps(nameFacts(facts, label), "Hybrid");
    expect(named.map((s) => s.key)).toEqual(plain.map((s) => s.key)); // the same Steps, the same facts needed
    expect(named.map((s) => s.ring)).toEqual(plain.map((s) => s.ring));
    for (const s of named) for (const t of s.sentences) expect(t, t).not.toMatch(idToken);
    expect(named.some((s) => s.sentences.some((t) => t.includes("Place number")))).toBe(true);
    for (const id of ids) {
      const why = whyFacts(facts, id);
      const a = buildWhy(nameWhy(why, label));
      const b = buildWhy(why);
      expect(a.sentences.length).toBe(b.sentences.length);
      for (const t of a.sentences) expect(t, t).not.toMatch(idToken);
      expect(why.ring.every((x) => ids.includes(x))).toBe(true); // ids, for the map
    }
  });

  it.skipIf(run === null)("without names the text is exactly as before", () => {
    const r = run!;
    const ids = r.request.points.map((p) => p.id);
    const facts = deriveFacts({
      mode: "channel_plan",
      seed: r.request.seed,
      ids,
      edges: ((r.request.graph as { edges?: [string, string][] } | undefined)?.edges ?? []),
      events: r.events as unknown as TutorEvent[],
      result: r.result as never,
    });
    expect(buildSteps(nameFacts(facts, labelFrom()), "Hybrid")).toEqual(buildSteps(facts, "Hybrid"));
    for (const id of ids.slice(0, 10)) expect(buildWhy(nameWhy(whyFacts(facts, id), labelFrom()))).toEqual(buildWhy(whyFacts(facts, id)));
  });

  it("a Point without a name keeps its id", () => {
    const label = labelFrom(new Map([["stop001", "Mission Street & 16th Street"]]));
    expect(label("stop001")).toBe("Mission Street & 16th Street");
    expect(label("stop000")).toBe("stop000");
  });
});
