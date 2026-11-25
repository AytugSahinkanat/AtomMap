// Tutor sentences (tutor spec, task 4.1: Steps 1 to 5).
// Pure text. No DOM and no arithmetic: every number written here is a Facts
// field, passed through String(). A sentence lists the Facts paths it needs
// in `needs` and is not built when one is missing (Requirement 4.14).
// Task 4.2 adds Steps 6 to 8, the idle text and the non-Hybrid sentence.

import { CARD_LABELS, CARD_ORDER, formatPercent, type EngineName } from "../scoreboard-model";
import type { Facts, WhyFacts } from "./facts";

export interface SentenceDef {
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Dot paths into Facts (array indexes allowed, e.g. "group.top.1"). */
  needs: string[];
  /** Extra guard on Facts that are present (comparisons only). */
  when?: (f: Facts) => boolean;
  make(f: Facts): string;
}

export interface Step {
  key: string;
  sentences: string[];
  ring: string[];
}

function has(f: unknown, path: string): boolean {
  let cur: any = f;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return false;
    cur = cur[part];
  }
  return cur !== undefined && cur !== null;
}

const n = (v: number | undefined): string => String(v);
const noun = (v: number | undefined, one: string, many: string): string => (v === 1 ? one : many);

export const SENTENCES: SentenceDef[] = [
  // Step 1: rules first
  {
    step: 1,
    needs: ["rulesFirst.count", "result.atomsNotNeeded"],
    when: (f) => f.rulesFirst!.count === 0 && f.result!.atomsNotNeeded !== true,
    make: () => "The rules found no safe pick, so the atoms went first.",
  },
  {
    step: 1,
    needs: ["result.total", "result.atomsNotNeeded"],
    when: (f) => f.result!.atomsNotNeeded === true,
    make: (f) => `The rules made all ${n(f.result!.total)} ${noun(f.result!.total, "pick", "picks")} on their own.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "result.atomsNotNeeded"],
    when: (f) => f.rulesFirst!.count > 0 && f.result!.atomsNotNeeded !== true,
    make: (f) =>
      `Before any atoms ran, the rules made ${n(f.rulesFirst!.count)} safe ${noun(f.rulesFirst!.count, "pick", "picks")}.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "rulesFirst.first", "rulesFirst.firstNeighboursLeft"],
    when: (f) => f.rulesFirst!.count > 0 && f.rulesFirst!.firstNeighboursLeft === 0,
    make: (f) =>
      `The first was ${f.rulesFirst!.first}. Among the points left at that moment it has no neighbours, so picking it is always safe.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "rulesFirst.first", "rulesFirst.firstNeighboursLeft"],
    when: (f) => f.rulesFirst!.count > 0 && f.rulesFirst!.firstNeighboursLeft === 1,
    make: (f) =>
      `The first was ${f.rulesFirst!.first}. Among the points left at that moment it has one neighbour, and the two clash with each other, so picking it is always safe.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "rulesFirst.first", "rulesFirst.firstNeighboursLeft"],
    when: (f) => f.rulesFirst!.count > 0 && f.rulesFirst!.firstNeighboursLeft! >= 2,
    make: (f) =>
      `The first was ${f.rulesFirst!.first}. Among the points left at that moment it has ${n(f.rulesFirst!.firstNeighboursLeft)} neighbours, and they all clash with each other and with it, so picking it is always safe.`,
  },

  // Step 2: groups
  {
    step: 2,
    needs: ["groups.channel", "groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest", "groups.shots"],
    when: (f) => f.mode === "channel_plan" && f.groups!.smallest !== f.groups!.biggest,
    make: (f) =>
      `The other ${n(f.groups!.pointsLeft)} points were too tangled for the rules. On channel ${n(f.groups!.channel)} they were cut into ${n(f.groups!.count)} small ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.smallest)} to ${n(f.groups!.biggest)} points, and each group ran on the atoms ${n(f.groups!.shots)} times.`,
  },
  {
    step: 2,
    needs: ["groups.channel", "groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest", "groups.shots"],
    when: (f) => f.mode === "channel_plan" && f.groups!.smallest === f.groups!.biggest,
    make: (f) =>
      `The other ${n(f.groups!.pointsLeft)} points were too tangled for the rules. On channel ${n(f.groups!.channel)} they were cut into ${n(f.groups!.count)} small ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.biggest)} ${noun(f.groups!.biggest, "point", "points")}, and each group ran on the atoms ${n(f.groups!.shots)} times.`,
  },
  {
    step: 2,
    needs: ["groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest", "groups.shots"],
    when: (f) => f.mode === "place" && f.groups!.smallest !== f.groups!.biggest,
    make: (f) =>
      `The other ${n(f.groups!.pointsLeft)} points were too tangled for the rules. They were cut into ${n(f.groups!.count)} small ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.smallest)} to ${n(f.groups!.biggest)} points, and each group ran on the atoms ${n(f.groups!.shots)} times.`,
  },
  {
    step: 2,
    needs: ["groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest", "groups.shots"],
    when: (f) => f.mode === "place" && f.groups!.smallest === f.groups!.biggest,
    make: (f) =>
      `The other ${n(f.groups!.pointsLeft)} points were too tangled for the rules. They were cut into ${n(f.groups!.count)} small ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.biggest)} ${noun(f.groups!.biggest, "point", "points")}, and each group ran on the atoms ${n(f.groups!.shots)} times.`,
  },
  {
    // Honesty rule 2: the label word is shown. Without a label this
    // sentence drops and the rest of Step 2 stays.
    step: 2,
    needs: ["label"],
    make: (f) => `This is ${f.label === "simulation" ? "a simulation" : f.label}.`,
  },

  // Step 3: one group
  {
    step: 3,
    needs: ["group.size"],
    make: () =>
      "Close atoms can't light up together, so a point that fits well with its group lights up more often.",
  },
  {
    step: 3,
    needs: ["group.size"],
    make: (f) => `Take the biggest group, with ${n(f.group!.size)} ${noun(f.group!.size, "point", "points")}.`,
  },
  {
    step: 3,
    needs: ["group.allClash"],
    when: (f) => f.group!.allClash === true,
    make: () => "All its points clash with each other, so the atoms had no clear favourite.",
  },
  {
    step: 3,
    needs: ["group.size", "group.allClash", "group.top.0", "group.top.1", "group.topHits.0", "group.topHits.1", "groups.shots"],
    when: (f) => f.group!.allClash === false && f.group!.size >= 2,
    make: (f) =>
      `Its two most often lit points are ${f.group!.top[0]} (${n(f.group!.topHits[0])} of ${n(f.groups!.shots)} tries) and ${f.group!.top[1]} (${n(f.group!.topHits[1])} of ${n(f.groups!.shots)} tries).`,
  },
  {
    step: 3,
    // A one-point group has one lit point. Keyed on size, not on a missing
    // top[1], so a lost second entry drops the sentence above (Req. 4.14).
    needs: ["group.size", "group.allClash", "group.top.0", "group.topHits.0", "groups.shots"],
    when: (f) => f.group!.allClash === false && f.group!.size === 1,
    make: (f) =>
      `Its most often lit point is ${f.group!.top[0]} (${n(f.group!.topHits[0])} of ${n(f.groups!.shots)} tries).`,
  },
  {
    step: 3,
    needs: ["group.neverLit"],
    make: (f) =>
      `${n(f.group!.neverLit)} of its ${noun(f.group!.neverLit, "point", "points")} never lit up.`,
  },

  // Step 4: one pick
  {
    step: 4,
    needs: ["atomPick.id", "atomPick.pointsLeft", "atomPick.topGroup", "atomPick.rank", "atomPick.hits", "atomPick.shots"],
    make: (f) =>
      `The app doesn't just take the top point. It ranks the ${n(f.atomPick!.pointsLeft)} ${noun(f.atomPick!.pointsLeft, "point", "points")} left by how often they lit up, keeps the top ${n(f.atomPick!.topGroup)} and picks one of them at random: ${f.atomPick!.id}, rank ${n(f.atomPick!.rank)}, lit up in ${n(f.atomPick!.hits)} of ${n(f.atomPick!.shots)} tries.`,
  },

  // Step 5: after it
  {
    step: 5,
    needs: ["opened.count"],
    when: (f) => f.opened!.count === 0,
    make: () => "That pick opened no new safe picks for the rules.",
  },
  {
    step: 5,
    needs: ["opened.count"],
    when: (f) => f.opened!.count > 0,
    make: (f) =>
      `That pick opened ${n(f.opened!.count)} new safe ${noun(f.opened!.count, "pick", "picks")} for the rules.`,
  },
];

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

// Step 6: one per Round (task 4.2). Built per index so each sentence can name
// the Round fields it needs. No channel wording in Place (Requirement 4.13).
export function roundDefs(i: number): SentenceDef[] {
  const r = (f: Facts) => f.rounds[i];
  const base = `rounds.${i}`;
  return [
    {
      step: 6,
      needs: [`${base}.channel`, `${base}.available`, `${base}.picks`],
      when: (f) => f.mode === "channel_plan",
      make: (f) =>
        `Channel ${n(r(f).channel)}: ${n(r(f).available)} ${noun(r(f).available, "point", "points")} to choose from, ${n(r(f).picks)} ${noun(r(f).picks, "pick", "picks")}.`,
    },
    {
      step: 6,
      needs: [`${base}.available`, `${base}.picks`],
      // Keyed on the Mode only, so a missing channel in Channel_Plan drops
      // the sentence above instead of switching wording (Req. 4.13, 4.14).
      when: (f) => f.mode === "place",
      make: (f) =>
        `${n(r(f).available)} ${noun(r(f).available, "point", "points")} to choose from, ${n(r(f).picks)} ${noun(r(f).picks, "pick", "picks")}.`,
    },
    {
      step: 6,
      needs: [`${base}.byRule`, `${base}.byAtoms`],
      make: (f) => `${n(r(f).byRule)} by a rule, ${n(r(f).byAtoms)} with help from the atoms.`,
    },
    {
      step: 6,
      needs: [`${base}.byClassic`],
      when: (f) => r(f).byClassic > 0,
      make: (f) => `${n(r(f).byClassic)} classically, without atoms.`,
    },
  ];
}

// Steps 7 and 8 (task 4.2). Step 8 only lists the totals. It never ranks,
// compares or judges the four plans (honesty rules 1 and 7).
export const RESULT_AND_COMPARE: SentenceDef[] = [
  {
    step: 7,
    needs: ["result.total"],
    make: (f) => `In total, this plan picked ${n(f.result!.total)} ${noun(f.result!.total, "point", "points")}.`,
  },
  {
    step: 7,
    needs: ["result.quantumShare", "result.quantumPicks", "result.total", "result.atomsNotNeeded"],
    when: (f) => f.result!.atomsNotNeeded !== true,
    make: (f) =>
      `Quantum share: ${formatPercent(f.result!.quantumShare)}. ${n(f.result!.quantumPicks)} of ${n(f.result!.total)} picks came from the atoms.`,
  },
  {
    step: 7,
    needs: ["result.quantumShare", "result.atomsNotNeeded"],
    when: (f) => f.result!.atomsNotNeeded === true,
    make: (f) =>
      `Quantum share: ${formatPercent(f.result!.quantumShare)}. The atoms weren't needed on this map.`,
  },
  {
    step: 7,
    needs: ["result.fiveGhzOnly"],
    make: (f) => `${n(f.result!.fiveGhzOnly)} ${noun(f.result!.fiveGhzOnly, "point is", "points are")} 5 GHz only.`,
  },
  {
    step: 7,
    needs: ["result.atomsNotNeeded"],
    when: (f) => f.result!.atomsNotNeeded === true,
    make: () => "No group went to the atoms, so nothing was split or skipped.",
  },
  {
    step: 7,
    needs: ["result.splits", "result.skippedTiles", "result.atomsNotNeeded"],
    when: (f) => f.result!.atomsNotNeeded !== true,
    make: (f) =>
      `${n(f.result!.splits)} ${noun(f.result!.splits, "group was", "groups were")} split in two because the atoms couldn't be placed exactly like the map, and ${n(f.result!.skippedTiles)} ${noun(f.result!.skippedTiles, "was", "were")} skipped.`,
  },
  {
    step: 8,
    needs: ["compare"],
    make: () => "Picks of the four plans in this run:",
  },
  ...CARD_ORDER.map(
    (name): SentenceDef => ({
      step: 8,
      needs: ["compare"],
      when: (f) => f.compare!.some((c) => c.name === name),
      make: (f) => {
        const c = f.compare!.find((x) => x.name === name)!;
        return `${cap(CARD_LABELS[name])}: ${n(c.total)}${c.tie ? " (tie)" : ""}.`;
      },
    }),
  ),
  {
    step: 8,
    needs: ["compare"],
    make: () => "One run proves nothing.",
  },
];

// Why this point (task 6.2). Same mechanism as the Steps: each def lists the
// WhyFacts paths it needs and is not built when one is missing. Wording
// (channels or not) is chosen by `mode`, never by whether a round has a
// channel, so a lost channel drops the sentence instead of switching wording.
export interface WhyDef {
  needs: string[];
  /**
   * Paths whose absence this def depends on (the "no record" sentence). A def
   * with `absent` is built when those paths are missing, so removing one of
   * them may add the sentence. Checkable by tests.
   */
  absent?: string[];
  when?: (w: WhyFacts) => boolean;
  make(w: WhyFacts): string;
}

const PICKED: Record<"rule" | "atoms" | "classic", string> = {
  rule: "picked by a rule",
  atoms: "picked with help from the atoms",
  classic: "picked classically, without atoms",
};

function whyRoundDefs(i: number): WhyDef[] {
  const base = `rounds.${i}`;
  const r = (w: WhyFacts) => w.rounds[i];
  const picked = (o: string) => o === "rule" || o === "atoms" || o === "classic";
  const pickedText = (w: WhyFacts) => PICKED[r(w).outcome as "rule" | "atoms" | "classic"];
  return [
    {
      needs: [`${base}.channel`, `${base}.outcome`],
      when: (w) => w.mode === "channel_plan" && picked(r(w).outcome),
      make: (w) => `Channel ${n(r(w).channel)}: ${pickedText(w)}.`,
    },
    {
      needs: [`${base}.outcome`],
      when: (w) => w.mode === "place" && picked(r(w).outcome),
      make: (w) => cap(`${pickedText(w)}.`),
    },
    {
      needs: [`${base}.channel`, `${base}.outcome`, `${base}.by`],
      when: (w) => w.mode === "channel_plan" && r(w).outcome === "neighbour",
      make: (w) => `Channel ${n(r(w).channel)}: not possible, its neighbour ${r(w).by} was picked.`,
    },
    {
      needs: [`${base}.outcome`, `${base}.by`],
      when: (w) => w.mode === "place" && r(w).outcome === "neighbour",
      make: (w) => `Not picked, its neighbour ${r(w).by} was picked.`,
    },
    {
      needs: [`${base}.outcome`],
      when: (w) => w.mode === "channel_plan" && r(w).outcome === "fiveGhz",
      make: () => "No channel was left, so it uses 5 GHz only.",
    },
  ];
}

/** The sentence table for one Why_Answer, in order. */
export function whyDefs(why: WhyFacts): WhyDef[] {
  return [
    {
      needs: ["clashes"],
      make: (w) => `${w.id} clashes with ${n(w.clashes)} other ${noun(w.clashes, "point", "points")}.`,
    },
    ...why.rounds.flatMap((_, i) => whyRoundDefs(i)),
    {
      // Honesty rule 3: say so when the run holds nothing about this Point.
      needs: ["id"],
      absent: ["clashes"],
      when: (w) => w.clashes === undefined && w.rounds.length === 0,
      make: () => "This run holds no record of this point.",
    },
  ];
}

/** The Why_Answer for one Point: one Step with its ring. */
export function buildWhy(why: WhyFacts): Step {
  const sentences = whyDefs(why)
    .filter((d) => d.needs.every((p) => has(why, p)) && (d.when ? d.when(why) : true))
    .map((d) => d.make(why));
  return { key: "why", sentences, ring: why.ring };
}

export const NON_HYBRID_SENTENCE = "This explanation covers the atoms + rules (hybrid) plan only.";

/** Idle text shown before a run is finished: two sentences, no numbers. */
export function buildIdle(mode: Facts["mode"], kind?: "your_map"): string[] {
  const first =
    kind === "your_map"
      ? "Each dot is a point. A line joins two that are closer than r, so they can't both be picked."
      : mode === "channel_plan"
        ? "Each dot is a wifi access point. A line joins two that are too close to share a channel."
        : "Each dot is a cafe. A line joins two that are too close to both be picked.";
  return [
    first,
    "Press Run to see how the atoms and the rules build the plan, step by step.",
  ];
}
const STEP_KEYS: Record<number, string> = {
  1: "rules-first",
  2: "groups",
  3: "group",
  4: "pick",
  5: "after",
  7: "result",
  8: "compare",
};

function ringFor(step: number, f: Facts): string[] {
  switch (step) {
    case 1:
      return f.rulesFirst?.ring ?? [];
    case 2:
      return f.groups?.ring ?? [];
    case 3:
      return f.group?.ring ?? [];
    case 4:
      return f.atomPick?.ring ?? [];
    case 5:
      return f.opened?.ring ?? [];
    default:
      return [];
  }
}

/** Steps 1 to 8 for the Hybrid plan. Steps with no sentence are removed. */
export function buildSteps(facts: Facts, plan: EngineName): Step[] {
  if (plan !== "Hybrid") return [{ key: "plan-only", sentences: [NON_HYBRID_SENTENCE], ring: [] }];
  const out: Step[] = [];
  const pick = (defs: SentenceDef[], s: number) =>
    defs
      .filter((d) => d.step === s && d.needs.every((p) => has(facts, p)) && (d.when ? d.when(facts) : true))
      .map((d) => d.make(facts));
  for (let s = 1; s <= 8; s++) {
    if (s === 6) {
      facts.rounds.forEach((round, i) => {
        const sentences = pick(roundDefs(i), 6);
        if (sentences.length > 0) out.push({ key: `round-${i + 1}`, sentences, ring: round.ring });
      });
      continue;
    }
    if (s >= 7) {
      const sentences = pick(RESULT_AND_COMPARE, s);
      if (sentences.length > 0) out.push({ key: STEP_KEYS[s], sentences, ring: [] });
      continue;
    }
    // Requirement 4.12: no Steps 2 to 5 when the atoms weren't needed.
    if (s >= 2 && s <= 5 && facts.result?.atomsNotNeeded === true) continue;
    const sentences = SENTENCES.filter(
      (d) => d.step === s && d.needs.every((p) => has(facts, p)) && (d.when ? d.when(facts) : true),
    ).map((d) => d.make(facts));
    if (sentences.length === 0) continue;
    out.push({ key: STEP_KEYS[s], sentences, ring: ringFor(s, facts) });
  }
  return out;
}
