// Checks over the recorded runs (tutor spec, task 2.2; Requirements 5.5, 6.6).
// A missing file skips its tests, with the file name in the test title.

import { describe, expect, it } from "vitest";
import {
  RECORDED_NAMES,
  hybridEvents,
  loadRecorded,
  recordedTitle,
  type RecordedName,
  type RecordedRun,
} from "./recorded";

/** Property 4 on a recording: returns the problems found (empty when fine). */
export function roundCoverageProblems(run: RecordedRun): string[] {
  const problems: string[] = [];
  const events = hybridEvents(run).filter((e) => e.kind === "pick");
  const rounds = [...new Set(events.map((e) => e.round as number))].sort((a, b) => a - b);
  const picked = new Set<string>(); // picked in earlier Rounds
  for (const round of rounds) {
    const available = new Set(run.request.points.map((p) => p.id).filter((id) => !picked.has(id)));
    const pickedHere: string[] = [];
    const removedHere: string[] = [];
    for (const e of events.filter((x) => x.round === round)) {
      pickedHere.push(...(e.picked ?? []));
      removedHere.push(...(e.removed ?? []));
    }
    const seen = new Map<string, string>();
    for (const [list, what] of [[pickedHere, "picked"], [removedHere, "removed"]] as const) {
      for (const id of list) {
        if (seen.has(id)) problems.push(`round ${round}: ${id} is ${seen.get(id)} and ${what}`);
        else seen.set(id, what);
        if (!available.has(id)) problems.push(`round ${round}: ${id} is not available`);
      }
    }
    for (const id of available) {
      if (!seen.has(id)) problems.push(`round ${round}: ${id} is neither picked nor removed`);
    }
    pickedHere.forEach((id) => picked.add(id));
  }
  return problems;
}

describe("recorded runs: every available Point ends its Round picked or removed", () => {
  for (const name of RECORDED_NAMES) {
    const run = loadRecorded(name);
    it.skipIf(run === null)(recordedTitle(name, `${name}: picked and removed cover the Round, disjoint`), () => {
      const events = hybridEvents(run!).filter((e) => e.kind === "pick");
      expect(events.length, "no Hybrid pick events recorded").toBeGreaterThan(0);
      expect(roundCoverageProblems(run!)).toEqual([]);
    });
  }
});

describe("recorded runs: use of the atoms", () => {
  const simulateCount = (name: RecordedName) =>
    hybridEvents(loadRecorded(name)!).filter((e) => e.kind === "simulate").length;
  const notNeeded = (name: RecordedName) =>
    loadRecorded(name)!.result.competitors.Hybrid?.stats?.atoms_not_needed;

  for (const name of ["rules_only", "place_rules_only"] as const) {
    it.skipIf(loadRecorded(name) === null)(
      recordedTitle(name, `${name}: atoms_not_needed is true and there is no simulate event`),
      () => {
        expect(notNeeded(name)).toBe(true);
        expect(simulateCount(name)).toBe(0);
      },
    );
  }

  it.skipIf(loadRecorded("hero_seed1") === null)(
    recordedTitle("hero_seed1", "hero_seed1: at least one simulate event"),
    () => {
      expect(simulateCount("hero_seed1")).toBeGreaterThanOrEqual(1);
    },
  );
});
