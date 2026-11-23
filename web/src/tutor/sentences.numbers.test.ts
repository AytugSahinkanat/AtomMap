import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatPercent } from "../scoreboard-model";
import type { Facts, WhyFacts } from "./facts";
import { arbFacts, arbWhy } from "./generators";
import { buildSteps, buildWhy } from "./sentences";

// Every numeric field of Facts, formatted the way sentences write it.
function allowedNumbers(f: Facts | WhyFacts): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, key?: string): void => {
    if (typeof v === "number") {
      out.add(String(v));
      if (key === "quantumShare") out.add(formatPercent(v).replace("%", ""));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(f);
  return out;
}

function numbersIn(text: string): string[] {
  const cleaned = text
    .replace(/\b(?:ap|cafe)\d+\b/g, " ")
    .replace(/5 GHz/g, " ");
  return cleaned.match(/\d+(?:\.\d+)?/g) ?? [];
}

describe("tutor sentences: numbers", () => {
  // Feature: tutor, Property 1: Every number in a sentence is a fact of the run
  // **Validates: Requirements 6.1, 6.5**
  it("every number in a sentence is a Facts field", () => {
    fc.assert(
      fc.property(arbFacts, (facts) => {
        const allowed = allowedNumbers(facts);
        for (const step of buildSteps(facts, "Hybrid")) {
          for (const s of step.sentences) {
            for (const num of numbersIn(s)) {
              if (!allowed.has(num)) {
                throw new Error(`number ${num} in "${s}" is not a Facts field`);
              }
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: tutor, Property 1: Every number in a sentence is a fact of the run
  // **Validates: Requirements 6.1, 6.5**
  it("every number in a Why_Answer is a WhyFacts field", () => {
    fc.assert(
      fc.property(arbWhy, (why) => {
        const allowed = allowedNumbers(why);
        for (const s of buildWhy(why).sentences) {
          for (const num of numbersIn(s)) {
            if (!allowed.has(num)) throw new Error(`number ${num} in "${s}" is not a WhyFacts field`);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});