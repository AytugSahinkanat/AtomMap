// Tutor facts (tutor spec, task 3.1). Pure: numbers, ids and booleans only.
// No text sentences and no DOM here. Sentences live in sentences.ts, which
// reads Facts. This file never imports from sentences.ts.
//
// Every field is left out when its source is missing. Nothing is defaulted.

import type { PlaybackEvent } from "../render/playback";
import { buildCardsFromResult, type EngineName } from "../scoreboard-model";

/** Engine run event with the fields the Tutor reads (tutor Requirement 1). */
export interface TutorEvent extends PlaybackEvent {
  remaining?: number | null;
  top_group?: number | null;
  rank?: number | null;
  frequency?: number | null;
  shots?: number | null;
}

export interface FactsInput {
  mode: "channel_plan" | "place";
  seed: number;
  ids: string[];
  /** The request edges, for clique checks and clash counts. */
  edges: [string, string][];
  /** All buffered run events, every Competitor, in arrival order. */
  events: TutorEvent[];
  result: { competitors: Record<string, any>; meta?: { label?: string } & Record<string, any> };
}

export interface RoundFacts {
  channel?: number;
  available: number;
  picks: number;
  byRule: number;
  byAtoms: number;
  byClassic: number;
  ring: string[];
}

export interface Facts {
  /** Left out when the result has no label. Never defaulted. */
  label?: string;
  mode: "channel_plan" | "place";
  seed: number;
  rulesFirst?: {
    count: number;
    first?: string;
    firstNeighboursLeft?: number;
    ring: string[];
  };
  groups?: {
    /** Channel of the Round, Channel_Plan only. */
    channel?: number;
    pointsLeft: number;
    count: number;
    smallest: number;
    biggest: number;
    shots: number;
    ring: string[];
  };
  group?: {
    size: number;
    /** The two most often lit Points of the biggest group, ties by id. */
    top: [string, string?];
    /** Tries (hits) of those two Points: round(frequency * shots). */
    topHits: [number, number?];
    neverLit: number;
    allClash: boolean;
    ring: string[];
  };
  atomPick?: {
    id: string;
    pointsLeft: number;
    topGroup: number;
    rank: number;
    hits: number;
    shots: number;
    ring: string[];
  };
  opened?: { count: number; ring: string[] };
  rounds: RoundFacts[];
  result?: {
    total: number;
    quantumShare: number;
    quantumPicks: number;
    /** Left out in Place, which has no 5 GHz list. */
    fiveGhzOnly?: number;
    splits: number;
    skippedTiles: number;
    atomsNotNeeded: boolean;
  };
  compare?: { name: EngineName; total: number; tie: boolean }[];
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function sameTile(a?: string[] | null, b?: string[] | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function areAllClashing(group: string[], edges: [string, string][]): boolean {
  const set = new Set<string>();
  for (const [a, b] of edges) {
    set.add(`${a}\u0000${b}`);
    set.add(`${b}\u0000${a}`);
  }
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (!set.has(`${group[i]}\u0000${group[j]}`)) return false;
    }
  }
  return true;
}

function deriveHybrid(input: FactsInput, ev: TutorEvent[], out: Facts): void {
  const channelPlan = input.mode === "channel_plan";

  // rulesFirst: rule picks before the first simulate event, any channel.
  const firstSim = ev.findIndex((e) => e.kind === "simulate");
  const head = firstSim === -1 ? ev : ev.slice(0, firstSim);
  const rulePicks = head.filter((e) => e.kind === "pick" && e.source === "rule");
  const first = rulePicks[0];
  const ringFirst: string[] = [];
  if (first) {
    ringFirst.push(...(first.picked ?? []), ...(first.removed ?? []));
  }
  out.rulesFirst = {
    count: rulePicks.length,
    ...(first?.picked?.[0] !== undefined ? { first: first.picked[0] } : {}),
    ...(first && Array.isArray(first.removed)
      ? { firstNeighboursLeft: first.removed.length }
      : {}),
    ring: ringFirst,
  };

  // groups and group: the first simulate event's (round, step).
  if (firstSim !== -1) {
    const { round, step } = ev[firstSim];
    const sims = ev.filter(
      (e) => e.kind === "simulate" && e.round === round && e.step === step && Array.isArray(e.tile),
    );
    const freqEvents = ev.filter(
      (e) => e.kind === "frequencies" && e.round === round && e.step === step,
    );
    const stepPick = ev.find(
      (e) => e.kind === "pick" && e.round === round && e.step === step && isNum(e.remaining),
    );
    const shots = freqEvents.find((e) => isNum(e.shots))?.shots;
    if (sims.length > 0 && stepPick && isNum(shots)) {
      const sizes = sims.map((s) => s.tile!.length);
      const ring: string[] = [];
      for (const s of sims) for (const id of s.tile!) if (!ring.includes(id)) ring.push(id);
      out.groups = {
        ...(channelPlan ? { channel: round } : {}),
        pointsLeft: stepPick.remaining as number,
        count: sims.length,
        smallest: Math.min(...sizes),
        biggest: Math.max(...sizes),
        shots,
        ring,
      };

      // Biggest group, first in event order on a tie.
      let big = sims[0];
      for (const s of sims) if (s.tile!.length > big.tile!.length) big = s;
      const fe = freqEvents.find((e) => sameTile(e.tile, big.tile) && e.frequencies);
      if (fe?.frequencies && isNum(fe.shots)) {
        const entries = Object.entries(fe.frequencies).sort(
          (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
        );
        const hits = (f: number) => Math.round(f * (fe.shots as number));
        const top: [string, string?] = entries[1]
          ? [entries[0][0], entries[1][0]]
          : [entries[0][0]];
        const topHits: [number, number?] = entries[1]
          ? [hits(entries[0][1]), hits(entries[1][1])]
          : [hits(entries[0][1])];
        out.group = {
          size: big.tile!.length,
          top,
          topHits,
          neverLit: entries.filter(([, f]) => f === 0).length,
          allClash: areAllClashing(big.tile!, input.edges),
          ring: [...big.tile!],
        };
      }
    }
  }

  // atomPick: the first pick with a non-null frequency.
  const apIdx = ev.findIndex((e) => e.kind === "pick" && isNum(e.frequency));
  if (apIdx !== -1) {
    const p = ev[apIdx];
    const id = p.picked?.[0];
    // The latest frequencies event of this round that holds the id, at or
    // before the pick. The frequency can come from the cache, so the event
    // may be from an earlier step.
    let fe: TutorEvent | undefined;
    if (id !== undefined) {
      for (let i = apIdx - 1; i >= 0; i--) {
        const e = ev[i];
        if (
          e.kind === "frequencies" &&
          e.round === p.round &&
          e.frequencies !== undefined &&
          id in e.frequencies
        ) {
          fe = e;
          break;
        }
      }
    }
    if (
      id !== undefined &&
      isNum(p.remaining) &&
      isNum(p.top_group) &&
      isNum(p.rank) &&
      fe &&
      isNum(fe.shots)
    ) {
      out.atomPick = {
        id,
        pointsLeft: p.remaining,
        topGroup: p.top_group,
        rank: p.rank,
        hits: Math.round((p.frequency as number) * fe.shots),
        shots: fe.shots,
        ring: [id],
      };
      // opened: rule picks that directly follow it in the same Round.
      const ring: string[] = [];
      let count = 0;
      for (let i = apIdx + 1; i < ev.length; i++) {
        const e = ev[i];
        if (e.kind !== "pick" || e.source !== "rule" || e.round !== p.round) break;
        count++;
        ring.push(...(e.picked ?? []));
      }
      out.opened = { count, ring };
    }
  }
}

function deriveRounds(input: FactsInput, ev: TutorEvent[], out: Facts): void {
  const channelPlan = input.mode === "channel_plan";
  const order: number[] = [];
  for (const e of ev) {
    if (e.kind === "pick" && isNum(e.round) && !order.includes(e.round)) order.push(e.round);
  }
  for (const round of order) {
    const picks = ev.filter((e) => e.kind === "pick" && e.round === round);
    const seen = new Set<string>();
    const ring: string[] = [];
    let byRule = 0;
    let byAtoms = 0;
    let byClassic = 0;
    for (const p of picks) {
      for (const id of p.picked ?? []) seen.add(id);
      for (const id of p.removed ?? []) seen.add(id);
      for (const id of p.picked ?? []) ring.push(id);
      const n = (p.picked ?? []).length;
      if (p.source === "rule") byRule += n;
      else if (isNum(p.frequency)) byAtoms += n;
      else byClassic += n;
    }
    out.rounds.push({
      ...(channelPlan ? { channel: round } : {}),
      available: seen.size,
      picks: ring.length,
      byRule,
      byAtoms,
      byClassic,
      ring,
    });
  }
}

function deriveResult(input: FactsInput, out: Facts): void {
  const cards = buildCardsFromResult(input.result);
  const hybrid = cards.find((c) => c.key === "Hybrid");
  const hr = input.result?.competitors?.Hybrid;
  if (hybrid && hybrid.state === "ready") {
    out.result = {
      total: hybrid.total,
      quantumShare: hybrid.quantumShare,
      quantumPicks: hybrid.quantumPicks,
      ...(Array.isArray(hr?.five_ghz_only) ? { fiveGhzOnly: hr.five_ghz_only.length } : {}),
      splits: hybrid.splits,
      skippedTiles: hybrid.skippedTiles,
      atomsNotNeeded: hr?.stats?.atoms_not_needed === true,
    };
  }
  const ready = cards.filter((c) => c.state === "ready");
  if (ready.length > 0) {
    out.compare = ready.map((c) => ({
      name: c.key,
      total: (c as { total: number }).total,
      tie: c.tie,
    }));
  }
}

export function deriveFacts(input: FactsInput): Facts {
  const hybridResult = input.result?.competitors?.Hybrid;
  const metaLabel = input.result?.meta?.label;
  const hybridLabel = hybridResult && typeof hybridResult === "object" ? hybridResult.label : undefined;
  const label =
    typeof metaLabel === "string" ? metaLabel : typeof hybridLabel === "string" ? hybridLabel : undefined;

  const out: Facts = {
    ...(label !== undefined ? { label } : {}),
    mode: input.mode,
    seed: input.seed,
    rounds: [],
  };

  const hybridFailed =
    hybridResult !== undefined && hybridResult !== null && typeof hybridResult === "object" && "error" in hybridResult;
  const ev = input.events.filter((e) => e.competitor === "Hybrid");
  if (hybridFailed || ev.length === 0) return out;

  deriveHybrid(input, ev, out);
  deriveRounds(input, ev, out);
  deriveResult(input, out);
  return out;
}
