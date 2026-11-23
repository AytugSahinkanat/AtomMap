import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { arbFacts } from "./generators";
import { NON_HYBRID_SENTENCE, buildIdle, buildSteps } from "./sentences";

const BANNED = [
  "faster",
  "speed",
  "wins",
  "winner",
  "beats",
  "best",
  "the atoms chose",
  "the atoms decided",
];

function bannedIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED.filter((w) => lower.includes(w));
}

describe("tutor sentences: banned words", () => {
  // Feature: tutor, Property 2: Banned words never appear
  // **Validates: Requirements 4.6, 6.3, 6.7**
  it("no sentence of any Step contains a banned word", () => {
    fc.assert(
      fc.property(arbFacts, (facts) => {
        for (const step of buildSteps(facts, "Hybrid")) {
          for (const s of step.sentences) {
            const found = bannedIn(s);
            if (found.length > 0) {
              throw new Error(`banned word ${JSON.stringify(found)} in "${s}"`);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("idle text and the non-Hybrid sentence have no banned word", () => {
    for (const s of [...buildIdle(), NON_HYBRID_SENTENCE]) {
      expect(bannedIn(s)).toEqual([]);
    }
  });
});
