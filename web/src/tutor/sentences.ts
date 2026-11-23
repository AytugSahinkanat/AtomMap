// Tutor sentences (tutor spec, task 4.1: Steps 1 to 5).
// Pure text. No DOM and no arithmetic: every number written here is a Facts
// field, passed through String(). A sentence lists the Facts paths it needs
// in `needs` and is not built when one is missing (Requirement 4.14).
// Task 4.2 adds Steps 6 to 8, the idle text and the non-Hybrid sentence.

import { CARD_LABELS, CARD_ORDER, formatPercent, type EngineName } from "../scoreboard-model";
import type { Facts } from "./facts";

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
    needs: ["rulesFirst.count"],
    when: (f) => f.rulesFirst!.count === 0,
    make: () => "The rules found no safe pick, so the atoms went first.",
  },
  {
    step: 1,
    needs: ["rulesFirst.count"],
    when: (f) => f.rulesFirst!.count > 0,
    make: (f) =>
      `Before any atoms ran, the rules made ${n(f.rulesFirst!.count)} safe ${noun(f.rulesFirst!.count, "pick", "picks")}.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "rulesFirst.first", "rulesFirst.firstNeighboursLeft"],
    when: (f) => f.rulesFirst!.count > 0 && f.rulesFirst!.firstNeighboursLeft === 0,
    make: (f) =>
      `The first was ${f.rulesFirst!.first}. Among the Points left at that moment it has no neighbours, so taking it loses no other pick.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "rulesFirst.first", "rulesFirst.firstNeighboursLeft"],
    when: (f) => f.rulesFirst!.count > 0 && f.rulesFirst!.firstNeighboursLeft === 1,
    make: (f) =>
      `The first was ${f.rulesFirst!.first}. Among the Points left at that moment it has one neighbour, and the two clash with each other, so taking it loses no other pick.`,
  },
  {
    step: 1,
    needs: ["rulesFirst.count", "rulesFirst.first", "rulesFirst.firstNeighboursLeft"],
    when: (f) => f.rulesFirst!.count > 0 && f.rulesFirst!.firstNeighboursLeft! >= 2,
    make: (f) =>
      `The first was ${f.rulesFirst!.first}. Among the Points left at that moment it has ${n(f.rulesFirst!.firstNeighboursLeft)} neighbours, and they all clash with each other and with it, so taking it loses no other pick.`,
  },

  // Step 2: groups
  {
    step: 2,
    needs: ["groups.channel", "groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest"],
    when: (f) => f.mode === "channel_plan" && f.groups!.smallest !== f.groups!.biggest,
    make: (f) =>
      `Then the atoms got the Points still left. On channel ${n(f.groups!.channel)}, ${n(f.groups!.pointsLeft)} Points were left. They were split into ${n(f.groups!.count)} ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.smallest)} to ${n(f.groups!.biggest)} Points.`,
  },
  {
    step: 2,
    needs: ["groups.channel", "groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest"],
    when: (f) => f.mode === "channel_plan" && f.groups!.smallest === f.groups!.biggest,
    make: (f) =>
      `Then the atoms got the Points still left. On channel ${n(f.groups!.channel)}, ${n(f.groups!.pointsLeft)} Points were left. They were split into ${n(f.groups!.count)} ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.biggest)} Points.`,
  },
  {
    step: 2,
    needs: ["groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest"],
    when: (f) => f.mode === "place" && f.groups!.smallest !== f.groups!.biggest,
    make: (f) =>
      `Then the atoms got the Points still left. ${n(f.groups!.pointsLeft)} Points were left. They were split into ${n(f.groups!.count)} ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.smallest)} to ${n(f.groups!.biggest)} Points.`,
  },
  {
    step: 2,
    needs: ["groups.pointsLeft", "groups.count", "groups.smallest", "groups.biggest"],
    when: (f) => f.mode === "place" && f.groups!.smallest === f.groups!.biggest,
    make: (f) =>
      `Then the atoms got the Points still left. ${n(f.groups!.pointsLeft)} Points were left. They were split into ${n(f.groups!.count)} ${noun(f.groups!.count, "group", "groups")} of ${n(f.groups!.biggest)} Points.`,
  },
  {
    step: 2,
    needs: ["groups.shots", "label"],
    make: (f) => `Each group was tried ${n(f.groups!.shots)} times. Result label: ${f.label}.`,
  },

  // Step 3: one group
  {
    step: 3,
    needs: ["group.size"],
    make: (f) => `Take the biggest group, with ${n(f.group!.size)} Points.`,
  },
  {
    step: 3,
    needs: ["group.allClash"],
    when: (f) => f.group!.allClash === true,
    make: () => "All its Points clash with each other, so the atoms had no clear favourite.",
  },
  {
    step: 3,
    needs: ["group.size", "group.allClash", "group.top.0", "group.top.1", "group.topHits.0", "group.topHits.1", "groups.shots"],
    when: (f) => f.group!.allClash === false && f.group!.size >= 2,
    make: (f) =>
      `Its two most often lit Points are ${f.group!.top[0]} (${n(f.group!.topHits[0])} of ${n(f.groups!.shots)} tries) and ${f.group!.top[1]} (${n(f.group!.topHits[1])} of ${n(f.groups!.shots)} tries).`,
  },
  {
    step: 3,
    // A one-Point group has one lit Point. Keyed on size, not on a missing
    // top[1], so a lost second entry drops the sentence above (Req. 4.14).
    needs: ["group.size", "group.allClash", "group.top.0", "group.topHits.0", "groups.shots"],
    when: (f) => f.group!.allClash === false && f.group!.size === 1,
    make: (f) =>
      `Its most often lit Point is ${f.group!.top[0]} (${n(f.group!.topHits[0])} of ${n(f.groups!.shots)} tries).`,
  },
  {
    step: 3,
    needs: ["group.neverLit"],
    make: (f) =>
      `${n(f.group!.neverLit)} of its ${noun(f.group!.neverLit, "Point", "Points")} never lit up.`,
  },

  // Step 4: one pick
  {
    step: 4,
    needs: ["atomPick.id"],
    make: () =>
      "The app does not take the top Point. It ranks the Points left, keeps the top group, and picks one of its Points at random.",
  },
  {
    step: 4,
    needs: ["atomPick.id", "atomPick.pointsLeft", "atomPick.topGroup"],
    make: (f) =>
      `At that moment ${n(f.atomPick!.pointsLeft)} Points were left and the top group had ${n(f.atomPick!.topGroup)} Points.`,
  },
  {
    step: 4,
    needs: ["atomPick.id", "atomPick.rank", "atomPick.hits", "atomPick.shots"],
    make: (f) =>
      `It picked ${f.atomPick!.id}, at rank ${n(f.atomPick!.rank)}. That Point lit up in ${n(f.atomPick!.hits)} of ${n(f.atomPick!.shots)} tries.`,
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
      `After it, the rules found ${n(f.opened!.count)} safe ${noun(f.opened!.count, "pick", "picks")} that this pick opened.`,
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
        `Channel ${n(r(f).channel)}: ${n(r(f).available)} Points to choose from, ${n(r(f).picks)} ${noun(r(f).picks, "pick", "picks")}.`,
    },
    {
      step: 6,
      needs: [`${base}.available`, `${base}.picks`],
      // Keyed on the Mode only, so a missing channel in Channel_Plan drops
      // the sentence above instead of switching wording (Req. 4.13, 4.14).
      when: (f) => f.mode === "place",
      make: (f) =>
        `${n(r(f).available)} Points to choose from, ${n(r(f).picks)} ${noun(r(f).picks, "pick", "picks")}.`,
    },
    {
      step: 6,
      needs: [`${base}.byRule`, `${base}.byAtoms`, `${base}.byClassic`],
      make: (f) =>
        `${n(r(f).byRule)} by a rule, ${n(r(f).byAtoms)} with help from the atoms, ${n(r(f).byClassic)} classically, without atoms.`,
    },
  ];
}

// Steps 7 and 8 (task 4.2). Step 8 only lists the totals. It never ranks,
// compares or judges the four plans (honesty rules 1 and 7).
export const RESULT_AND_COMPARE: SentenceDef[] = [
  {
    step: 7,
    needs: ["label"],
    make: (f) => `Result label: ${f.label}.`,
  },
  {
    step: 7,
    needs: ["result.total"],
    make: (f) => `In total, this plan picked ${n(f.result!.total)} ${noun(f.result!.total, "Point", "Points")}.`,
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
    make: (f) => `${n(f.result!.fiveGhzOnly)} ${noun(f.result!.fiveGhzOnly, "Point is", "Points are")} 5 GHz only.`,
  },
  {
    step: 7,
    needs: ["result.splits"],
    make: (f) => `The layout has ${n(f.result!.splits)} ${noun(f.result!.splits, "split", "splits")}.`,
  },
  {
    step: 7,
    needs: ["result.skippedTiles"],
    make: (f) =>
      `${n(f.result!.skippedTiles)} ${noun(f.result!.skippedTiles, "group was", "groups were")} skipped.`,
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

export const NON_HYBRID_SENTENCE = "This explanation covers the atoms + rules (hybrid) plan only.";

/** Idle text shown before a run is finished: one or two sentences, no numbers. */
export function buildIdle(): string[] {
  return [
    "Run a map to see how the atoms and the rules built the result, step by step.",
    "Every number here will come from your run.",
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
