// The lab's pure parts (experience spec, Requirements 16 to 18; design "Lab"): the control ranges
// and their plain messages, the Lab_Label and the lab's first Tutor line, and the readout rows of
// the shown run. No DOM. Every number of a readout comes from the run's result.

import { CARD_LABELS, CARD_ORDER, type EngineName } from "../scoreboard-model";
import { parseSeed } from "../seed";

/** What a Lab_Run changes. `r` is the r of the run's map (the same as the map's own r when unchanged). */
export interface LabRun {
  shots: number;
  top_share: number;
  r: number;
}

export const SHOTS_MIN = 10;
export const SHOTS_MAX = 200;
export const SHOTS_DEFAULT = 100;
export const TOP_MIN_PERCENT = 10;
export const TOP_MAX_PERCENT = 100;
export const TOP_DEFAULT_PERCENT = 40;
export const LAB_R_MIN = 2;
export const LAB_R_MAX = 400;

export type Parse<T> = { ok: true; value: T } | { ok: false; error: string };

const NUMBER = /^[+]?(\d+(\.\d*)?|\.\d+)$/;

/** The seed of a lab run (the Run_Number): any whole number. */
export function parseLabSeed(text: string): Parse<number> {
  return parseSeed(text);
}

/** r in metres, 2 to 400. */
export function parseLabR(text: string): Parse<number> {
  const t = text.trim().replace(",", ".");
  const v = Number(t);
  if (t === "" || !NUMBER.test(t) || !Number.isFinite(v)) return { ok: false, error: `Type a number of metres from ${LAB_R_MIN} to ${LAB_R_MAX}.` };
  if (v < LAB_R_MIN || v > LAB_R_MAX) return { ok: false, error: `r must be from ${LAB_R_MIN} to ${LAB_R_MAX} metres. ${fmt(v)} is outside.` };
  return { ok: true, value: Math.round(v * 10) / 10 };
}

/** Shots per group: a whole number, 10 to 200. */
export function parseShots(text: string): Parse<number> {
  const t = text.trim();
  if (!/^\+?\d+$/.test(t)) return { ok: false, error: `Type a whole number of shots from ${SHOTS_MIN} to ${SHOTS_MAX}.` };
  const v = Number(t);
  if (v < SHOTS_MIN || v > SHOTS_MAX) return { ok: false, error: `Shots must be from ${SHOTS_MIN} to ${SHOTS_MAX}. ${v} is outside.` };
  return { ok: true, value: v };
}

/** The top group as a percent, 10 to 100; the value is the share 0.1 to 1. */
export function parseTopPercent(text: string): Parse<number> {
  const t = text.trim().replace(/%$/, "").trim().replace(",", ".");
  const v = Number(t);
  if (t === "" || !NUMBER.test(t) || !Number.isFinite(v)) return { ok: false, error: `Type a percent from ${TOP_MIN_PERCENT} to ${TOP_MAX_PERCENT}.` };
  if (v < TOP_MIN_PERCENT || v > TOP_MAX_PERCENT) return { ok: false, error: `The top group must be from ${TOP_MIN_PERCENT}% to ${TOP_MAX_PERCENT}%. ${fmt(v)}% is outside.` };
  return { ok: true, value: Math.round(v * 10) / 1000 };
}

function fmt(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** A share as a percent text: 0.4 -> "40", 0.333 -> "33.3". */
export function percentText(share: number): string {
  return String(Math.round(share * 1000) / 10);
}

/** The Lab_Label (Requirement 18): on every Lab_Run result, even when the values equal the defaults. */
export function labLabel(s: Pick<LabRun, "shots" | "top_share">): string {
  return `Lab settings: shots ${s.shots}, top group ${percentText(s.top_share)}%. Not the measured defaults.`;
}

/** The Tutor's first line of a Lab_Run (design "Lab", Labels). */
export function labFirstLine(s: Pick<LabRun, "shots" | "top_share">): string {
  return `The run is finished. These results are a simulation with lab settings (shots ${s.shots}, top group ${percentText(s.top_share)}%), not the measured defaults.`;
}

/** The top bar's run text. */
export function labBarText(mapName: string, runNumber: number | null): string {
  return `ATOMMAP LAB · ${mapName} · RUN ${runNumber === null ? "–" : runNumber}`;
}

export const LAB_BAR_NOTE = "Lab settings, not the measured defaults.";
/** The README section the "For developers" box points to (task 16 writes it). */
export const README_ENGINE_URL = "https://github.com/AytugSahinkanat/AtomMap#use-the-engine-with-your-own-data";
export const DEV_INTRO = "The engine is a Python package (Python 3.12). In a copy of the repository, install it, save the copied request as request.json and run it:";
export const DEV_COMMAND = "pip install ./engine\npython -m atommap request.json";
export const DEV_PYTHON = "from atommap import api\nprint(api.run(open(\"request.json\").read()))";
export const DEV_NOTE = "It prints the result as JSON (add --out result.json to save it). Native and browser results can differ a little, because of floating-point details in the simulation and the atom layout.";
export const SEED_NOTE = "Same number, same result.";
export const R_NOTE = "How close is too close. A bigger r draws more lines.";
export const SHOTS_NOTE = "How many times each group is simulated. Fewer shots, noisier advice.";
export const TOP_NOTE = "The share of the most often lit points that each atom pick is drawn from.";
export function walkingRNote(r: number): string {
  return `Walking distances were measured on the streets for r = ${r} m. Switch to straight line to change it.`;
}

/** One readout row of the shown run, straight from its result. */
export interface ReadoutRow {
  plan: EngineName;
  label: string;
  /** Null when the plan did not finish (then `problem` says why). */
  total: number | null;
  quantumShare: number | null;
  splits: number | null;
  skipped: number | null;
  problem: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The four readout rows, in card order. */
export function readoutRows(competitors: Record<string, unknown>): ReadoutRow[] {
  return CARD_ORDER.map((plan) => {
    const c = competitors[plan];
    const label = CARD_LABELS[plan];
    if (!isObj(c) || "error" in c || !isObj(c.stats)) {
      return { plan, label, total: null, quantumShare: null, splits: null, skipped: null, problem: "did not finish" };
    }
    const s = c.stats;
    return { plan, label, total: num(s.total_picks), quantumShare: num(s.quantum_share), splits: num(s.splits), skipped: num(s.skipped_tiles), problem: null };
  });
}
