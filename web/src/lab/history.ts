// Lab_History (experience spec, Requirement 16.4; design "Lab", History): one row per Lab_Run of
// this visit, in the order they were made. Pure: a row copies the run's own numbers, nothing else.

import { CARD_ORDER } from "../scoreboard-model";
import type { LabRun } from "./lab-model";

export interface HistoryRow {
  runNumber: number;
  r: number;
  shots: number;
  topShare: number;
  /** Total picks in card order (atoms alone, hybrid, annealing, coin flip); null where a plan did not finish. */
  totals: (number | null)[];
  /** The Hybrid's quantum share 0..1, or null when it did not finish. */
  hybridShare: number | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function stat(c: unknown, key: string): number | null {
  if (!isObj(c) || "error" in c || !isObj(c.stats)) return null;
  const v = c.stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The history row of one finished Lab_Run. */
export function historyRow(runNumber: number, lab: LabRun, competitors: Record<string, unknown>): HistoryRow {
  return {
    runNumber,
    r: lab.r,
    shots: lab.shots,
    topShare: lab.top_share,
    totals: CARD_ORDER.map((p) => stat(competitors[p], "total_picks")),
    hybridShare: stat(competitors.Hybrid, "quantum_share"),
  };
}

/** "28/35/33/32", with "–" for a plan that did not finish. */
export function totalsText(row: HistoryRow): string {
  return row.totals.map((t) => (t === null ? "–" : String(t))).join("/");
}

export const HISTORY_CAPTION = "Lab runs of this visit, in the order they were made";
export const TOTALS_KEY = "Totals: atoms alone / atoms + rules (hybrid) / annealing + rules / coin flip + rules.";
export const HISTORY_EMPTY = "Each lab run adds a row here.";
