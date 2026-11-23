import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Facts } from "./facts";
import { arbFacts } from "./generators";
import { buildSteps, RESULT_AND_COMPARE, roundDefs, SENTENCES, type SentenceDef } from "./sentences";

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

function hasPath(f: unknown, path: string): boolean {
  let cur: any = f;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined && cur !== null;
}
