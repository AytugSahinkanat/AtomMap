// Word tests (experience spec, task 12.3; Requirements 10.3, 13.3, 22.8, 24.5): the new texts of the
// app use neutral words only and no brand name. The Tutor's own sentences have their test in
// tutor/sentences.banned.test.ts.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CLICK_HINT, HONESTY_LINE, SHOW_LIST_LABEL, SHOW_ON_MAP_LABEL, buildAnswer, whichLine, type AnswerInput } from "./answer";
import { atomsNotNeededNote } from "./data/map-checks";
import { handPickReadout, handPickStats, youLine } from "./hand-pick";
import { HOW_TO_READ, LOADING_HINT, YOUR_MAP_HINT, YOUR_PICK_HINT } from "./screens/map";
import { PROTOCOL_SCOPE } from "./screens/results";
import { REPEAT_LABEL, RUN_AGAIN_LABEL, runNumberText } from "./screens/scoreboard";
import { PLACES } from "./settings";
import * as LAB from "./lab/lab-model";
import { EXPERIMENTS } from "./lab/experiments";
import { HISTORY_CAPTION, HISTORY_EMPTY, TOTALS_KEY } from "./lab/history";

/** The Tutor's banned list plus the words of Requirement 10.3. Whole words, any case. */
const BANNED = ["faster", "speed", "wins", "winner", "beats", "beat", "win", "won", "lose", "lost", "better", "worse", "best"];
const PHRASES = ["the atoms chose", "the atoms decided", "the atoms decide everything", "quantum computer"];
const BRANDS = [/\bciti\s*bike\b/i, /\blyft\b/i, /\bmuni\b/i, /\bsfmta\b/i, /\bbay\s*wheels\b/i, /\bmotivate\b/i];

function problems(text: string): string[] {
  const words = text.toLowerCase().split(/[^a-z]+/);
  const lower = text.toLowerCase();
  return [
    ...BANNED.filter((w) => words.includes(w)),
    ...PHRASES.filter((p) => lower.includes(p)),
    ...BRANDS.filter((b) => b.test(text)).map(String),
  ];
}

describe("the new texts use neutral words and no brand name", () => {
  it("fixed texts: How_To_Read, hints, the US notes, run numbers, the answer labels, the protocol line", () => {
    const texts = [
      ...HOW_TO_READ,
      LOADING_HINT,
      YOUR_MAP_HINT,
      YOUR_PICK_HINT,
      atomsNotNeededNote("stops"),
      atomsNotNeededNote("stations"),
      REPEAT_LABEL,
      RUN_AGAIN_LABEL,
      runNumberText(20261204),
      HONESTY_LINE,
      SHOW_ON_MAP_LABEL,
      SHOW_LIST_LABEL,
      CLICK_HINT,
      PROTOCOL_SCOPE,
      ...PLACES.flatMap((p) => [p.label, p.noun]),
    ];
    for (const t of texts) expect(problems(t), t).toEqual([]);
  });

  it("every Lab text: notes, labels, messages, experiment cards, history and the developer box", () => {
    const texts = [
      LAB.LAB_BAR_NOTE, LAB.SEED_NOTE, LAB.R_NOTE, LAB.SHOTS_NOTE, LAB.TOP_NOTE, LAB.walkingRNote(150),
      LAB.DEV_INTRO, LAB.DEV_COMMAND, LAB.DEV_PYTHON, LAB.DEV_NOTE, LAB.README_ENGINE_URL,
      LAB.labLabel({ shots: 20, top_share: 1 }), LAB.labFirstLine({ shots: 100, top_share: 0.4 }), LAB.labBarText("Wifi hall", 5),
      HISTORY_CAPTION, HISTORY_EMPTY, TOTALS_KEY,
      ...EXPERIMENTS.flatMap((x) => [x.title, x.tryText, x.lookText]),
      ...["5", "abc", "1000"].flatMap((t) => [LAB.parseShots(t), LAB.parseTopPercent(t), LAB.parseLabR(t), LAB.parseLabSeed(t)]).map((p) => (p.ok ? "" : p.error)),
      (EXPERIMENTS.find((x) => x.id === "bigger-r")!.set({ seed: 1, r: 20, shots: 100, top_share: 0.4 }, { rReadOnly: true }) as { error: string }).error,
    ];
    for (const t of texts) expect(problems(t), t).toEqual([]);
  });

  it("the You_Line and the Hand_Pick readout, on random small maps", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...ids)), { maxLength: 12 }),
        fc.subarray(ids),
        (edges, picked) => {
          const s = handPickStats(ids, edges.filter(([a, b]) => a !== b), new Set(picked));
          const r = handPickReadout(s);
          for (const t of [youLine(s), r.count, r.hint]) expect(problems(t), t).toEqual([]);
        },
      ),
    );
  });

  it("every Answer_Box text, on every map's words, with random plan sets and Hand_Picks", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const edges: [string, string][] = [["p1", "p2"], ["p2", "p3"], ["p3", "p4"], ["p4", "p5"], ["p5", "p6"], ["p6", "p1"], ["p1", "p4"]];
    const words = [
      { noun: "cafés", pair: "within a 150 m walk", near: "within a 150 m walk of" },
      { noun: "bus stops", pair: "within a 244 m walk", near: "within a 244 m walk of" },
      { noun: "stations", pair: "closer than 305 m", near: "closer than 305 m to" },
      { noun: "points", pair: "closer than 10 m", near: "closer than 10 m to" },
    ];
    const plans = ["Atoms_Alone", "Hybrid", "Annealing_Rules", "Coin_Flip_Rules"];
    fc.assert(
      fc.property(
        fc.constantFrom(...words),
        fc.constantFrom<"place" | "channel_plan">("place", "channel_plan"),
        fc.array(fc.array(fc.subarray(ids), { minLength: 1, maxLength: 3 }), { minLength: 4, maxLength: 4 }),
        fc.option(fc.subarray(ids), { nil: null }),
        fc.constantFrom(...ids),
        (w, mode, sets, hand, click) => {
          const competitors = Object.fromEntries(
            plans.map((p, i) => [
              p,
              mode === "channel_plan"
                ? { rounds: sets[i].map((picks, k) => ({ channel: [1, 6, 11][k], picks })), stats: { total_picks: new Set(sets[i].flat()).size } }
                : { rounds: [{ picks: sets[i][0] }], stats: { total_picks: sets[i][0].length } },
            ]),
          );
          const input: AnswerInput = { mode, words: mode === "channel_plan" ? { noun: "access points", pair: "", near: "" } : w, ids, edges, competitors, hand };
          const a = buildAnswer(input);
          const all = [a.headline, a.found, a.maximal ?? "", a.honesty, ...a.problems, whichLine(a, input, click)?.text ?? ""];
          for (const t of all) expect(problems(t), t).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("the checker itself finds a banned word and a brand", () => {
    expect(problems("This plan wins")).toEqual(["wins"]);
    expect(problems("a Lyft dock")).not.toEqual([]);
    expect(problems("community stations")).toEqual([]);
  });
});
