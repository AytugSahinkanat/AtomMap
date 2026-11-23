// Tests of the Facts on the recorded runs (tutor spec, task 3.3).
// The constants below were hand-checked by the user from their own native run
// before any tutor code existed (honesty rule 8). Do not change them to fit a
// recording. A missing file skips its tests, with the file name in the title.

import { describe, expect, it } from "vitest";
import { buildStraightEdges } from "../edges/straight";
import { deriveFacts, type Facts, type TutorEvent } from "./facts";
import { loadRecorded, recordedTitle, type RecordedName } from "./recorded";

function factsOf(name: RecordedName): Facts {
  const run = loadRecorded(name)!;
  const r = run.request.graph?.r ?? 0;
  return deriveFacts({
    mode: run.request.mode,
    seed: run.request.seed,
    ids: run.request.points.map((p) => p.id),
    edges: buildStraightEdges(run.request.points, r),
    events: run.events as TutorEvent[],
    result: run.result as any,
  });
}

const has = (name: RecordedName) => loadRecorded(name) !== null;

interface Expected {
  rulesFirst: { count: number; first: string; firstNeighboursLeft: number };
  groups: { channel: number; pointsLeft: number; count: number; smallest: number; biggest: number; shots: number };
  group: { size: number; top: [string, string]; topHits: [number, number]; neverLit: number };
  atomPick: { id: string; hits: number; shots: number; rank: number; topGroup: number; pointsLeft: number };
  opened: number;
  /** [channel, available, picks, byRule, byAtoms, byClassic] */
  rounds: [number, number, number, number, number, number][];
  result: { total: number; quantumPicks: number; fiveGhzOnly: number; splits: number; skippedTiles: number };
  totals: { Atoms_Alone: number; Hybrid: number; Annealing_Rules: number; Coin_Flip_Rules: number };
  tie: boolean;
}

const EXPECTED: Record<"hero_seed1" | "sparse_seed1", Expected> = {
  hero_seed1: {
    rulesFirst: { count: 1, first: "ap09", firstNeighboursLeft: 4 },
    groups: { channel: 1, pointsLeft: 65, count: 15, smallest: 4, biggest: 8, shots: 100 },
    group: { size: 8, top: ["ap24", "ap02"], topHits: [97, 53], neverLit: 3 },
    atomPick: { id: "ap60", hits: 34, shots: 100, rank: 5, topGroup: 26, pointsLeft: 65 },
    opened: 0,
    rounds: [
      [1, 70, 11, 8, 3, 0],
      [6, 59, 11, 9, 1, 1],
      [11, 48, 9, 7, 2, 0],
    ],
    result: { total: 31, quantumPicks: 6, fiveGhzOnly: 39, splits: 13, skippedTiles: 0 },
    totals: { Atoms_Alone: 25, Hybrid: 31, Annealing_Rules: 35, Coin_Flip_Rules: 33 },
    tie: false,
  },
  sparse_seed1: {
    rulesFirst: { count: 20, first: "ap00", firstNeighboursLeft: 3 },
    groups: { channel: 6, pointsLeft: 50, count: 8, smallest: 6, biggest: 7, shots: 100 },
    group: { size: 7, top: ["ap34", "ap64"], topHits: [100, 100], neverLit: 3 },
    atomPick: { id: "ap17", hits: 98, shots: 100, rank: 9, topGroup: 20, pointsLeft: 50 },
    opened: 3,
    rounds: [
      [1, 70, 20, 20, 0, 0],
      [6, 50, 17, 15, 2, 0],
      [11, 33, 14, 14, 0, 0],
    ],
    result: { total: 51, quantumPicks: 2, fiveGhzOnly: 19, splits: 0, skippedTiles: 0 },
    totals: { Atoms_Alone: 45, Hybrid: 51, Annealing_Rules: 52, Coin_Flip_Rules: 52 },
    tie: true,
  },
};

for (const name of ["hero_seed1", "sparse_seed1"] as const) {
  const e = EXPECTED[name];
  describe(`Facts of ${name}`, () => {
    const it_ = (title: string, fn: () => void) => it.skipIf(!has(name))(recordedTitle(name, title), fn);

    it_("rulesFirst", () => {
      const f = factsOf(name).rulesFirst!;
      expect({ count: f.count, first: f.first, firstNeighboursLeft: f.firstNeighboursLeft }).toEqual(e.rulesFirst);
    });
    it_("groups", () => {
      const g = factsOf(name).groups!;
      const { ring, ...rest } = g;
      expect(rest).toEqual(e.groups);
      expect(ring.length).toBeGreaterThan(0);
    });
    it_("group", () => {
      const { ring, allClash, ...rest } = factsOf(name).group!;
      expect(rest).toEqual(e.group);
      expect(ring.length).toBe(e.group.size);
      expect(allClash).toBe(false);
    });
    it_("atomPick", () => {
      const { ring, ...rest } = factsOf(name).atomPick!;
      expect(rest).toEqual(e.atomPick);
      expect(ring).toEqual([e.atomPick.id]);
    });
    it_("opened", () => {
      expect(factsOf(name).opened!.count).toBe(e.opened);
    });
    it_("rounds: channel, available, picks by rule, atoms and classic", () => {
      const got = factsOf(name).rounds.map((r) => [
        r.channel,
        r.available,
        r.picks,
        r.byRule,
        r.byAtoms,
        r.byClassic,
      ]);
      expect(got).toEqual(e.rounds);
    });
    it_("result", () => {
      const { quantumShare, atomsNotNeeded, ...rest } = factsOf(name).result!;
      expect(rest).toEqual({ ...e.result });
      expect(atomsNotNeeded).toBe(false);
      expect(quantumShare).toBeGreaterThan(0);
    });
    it_("compare totals and tie", () => {
      const c = factsOf(name).compare!;
      const totals = Object.fromEntries(c.map((x) => [x.name, x.total]));
      expect(totals).toEqual(e.totals);
      const tied = c.filter((x) => x.tie).map((x) => x.name);
      expect(tied.length > 0).toBe(e.tie);
      if (e.tie) expect(tied.sort()).toEqual(["Annealing_Rules", "Coin_Flip_Rules"]);
    });
  });
}

describe("Facts of the rules-only runs", () => {
  for (const name of ["rules_only", "place_rules_only"] as const) {
    describe(name, () => {
      it.skipIf(!has(name))(recordedTitle(name, `${name}: no groups, group, atomPick, opened; atoms not needed`), () => {
        const f = factsOf(name);
        expect(f.groups).toBeUndefined();
        expect(f.group).toBeUndefined();
        expect(f.atomPick).toBeUndefined();
        expect(f.opened).toBeUndefined();
        expect(f.result!.atomsNotNeeded).toBe(true);
      });
    });
  }

  it.skipIf(!has("place_rules_only"))(recordedTitle("place_rules_only", "place_rules_only: one Round, no channel"), () => {
    const f = factsOf("place_rules_only");
    expect(f.rounds).toHaveLength(1);
    expect(f.rounds[0].channel).toBeUndefined();
  });
});

describe("Facts round trip through JSON", () => {
  for (const name of ["hero_seed1", "sparse_seed1", "rules_only", "place_rules_only"] as const) {
    it.skipIf(!has(name))(recordedTitle(name, `${name}: JSON.stringify round trip`), () => {
      const f = factsOf(name);
      expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    });
  }
});

// Hand-built events for the label and atomPick rules (task 3.1 fixes).
function hand(events: TutorEvent[], result: any = { competitors: {} }): Facts {
  return deriveFacts({ mode: "channel_plan", seed: 1, ids: ["a", "b", "c"], edges: [], events, result });
}
const H = { competitor: "Hybrid" } as const;
const pick = (step: number, extra: Partial<TutorEvent> = {}): TutorEvent =>
  ({ ...H, kind: "pick", round: 1, step, picked: ["a"], removed: [], source: "atoms", remaining: 3, top_group: 2, rank: 1, frequency: 0.5, ...extra }) as TutorEvent;
const freqs = (step: number, f: Record<string, number>, shots = 100): TutorEvent =>
  ({ ...H, kind: "frequencies", round: 1, step, tile: Object.keys(f), frequencies: f, shots }) as TutorEvent;

describe("Facts label", () => {
  it("label present -> set", () => {
    expect(hand([], { competitors: {}, meta: { label: "simulation" } }).label).toBe("simulation");
  });
  it("label absent -> key not present", () => {
    expect("label" in hand([], { competitors: {} })).toBe(false);
  });
});

describe("Facts atomPick frequencies event", () => {
  it("uses a frequencies event from an earlier step than the pick", () => {
    const f = hand([freqs(1, { a: 0.5, b: 0.1 }), pick(2)]);
    expect(f.atomPick).toMatchObject({ id: "a", hits: 50, shots: 100 });
  });
  it("a later frequencies event of an earlier step overrides an older one", () => {
    const f = hand([freqs(1, { a: 0.5 }, 100), freqs(2, { a: 0.5 }, 200), pick(3)]);
    expect(f.atomPick).toMatchObject({ hits: 100, shots: 200 });
  });
  it("ignores a frequencies event after the pick or without the id", () => {
    expect(hand([freqs(1, { b: 0.5 }), pick(2), freqs(2, { a: 0.5 })]).atomPick).toBeUndefined();
  });
});
