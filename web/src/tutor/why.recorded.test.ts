// Recorded run checks for the Why_Answers (tutor spec, task 6.5).
// Every Point of every recorded run. A missing file skips its tests.

import { describe, expect, it } from "vitest";
import { buildStraightEdges } from "../edges/straight";
import { deriveFacts, whyFacts, type Facts, type TutorEvent, type WhyFacts } from "./facts";
import { buildWhy } from "./sentences";
import { RECORDED_NAMES, loadRecorded, recordedTitle, type RecordedName } from "./recorded";

const BANNED = ["faster", "speed", "wins", "winner", "beats", "best", "the atoms chose", "the atoms decided"];

function factsOf(name: RecordedName): Facts {
  const run = loadRecorded(name)!;
  return deriveFacts({
    mode: run.request.mode,
    seed: run.request.seed,
    ids: run.request.points.map((p) => p.id),
    edges: buildStraightEdges(run.request.points, run.request.graph?.r ?? 0),
    events: run.events as TutorEvent[],
    result: run.result as any,
  });
}

/** Every Why_Answer of the run: [WhyFacts, its sentences]. */
function allWhy(name: RecordedName): [WhyFacts, string[]][] {
  const f = factsOf(name);
  const ids = loadRecorded(name)!.request.points.map((p) => p.id);
  return ids.map((id) => {
    const w = whyFacts(f, id);
    return [w, buildWhy(w).sentences];
  });
}

function numbersOf(w: WhyFacts): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "number") out.add(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(w);
  return out;
}

describe.each(RECORDED_NAMES)("Why_Answers of %s", (name) => {
  const it_ = (title: string, fn: () => void) =>
    it.skipIf(loadRecorded(name) === null)(recordedTitle(name, title), fn);

  it_("have sentences, no banned word, at most 260 characters", () => {
    for (const [w, sentences] of allWhy(name)) {
      expect(sentences.length, w.id).toBeGreaterThan(0);
      const text = sentences.join(" ");
      expect(text.length, text).toBeLessThanOrEqual(260);
      const lower = text.toLowerCase();
      expect(BANNED.filter((b) => lower.includes(b)), text).toEqual([]);
      expect(text).not.toMatch(/undefined|NaN|null/);
    }
  });

  it_("use only numbers that are facts of the Point", () => {
    const ids = [...loadRecorded(name)!.request.points.map((p) => p.id)].sort((a, b) => b.length - a.length);
    for (const [w, sentences] of allWhy(name)) {
      const allowed = numbersOf(w);
      // Point ids are removed first (the hand-made trees use ids like "t0").
      let cleaned = sentences.join(" ");
      for (const id of ids) cleaned = cleaned.split(id).join(" ");
      cleaned = cleaned.replace(/5 GHz/g, " ");
      for (const num of cleaned.match(/\d+(?:\.\d+)?/g) ?? []) {
        expect(allowed.has(num), `${num} in "${sentences.join(" ")}"`).toBe(true);
      }
    }
  });
});

describe("Why_Answers of place_rules_only (wording)", () => {
  it.skipIf(loadRecorded("place_rules_only") === null)(
    recordedTitle("place_rules_only", "say picked by a rule or not picked, its neighbour <id> was picked"),
    () => {
      for (const [w, sentences] of allWhy("place_rules_only")) {
        const rounds = sentences.slice(w.clashes === undefined ? 0 : 1);
        expect(rounds.length, w.id).toBeGreaterThan(0);
        for (const s of rounds) {
          expect(s, w.id).toMatch(/^(?:Picked by a rule\.|Not picked, its neighbour [a-z]+\d+ was picked\.)$/);
        }
        expect(sentences.join(" ")).not.toMatch(/channel|5 GHz/i);
      }
    },
  );
});
