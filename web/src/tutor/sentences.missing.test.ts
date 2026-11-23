import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Facts, WhyFacts } from "./facts";
import { arbFacts, arbWhy } from "./generators";
import { buildSteps, buildWhy, RESULT_AND_COMPARE, roundDefs, SENTENCES, whyDefs, type SentenceDef } from "./sentences";

const SKIP_TOP = new Set(["mode", "seed", "rounds"]);

/** Every removable field path of a Facts: top level, one level down, array tails. */
function removablePaths(f: Facts): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (SKIP_TOP.has(k) || v === undefined) continue;
    out.push(k);
    if (k === "compare") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 === undefined) continue;
        out.push(`${k}.${k2}`);
        if (Array.isArray(v2) && v2.length > 1 && (k2 === "top" || k2 === "topHits")) {
          out.push(`${k}.${k2}.1`);
        }
      }
    }
  }
  f.rounds.forEach((r, i) => {
    for (const k of Object.keys(r)) {
      if (k === "ring") continue;
      out.push(`rounds.${i}.${k}`);
    }
  });
  return out;
}

function without(f: Facts, path: string): Facts {
  const copy = JSON.parse(JSON.stringify(f));
  const parts = path.split(".");
  let cur: any = copy;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur.length = Number(last);
  else delete cur[last];
  return copy;
}

const affects = (needs: string[], path: string): boolean =>
  needs.some((n) => n === path || n.startsWith(`${path}.`));

const STEP_KEY: Record<number, string> = { 1: "rules-first", 2: "groups", 3: "group", 4: "pick", 5: "after" };

const BAD = /undefined|NaN|null/;

describe("tutor sentences: missing facts", () => {
  // Feature: tutor, Property 3: A missing fact drops its sentence and nothing else
  // **Validates: Requirements 2.6, 4.14, 6.8**
  it("a missing fact drops its sentence and nothing else", () => {
    fc.assert(
      fc.property(arbFacts, fc.nat(), (facts, pick) => {
        const paths = removablePaths(facts);
        fc.pre(paths.length > 0);
        const path = paths[pick % paths.length];
        const reduced = without(facts, path);

        const fullSteps = buildSteps(facts, "Hybrid");
        const redSteps = buildSteps(reduced, "Hybrid");
        const fullByKey = new Map(fullSteps.map((s) => [s.key, s.sentences]));
        const redByKey = new Map(redSteps.map((s) => [s.key, s.sentences]));

        // No placeholder text, no empty Step, no repeated Step key.
        expect(new Set(redSteps.map((s) => s.key)).size).toBe(redSteps.length);
        for (const s of redSteps) {
          expect(s.sentences.length).toBeGreaterThan(0);
          for (const t of s.sentences) expect(t).not.toMatch(BAD);
        }

        // Steps 1 to 5: exactly the full sentences minus those that need the field.
        for (const [step, key] of Object.entries(STEP_KEY)) {
          const full = fullByKey.get(key);
          if (full === undefined) continue; // not shown for the full Facts (e.g. atoms not needed)
          const expected = SENTENCES.filter(
            (d) =>
              d.step === Number(step) &&
              !affects(d.needs, path) &&
              d.needs.every((p) => hasPath(facts, p)) &&
              (d.when ? d.when(facts) : true),
          ).map((d) => d.make(facts));
          expect(full).toEqual(expect.arrayContaining(expected));
          expect(redByKey.get(key) ?? []).toEqual(expected);
        }

        // Steps 6 to 8: the same exact check as Steps 1 to 5.
        const expectFor = (key: string, defs: SentenceDef[], step: number) => {
          const expected = defs
            .filter(
              (d) =>
                d.step === step &&
                !affects(d.needs, path) &&
                d.needs.every((p) => hasPath(facts, p)) &&
                (d.when ? d.when(facts) : true),
            )
            .map((d) => d.make(facts));
          expect(redByKey.get(key) ?? [], `removing "${path}" changed ${key}`).toEqual(expected);
        };
        facts.rounds.forEach((_, i) => expectFor(`round-${i + 1}`, roundDefs(i), 6));
        expectFor("result", RESULT_AND_COMPARE, 7);
        expectFor("compare", RESULT_AND_COMPARE, 8);
      }),
      { numRuns: 300 },
    );
  });
});

describe("tutor sentences: missing facts in a Why_Answer", () => {
  const whyPaths = (w: WhyFacts): string[] => [
    ...(w.clashes !== undefined ? ["clashes"] : []),
    ...w.rounds.flatMap((r, i) => Object.keys(r).map((k) => `rounds.${i}.${k}`)),
  ];

  // Feature: tutor, Property 3: A missing fact drops its sentence and nothing else
  // **Validates: Requirements 2.6, 4.14, 6.8**
  it("a missing WhyFacts field drops its sentence and nothing else", () => {
    fc.assert(
      fc.property(arbWhy, fc.nat(), (why, pick) => {
        const paths = whyPaths(why);
        fc.pre(paths.length > 0);
        const path = paths[pick % paths.length];
        const reduced = without(why as unknown as Facts, path) as unknown as WhyFacts;

        const got = buildWhy(reduced).sentences;
        for (const t of got) expect(t).not.toMatch(BAD);

        // Defs with `absent` (the "no record" sentence) are checked on the
        // reduced facts: removing `clashes` may add it. Every other def is
        // kept or dropped exactly as in the full build.
        const satisfied = (w: WhyFacts, d: { needs: string[]; when?: (w: WhyFacts) => boolean }) =>
          d.needs.every((p) => hasPath(w, p)) && (d.when ? d.when(w) : true);
        const reducedDefs = whyDefs(reduced);
        const expected = whyDefs(why)
          .filter((d) => (d.absent ? satisfied(reduced, d) : !affects(d.needs, path) && satisfied(why, d)))
          .map((d) => d.make(d.absent ? reduced : why));
        expect(reducedDefs.length).toBe(whyDefs(why).length);
        expect(got, `removing "${path}"`).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("the no-record sentence is built exactly when clashes and rounds are both empty", () => {
    const base = { id: "ap01", mode: "channel_plan" as const, ring: ["ap01"] };
    expect(buildWhy({ ...base, rounds: [] }).sentences).toEqual(["This run holds no record of this point."]);
    expect(buildWhy({ ...base, clashes: 0, rounds: [] }).sentences).toEqual(["ap01 clashes with 0 other points."]);
    // A lost channel drops the sentence and does not switch to Place wording.
    expect(buildWhy({ ...base, clashes: 2, rounds: [{ outcome: "rule" }] }).sentences).toEqual(["ap01 clashes with 2 other points."]);
  });
});
function hasPath(f: unknown, path: string): boolean {
  let cur: any = f;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined && cur !== null;
}
