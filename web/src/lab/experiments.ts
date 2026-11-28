// Guided experiments (experience spec, Requirement 16.5; design "Lab", Experiments): five short
// cards. "Set it up" fills the instruments and never starts a run; the visitor presses Run again.
// Pure: a card turns the current values into new ones.

import { LAB_R_MAX, SHOTS_MIN, type Parse } from "./lab-model";

export interface ExperimentValues {
  seed: number;
  r: number;
  shots: number;
  top_share: number;
}

export interface ExperimentContext {
  /** The map's r cannot change (walking distances). */
  rReadOnly: boolean;
}

export interface Experiment {
  id: string;
  title: string;
  /** "Try: ..." */
  tryText: string;
  /** "Look for: ..." */
  lookText: string;
  /** The values after "Set it up", or a plain reason why the card cannot be used on this map. */
  set(v: ExperimentValues, ctx: ExperimentContext): Parse<ExperimentValues>;
}

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: "seed",
    title: "Another run number",
    tryText: "Change only the run number, then run again.",
    lookText: "The totals and the quantum share move a little from run to run. One run proves nothing.",
    set: (v) => ({ ok: true, value: { ...v, seed: v.seed + 1 } }),
  },
  {
    id: "shots",
    title: "10 shots",
    tryText: "Simulate each group only 10 times instead of 100.",
    lookText: "The atoms' advice gets noisier: rougher bars in the Atoms panel, and the hybrid may pick other points.",
    set: (v) => ({ ok: true, value: { ...v, shots: SHOTS_MIN } }),
  },
  {
    id: "top100",
    title: "Top group 100%",
    tryText: "Draw each atom pick from all the points left.",
    lookText: "The atoms' ranking no longer guides the pick: it is a random pick among all points left.",
    set: (v) => ({ ok: true, value: { ...v, top_share: 1 } }),
  },
  {
    id: "top10",
    title: "Top group 10%",
    tryText: "Draw each atom pick from only the most often lit tenth.",
    lookText: "The pick nearly always follows the strongest atom. Compare the hybrid's total with the 40% default.",
    set: (v) => ({ ok: true, value: { ...v, top_share: 0.1 } }),
  },
  {
    id: "bigger-r",
    title: "A bigger r",
    tryText: "Make r half as big again.",
    lookText: "More lines and more tangles: the rules can pick less on their own, so the atoms get more work.",
    set: (v, ctx) =>
      ctx.rReadOnly
        ? { ok: false, error: "On walking distances r is fixed. Choose straight line on the map to try this." }
        : { ok: true, value: { ...v, r: Math.min(LAB_R_MAX, Math.round(v.r * 1.5 * 10) / 10) } },
  },
];
