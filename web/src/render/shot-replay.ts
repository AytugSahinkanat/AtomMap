// Shot replay (experience spec, Requirement 7): the real repaired shots of one Group, played back.
// Pure functions only. Nothing here makes up a shot or a frequency: every number comes from the
// `kept` lists of the Engine's `shots` event.
//
// Flashes follow the steering rule (design.md, Map): an atom flashes only on a shot that really
// kept it, and at most 3 times a second. The glow and the histogram count every shot.

/** At most 3 flashes a second per atom. */
export const FLASH_GAP_MS = 1000 / 3;
/** How long one flash lasts. */
export const FLASH_MS = 140;
/** The laser sweep never takes longer than this (Requirement 7, design). */
export const MAX_SWEEP_MS = 600;

/** How many of the first `upTo` shots kept each of the `n` atoms. */
export function foldShots(n: number, kept: readonly (readonly number[])[], upTo: number): number[] {
  const counts = new Array<number>(n).fill(0);
  const end = Math.max(0, Math.min(Math.floor(upTo), kept.length));
  for (let s = 0; s < end; s++) for (const j of kept[s]) if (j >= 0 && j < n) counts[j]++;
  return counts;
}

/** The glow of each atom after `upTo` shots: the share of those shots that kept it (0 before the first). */
export function foldGlow(n: number, kept: readonly (readonly number[])[], upTo: number): number[] {
  const shown = Math.max(0, Math.min(Math.floor(upTo), kept.length));
  const counts = foldShots(n, kept, shown);
  return counts.map((c) => (shown === 0 ? 0 : c / shown));
}

/** Replay pace from the speed control (events per second): about 1 s for 100 shots at the default 25. */
export function shotsPerSecond(eventsPerSecond: number): number {
  return Math.max(1, 4 * eventsPerSecond);
}

/** The laser sweep at this speed, in ms (300 ms at the default 25, never more than 600). */
export function sweepMs(eventsPerSecond: number): number {
  return Math.min(MAX_SWEEP_MS, 7500 / Math.max(1, eventsPerSecond));
}

export interface Flashes {
  /** Time of each atom's last flash start, in replay ms (-Infinity before the first). */
  lastStart: number[];
  /** Time each atom's current flash ends, in replay ms. */
  until: number[];
}

export function newFlashes(n: number): Flashes {
  return { lastStart: new Array<number>(n).fill(-Infinity), until: new Array<number>(n).fill(-Infinity) };
}

/**
 * The shots from index `from` (inclusive) to `to` (exclusive) were replayed, the last one at
 * replay time `nowMs`. An atom kept in one of them starts a flash, unless it flashed less than
 * FLASH_GAP_MS ago. Mutates `f`. Returns the atoms that started a flash.
 */
export function stepFlashes(f: Flashes, kept: readonly (readonly number[])[], from: number, to: number, nowMs: number): number[] {
  const started: number[] = [];
  const end = Math.min(to, kept.length);
  for (let s = Math.max(0, from); s < end; s++) {
    for (const j of kept[s]) {
      if (j < 0 || j >= f.lastStart.length) continue;
      if (nowMs - f.lastStart[j] < FLASH_GAP_MS) continue;
      f.lastStart[j] = nowMs;
      f.until[j] = nowMs + FLASH_MS;
      started.push(j);
    }
  }
  return started;
}

/** Flash strength 0..1 of each atom at `nowMs` (fades out over FLASH_MS). */
export function flashStrength(f: Flashes, nowMs: number): number[] {
  return f.until.map((u) => (u <= nowMs ? 0 : Math.min(1, (u - nowMs) / FLASH_MS)));
}

/** What the map shows of the Group on the atoms in one frame. */
export interface AtomsView {
  /** Point indices of the Group (map order). */
  group: readonly number[];
  /** Glow per Group atom (same order as `group`): the share of the replayed shots that kept it. */
  glow: readonly number[];
  /** Kept counts per Group atom so far, and how many shots were replayed of how many. */
  counts: readonly number[];
  shown: number;
  total: number;
  /** Flash strength per Group atom, 0..1 (always 0 with reduced motion). */
  flash: readonly number[];
  /** Laser sweep progress 0..1, or null when no sweep is on. */
  sweep: number | null;
}
