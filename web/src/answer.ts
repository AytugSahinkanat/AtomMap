// Answer_Box (experience spec, Requirement 24): the map's own question, answered in plain words from
// the numbers of one run. Pure, no DOM. Nothing is computed beyond counting and checking the sets
// the plans (or the visitor's Hand_Pick) returned: no new search, no new set.

import { CARD_LABELS, CARD_ORDER, type EngineName } from "./scoreboard-model";

/** How the map names its points and its distance rule. */
export interface MapWords {
  /** "cafés", "bus stops", "stations", "points", "access points". */
  noun: string;
  /** After "no two": "within a 150 m walk", "closer than 20 m". */
  pair: string;
  /** Before a point: "within a 150 m walk of", "closer than 20 m to". */
  near: string;
}

export interface AnswerInput {
  mode: "channel_plan" | "place";
  words: MapWords;
  /** Point ids of the map, in map order. */
  ids: readonly string[];
  /** Names to show instead of ids (place maps). Missing names fall back to the id. */
  names?: ReadonlyMap<string, string>;
  /** The edges of the run request. */
  edges: readonly (readonly [string, string])[];
  /** `result.competitors` of the run. */
  competitors: Record<string, unknown>;
  /** The Valid_Picks of the Hand_Pick of this map and setting when the run started, or null. */
  hand: readonly string[] | null;
  /** The Lab_Label of a Lab_Run, or null. */
  labLabel?: string | null;
}

export interface AnswerRound {
  /** 1, 6 or 11 on the channel plan, null in one-round modes. */
  channel: number | null;
  ids: string[];
}

export interface Answer {
  /** Where the Answer_Set comes from. Null when no plan passed and there is no Hand_Pick. */
  source: { kind: "plan"; plan: EngineName } | { kind: "hand" } | null;
  /** N, M. */
  count: number;
  total: number;
  headline: string;
  /** "Found by ..." and the others' counts, or the Hand_Pick sentence. */
  found: string;
  /** Problems found in the check (a plan that did not finish, a set with a clash), one sentence each. */
  problems: string[];
  /** The maximality line, only when it is true for the Answer_Set. */
  maximal: string | null;
  honesty: string;
  labLabel: string | null;
  /** The Answer_Set by Round. */
  rounds: AnswerRound[];
}

export const HONESTY_LINE = "This is the most found in this run. It is not proven to be the most possible.";
export const SHOW_ON_MAP_LABEL = "Show them on the map";
export const SHOW_LIST_LABEL = "Show the list";
export const CLICK_HINT = "Click a point to see which.";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "a", "a and b", "a, b and c". */
export function joinWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** One plan's sets, read and checked. */
export interface PlanCheck {
  plan: EngineName;
  /** The sets by Round, when the plan finished. */
  rounds: AnswerRound[];
  count: number;
  /** Why it is not counted, or null when it passes. */
  problem: string | null;
}

/** Read a plan's rounds and check them against the request edges (Requirement 24.3). */
export function checkPlan(plan: EngineName, comp: unknown, mode: AnswerInput["mode"], ids: ReadonlySet<string>, adj: ReadonlyMap<string, ReadonlySet<string>>): PlanCheck {
  const label = cap(CARD_LABELS[plan]);
  if (!isObj(comp) || "error" in comp || !Array.isArray(comp.rounds)) {
    return { plan, rounds: [], count: 0, problem: `${label} did not finish, so it is not counted.` };
  }
  const rounds: AnswerRound[] = [];
  const seen = new Set<string>();
  for (const r of comp.rounds as unknown[]) {
    const picks = isObj(r) && Array.isArray(r.picks) ? (r.picks as unknown[]).map(String) : [];
    const channel = mode === "channel_plan" && isObj(r) && typeof r.channel === "number" ? r.channel : null;
    for (const id of picks) {
      if (!ids.has(id)) return { plan, rounds, count: 0, problem: `${label} returned a point that is not on this map, so it is not counted.` };
      if (seen.has(id)) return { plan, rounds, count: 0, problem: `${label} picked ${id} twice, so it is not counted.` };
      seen.add(id);
    }
    const inRound = new Set(picks);
    for (const id of picks) {
      for (const n of adj.get(id) ?? []) {
        if (inRound.has(n)) return { plan, rounds, count: 0, problem: `${label} returned a set with a clash (${id} and ${n}), so it is not counted.` };
      }
    }
    rounds.push({ channel, ids: picks });
  }
  const stats = isObj(comp.stats) ? comp.stats : {};
  const total = typeof stats.total_picks === "number" ? stats.total_picks : null;
  if (total !== null && total !== seen.size) {
    return { plan, rounds, count: 0, problem: `${label} reports ${total} picks but returned ${seen.size}, so it is not counted.` };
  }
  return { plan, rounds, count: seen.size, problem: null };
}

function adjacency(ids: readonly string[], edges: AnswerInput["edges"]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  for (const [a, b] of edges) {
    if (a === b) continue;
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  return adj;
}

/** True when every Point outside the sets has a neighbour in each set (Requirement 24.6). */
export function isMaximal(ids: readonly string[], adj: ReadonlyMap<string, ReadonlySet<string>>, rounds: readonly AnswerRound[]): boolean {
  if (rounds.length === 0) return false;
  const inSet = new Set(rounds.flatMap((r) => r.ids));
  const sets = rounds.map((r) => new Set(r.ids));
  for (const id of ids) {
    if (inSet.has(id)) continue;
    const nb = adj.get(id) ?? new Set<string>();
    for (const s of sets) if (![...nb].some((n) => s.has(n))) return false;
  }
  return true;
}

export function buildAnswer(input: AnswerInput): Answer {
  const { mode, words, ids } = input;
  const idSet = new Set(ids);
  const adj = adjacency(ids, input.edges);
  const checks = CARD_ORDER.map((plan) => checkPlan(plan, input.competitors[plan], mode, idSet, adj));
  const problems = checks.filter((c) => c.problem !== null).map((c) => c.problem as string);
  const passing = checks.filter((c) => c.problem === null);
  const best = passing.reduce((m, c) => Math.max(m, c.count), -1);
  const total = ids.length;
  const labLabel = input.labLabel ?? null;

  // The Hand_Pick: only strictly more, only in one-round modes, only clash-free ids of this map.
  const hand = mode === "place" && input.hand ? input.hand.filter((id) => idSet.has(id)) : null;
  const handClean = hand !== null && hand.every((a) => hand.every((b) => a === b || !adj.get(a)?.has(b)));
  const handWins = hand !== null && handClean && hand.length > Math.max(0, best);

  if (passing.length === 0 && !handWins) {
    return {
      source: null,
      count: 0,
      total,
      headline: "No plan finished in this run, so there is no answer to show.",
      found: "",
      problems,
      maximal: null,
      honesty: HONESTY_LINE,
      labLabel,
      rounds: [],
    };
  }

  const finders = passing.filter((c) => c.count === best);
  const shown = handWins ? null : (finders.find((c) => c.plan === "Hybrid") ?? finders[0]);
  const rounds: AnswerRound[] = handWins ? [{ channel: null, ids: [...hand!] }] : shown!.rounds.map((r) => ({ channel: r.channel, ids: [...r.ids] }));
  const count = handWins ? hand!.length : best;

  let headline: string;
  if (mode === "channel_plan") {
    const per = rounds.map((r, i) => (i === 0 ? `${r.ids.length} on channel ${r.channel ?? i + 1}` : `${r.ids.length} on ${r.channel ?? i + 1}`));
    const other = total - count;
    headline =
      `Answer: ${count} of ${total} access points get a 2.4 GHz channel: ${joinWords(per)}. ` +
      (other === 0 ? "None use 5 GHz only." : `The other ${other} use 5 GHz only.`);
  } else {
    headline = `Answer: you can pick ${count} of these ${total} ${words.noun}, with no two ${words.pair}.`;
  }

  const counts = (cs: readonly PlanCheck[]): string[] => cs.map((c, i) => (i === 0 ? `${cap(CARD_LABELS[c.plan])} found ${c.count}` : `${CARD_LABELS[c.plan]} ${c.count}`));
  let found: string;
  if (handWins) {
    const others = counts(passing);
    found = `Your own pick has ${count} points with no clash, more than the plans found in this run.` + (others.length ? ` ${others.join(", ")}.` : "");
  } else {
    const names = finders.map((c) => CARD_LABELS[c.plan]);
    const others = passing.filter((c) => c.count !== best);
    found =
      (finders.length === 4 ? "Found by all four plans." : `Found by ${joinWords(names)}.`) +
      (others.length ? ` ${counts(others).join(", ")}.` : "");
  }

  let maximal: string | null = null;
  if (count < total && isMaximal(ids, adj, rounds)) {
    maximal =
      mode === "channel_plan"
        ? `Each of the other ${total - count} clashes with an access point on every channel. ${CLICK_HINT}`
        : `Every other one is ${words.near} one of them. ${CLICK_HINT}`;
  }

  return {
    source: handWins ? { kind: "hand" } : { kind: "plan", plan: shown!.plan },
    count,
    total,
    headline,
    found,
    problems,
    maximal,
    honesty: HONESTY_LINE,
    labLabel,
    rounds,
  };
}

const MAX_LISTED = 6;

/** The line for a clicked Point and the ids to ring (its neighbours in the Answer_Set). */
export function whichLine(
  answer: Answer,
  input: Pick<AnswerInput, "mode" | "words" | "ids" | "names" | "edges">,
  id: string,
): { text: string; ring: string[] } | null {
  if (answer.source === null || !input.ids.includes(id)) return null;
  const name = (x: string) => input.names?.get(x) ?? x;
  const adj = adjacency(input.ids, input.edges);
  const nb = adj.get(id) ?? new Set<string>();
  const list = (xs: string[]) => {
    const shown = xs.slice(0, MAX_LISTED).map(name);
    return xs.length > MAX_LISTED ? `${shown.join(", ")} and ${xs.length - MAX_LISTED} more` : joinWords(shown);
  };
  const own = answer.rounds.find((r) => r.ids.includes(id));
  if (own) {
    return {
      text: input.mode === "channel_plan" ? `${name(id)} is on channel ${own.channel}.` : `${name(id)} is one of the ${answer.count}.`,
      ring: [],
    };
  }
  if (input.mode === "channel_plan") {
    const parts: string[] = [];
    const ring: string[] = [];
    for (const r of answer.rounds) {
      const here = r.ids.filter((x) => nb.has(x));
      if (here.length) parts.push(`${list(here)} on channel ${r.channel}`);
      ring.push(...here);
    }
    return { text: parts.length ? `${name(id)} clashes with ${joinWords(parts)}.` : `${name(id)} clashes with no access point that has a channel.`, ring };
  }
  const here = answer.rounds.flatMap((r) => r.ids).filter((x) => nb.has(x));
  return here.length
    ? { text: `${name(id)} is ${input.words.near} ${list(here)}.`, ring: here }
    : { text: `No point of the answer is ${input.words.near} ${name(id)}.`, ring: [] };
}

/** "Show the list": one line per Round on the channel plan, else one line. */
export function answerList(answer: Answer, names?: ReadonlyMap<string, string>): string[] {
  const name = (x: string) => names?.get(x) ?? x;
  return answer.rounds.map((r) => (r.channel !== null ? `Channel ${r.channel}: ` : "") + r.ids.map(name).join(", "));
}
