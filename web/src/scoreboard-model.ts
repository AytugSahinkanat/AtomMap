// Scoreboard model (ui spec, Requirement 4, design "Scoreboard model").
//
// Pure functions: engine Competitor results in, four plain card objects out.
// No DOM, no drawing. The screen (task 9.3) only renders what this returns.
//
// The scoreboard fills in card by card: `buildCards` takes PARTIAL results.
// A Competitor that has not finished is a "pending" card (plain words, no
// numbers). Ties are declared only among ready cards, so a pending card never
// counts as a tie or a lead.
//
// Honesty: every number is copied from the Stats. Nothing is ranked, no card is
// marked as the winner, no speed wording (honesty rules 1, 2, 4, 6).

export type EngineName = "Atoms_Alone" | "Hybrid" | "Annealing_Rules" | "Coin_Flip_Rules";

/** Card order on the screen. All four have equal weight. */
export const CARD_ORDER: readonly EngineName[] = [
  "Atoms_Alone",
  "Hybrid",
  "Annealing_Rules",
  "Coin_Flip_Rules",
];

export const CARD_LABELS: Record<EngineName, string> = {
  Atoms_Alone: "atoms alone",
  Hybrid: "atoms + rules (hybrid)",
  Annealing_Rules: "annealing + rules",
  Coin_Flip_Rules: "coin flip + rules",
};

export const PENDING_TEXT = "Computing\u2026";
export const ATOMS_NOT_NEEDED_TEXT = "atoms weren't needed on this map";
export const NO_ATOMS_TEXT = "This method doesn't use atoms.";
export const TIE_TEXT = "tie";
export const ERROR_TEXT = "This method could not finish on this map.";
export const CITATION = "Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5";
export const ONE_RUN_NOTE = "One run proves nothing.";

export type ResultLabel = "simulation" | "real hardware";

export interface RoundPicks {
  /** Channel of the Round (1, 6, 11 in Channel_Plan, 1 in Place), or null. */
  channel: number | null;
  picks: number;
}

interface CardBase {
  key: EngineName;
  label: string;
}

export interface PendingCard extends CardBase {
  state: "pending";
  /** Plain words, no numbers. */
  text: string;
}

export interface ErrorCard extends CardBase {
  state: "error";
  /** Plain words, no digits anywhere. */
  text: string;
}

export interface ReadyCard extends CardBase {
  state: "ready";
  rounds: RoundPicks[];
  total: number;
  quantumPicks: number;
  /** Fraction 0..1 as the engine reports it. */
  quantumShare: number;
  /** e.g. "17.1%" or "0%". Always present. */
  quantumShareText: string;
  /** e.g. "6 of 35 picks came from the atoms". Always present. */
  quantumDetailText: string;
  /** Set when the Stats say atoms were not needed, else null. */
  atomsNotNeededText: string | null;
  /** "This method doesn't use atoms." on annealing and coin flip cards, else null. */
  noAtomsText: string | null;
  splits: number;
  skippedTiles: number;
  mismatches: number;
  /** Atoms alone only: ids left uncovered. null for the other cards. */
  gaps: string[] | null;
  gapsCount: number | null;
  resultLabel: ResultLabel;
  /** True when at least one other READY card has the same total. */
  tie: boolean;
  /** "tie" or null. */
  tieText: string | null;
}

export type Card = PendingCard | ErrorCard | ReadyCard;

/** Partial results by engine name: a missing key means "not finished yet". */
export type PartialResults = Partial<Record<EngineName, unknown>>;

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
}

/** "17.1%", "0%", "100%". One decimal at most. */
export function formatPercent(fraction: number): string {
  const p = Math.round(fraction * 1000) / 10;
  return (Number.isInteger(p) ? String(p) : p.toFixed(1)) + "%";
}

/** Plain words, no digits: digits and the engine's "Type:" prefix are removed. */
export function errorWords(raw: unknown): string {
  let detail = "";
  if (typeof raw === "string") {
    detail = raw.replace(/^[A-Za-z_]+:\s*/, "").replace(/[0-9]+/g, "").replace(/\s+/g, " ").trim();
  }
  return detail ? `${ERROR_TEXT} Reason: ${detail}` : ERROR_TEXT;
}

function readyCard(key: EngineName, c: Record<string, any>): ReadyCard {
  const stats: Record<string, any> = isRecord(c.stats) ? c.stats : {};
  const rounds: RoundPicks[] = Array.isArray(c.rounds)
    ? c.rounds.map((r: any) => ({
        channel: typeof r?.channel === "number" ? r.channel : null,
        picks: Array.isArray(r?.picks) ? r.picks.length : 0,
      }))
    : [];
  const total = count(stats.total_picks);
  const quantumPicks = count(stats.quantum_picks);
  const share = typeof stats.quantum_share === "number" ? stats.quantum_share : 0;
  const gaps = key === "Atoms_Alone" ? (Array.isArray(stats.gaps) ? stats.gaps.map(String) : []) : null;
  return {
    key,
    label: CARD_LABELS[key],
    state: "ready",
    rounds,
    total,
    quantumPicks,
    quantumShare: share,
    quantumShareText: formatPercent(share),
    quantumDetailText: `${quantumPicks} of ${total} picks came from the atoms`,
    // Only the hybrid can say "atoms weren't needed". Annealing and coin flip never use atoms.
    atomsNotNeededText: key === "Hybrid" && stats.atoms_not_needed === true ? ATOMS_NOT_NEEDED_TEXT : null,
    noAtomsText: key === "Annealing_Rules" || key === "Coin_Flip_Rules" ? NO_ATOMS_TEXT : null,
    splits: count(stats.splits),
    skippedTiles: count(stats.skipped_tiles),
    mismatches: count(stats.mismatches),
    gaps,
    gapsCount: gaps ? gaps.length : null,
    resultLabel: c.label === "real hardware" ? "real hardware" : "simulation",
    tie: false,
    tieText: null,
  };
}

/**
 * Build the four cards, in CARD_ORDER, from whatever has finished so far.
 * - missing key: pending card
 * - `{error}` entry: error card in plain words
 * - otherwise: ready card from the Stats
 * Ties: ready cards with the same total picks, when there are at least two.
 */
export function buildCards(partial: PartialResults | null | undefined): Card[] {
  const src: PartialResults = partial ?? {};
  const cards: Card[] = CARD_ORDER.map((key): Card => {
    const entry = src[key];
    if (entry === undefined || entry === null) {
      return { key, label: CARD_LABELS[key], state: "pending", text: PENDING_TEXT };
    }
    if (isRecord(entry) && "error" in entry) {
      return { key, label: CARD_LABELS[key], state: "error", text: errorWords(entry.error) };
    }
    if (!isRecord(entry)) {
      return { key, label: CARD_LABELS[key], state: "error", text: ERROR_TEXT };
    }
    return readyCard(key, entry);
  });

  const ready = cards.filter((c): c is ReadyCard => c.state === "ready");
  const sizes = new Map<number, number>();
  for (const c of ready) sizes.set(c.total, (sizes.get(c.total) ?? 0) + 1);
  for (const c of ready) {
    if ((sizes.get(c.total) ?? 0) >= 2) {
      c.tie = true;
      c.tieText = TIE_TEXT;
    }
  }
  return cards;
}

/** Cards from a final `result` object ({meta, competitors}). */
export function buildCardsFromResult(result: { competitors?: PartialResults } | null | undefined): Card[] {
  return buildCards(result?.competitors);
}

/** Every text a card shows, for wording checks. */
export function cardTexts(card: Card): string[] {
  if (card.state !== "ready") return [card.label, card.text];
  const out = [
    card.label,
    card.quantumShareText,
    card.quantumDetailText,
    card.resultLabel,
    ...card.rounds.map((r) => `${r.channel ?? ""} ${r.picks}`),
  ];
  if (card.atomsNotNeededText) out.push(card.atomsNotNeededText);
  if (card.noAtomsText) out.push(card.noAtomsText);
  if (card.tieText) out.push(card.tieText);
  return out;
}
