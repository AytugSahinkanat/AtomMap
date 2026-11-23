// Shared fast-check generators for the Tutor property tests (tutor spec,
// tasks 4.3 to 4.5). Test helper only: not imported by app code.
// Every Facts field is optional so absent facts are covered. Ids use the
// prefixes "ap" and "cafe", so an id can never contain a banned word.

import fc from "fast-check";
import { CARD_ORDER, type EngineName } from "../scoreboard-model";
import type { Facts, RoundFacts, WhyFacts, WhyRound } from "./facts";

/** Counts: small, typical and worst case values (long numbers). */
export const arbCount = fc.oneof(
  { weight: 6, arbitrary: fc.nat({ max: 200 }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 1, 2, 99999, 1000000, 2147483647) },
);

/** Fractions for quantumShare, in [0, 1], including the ends. */
export const arbFraction = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(0, 1, 0.5, 0.171, 0.15),
);

export const arbId = fc.oneof(
  fc.nat({ max: 999 }).map((i) => `ap${String(i).padStart(2, "0")}`),
  fc.nat({ max: 999 }).map((i) => `cafe${String(i).padStart(3, "0")}`),
);

export const arbLabel = fc.constantFrom("simulation", "real hardware");

const arbIds = (max: number) => fc.array(arbId, { maxLength: max });

const arbRound: fc.Arbitrary<RoundFacts> = fc.record(
  {
    channel: fc.constantFrom(1, 6, 11),
    available: arbCount,
    picks: arbCount,
    byRule: arbCount,
    byAtoms: arbCount,
    byClassic: arbCount,
    ring: arbIds(6),
  },
  { requiredKeys: ["available", "picks", "byRule", "byAtoms", "byClassic", "ring"] },
);

const arbRulesFirst = fc.record(
  {
    count: arbCount,
    first: arbId,
    firstNeighboursLeft: fc.oneof(fc.nat({ max: 4 }), arbCount),
    ring: arbIds(6),
  },
  { requiredKeys: ["count", "ring"] },
);

const arbGroups = fc.record(
  {
    channel: fc.constantFrom(1, 6, 11),
    pointsLeft: arbCount,
    count: arbCount,
    smallest: arbCount,
    biggest: arbCount,
    shots: arbCount,
    ring: arbIds(8),
  },
  { requiredKeys: ["pointsLeft", "count", "smallest", "biggest", "shots", "ring"] },
);

const arbGroup = fc.record(
  {
    size: arbCount,
    top: fc.tuple(arbId, fc.option(arbId, { nil: undefined })).map(([a, b]) => (b === undefined ? ([a] as [string, string?]) : ([a, b] as [string, string?]))),
    topHits: fc
      .tuple(arbCount, fc.option(arbCount, { nil: undefined }))
      .map(([a, b]) => (b === undefined ? ([a] as [number, number?]) : ([a, b] as [number, number?]))),
    neverLit: arbCount,
    allClash: fc.boolean(),
    ring: arbIds(8),
  },
  { requiredKeys: ["size", "top", "topHits", "neverLit", "allClash", "ring"] },
);

const arbAtomPick = fc.record({
  id: arbId,
  pointsLeft: arbCount,
  topGroup: arbCount,
  rank: arbCount,
  hits: arbCount,
  shots: arbCount,
  ring: arbIds(2),
});

const arbOpened = fc.record({ count: arbCount, ring: arbIds(6) });

const arbResult = fc.record(
  {
    total: arbCount,
    quantumShare: arbFraction,
    quantumPicks: arbCount,
    fiveGhzOnly: arbCount,
    splits: arbCount,
    skippedTiles: arbCount,
    atomsNotNeeded: fc.boolean(),
  },
  { requiredKeys: ["total", "quantumShare", "quantumPicks", "splits", "skippedTiles", "atomsNotNeeded"] },
);

const arbCompare = fc
  .tuple(fc.subarray([...CARD_ORDER] as EngineName[]), fc.array(fc.tuple(arbCount, fc.boolean()), { minLength: 4, maxLength: 4 }))
  .map(([names, vals]) => names.map((name, i) => ({ name, total: vals[i][0], tie: vals[i][1] })));

/** Any Facts: every optional field may be absent; rounds may be empty. */
export const arbFacts: fc.Arbitrary<Facts> = fc.record(
  {
    label: arbLabel,
    mode: fc.constantFrom("channel_plan" as const, "place" as const),
    seed: arbCount,
    rulesFirst: arbRulesFirst,
    groups: arbGroups,
    group: arbGroup,
    atomPick: arbAtomPick,
    opened: arbOpened,
    rounds: fc.array(arbRound, { maxLength: 3 }),
    result: arbResult,
    compare: arbCompare,
  },
  { requiredKeys: ["mode", "seed", "rounds"] },
) as fc.Arbitrary<Facts>;

const arbWhyRound: fc.Arbitrary<WhyRound> = fc.record(
  {
    channel: fc.constantFrom(1, 6, 11),
    outcome: fc.constantFrom("rule" as const, "atoms" as const, "classic" as const, "neighbour" as const, "fiveGhz" as const),
    by: arbId,
  },
  { requiredKeys: ["outcome"] },
);

/**
 * Any WhyFacts: `clashes` and every round's `channel` and `by` may be absent,
 * rounds may be empty (the "no record" case), mode is either.
 */
export const arbWhy: fc.Arbitrary<WhyFacts> = fc.record(
  {
    id: arbId,
    mode: fc.constantFrom("channel_plan" as const, "place" as const),
    clashes: arbCount,
    rounds: fc.array(arbWhyRound, { maxLength: 4 }),
    ring: arbIds(4),
  },
  { requiredKeys: ["id", "mode", "rounds", "ring"] },
) as fc.Arbitrary<WhyFacts>;