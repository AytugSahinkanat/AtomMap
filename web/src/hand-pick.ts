// Hand_Pick (experience spec, Requirement 9): the visitor's own pick on a map. Pure, no DOM.
// The numbers use the same edges as the run request (Requirement 9.7), so they mean the same.

export interface HandPickStats {
  /** Picked Points in no Clash. */
  valid: number;
  /** Edges with both ends picked, each pair sorted, the list sorted. */
  clashes: [string, string][];
  /** Points not picked with no edge to any picked Point (each one fits alone now). */
  free: number;
  freeIds: string[];
}

export function handPickStats(
  ids: readonly string[],
  edges: readonly (readonly [string, string])[],
  picked: ReadonlySet<string>,
): HandPickStats {
  const known = new Set(ids);
  const blocked = new Set<string>(); // not picked, with a picked neighbour
  const inClash = new Set<string>();
  const seen = new Set<string>();
  const clashes: [string, string][] = [];
  for (const [a, b] of edges) {
    if (a === b || !known.has(a) || !known.has(b)) continue;
    const pa = picked.has(a);
    const pb = picked.has(b);
    if (pa && pb) {
      const pair: [string, string] = a < b ? [a, b] : [b, a];
      const key = `${pair[0]}\u0000${pair[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clashes.push(pair);
      inClash.add(a);
      inClash.add(b);
    } else if (pa) blocked.add(b);
    else if (pb) blocked.add(a);
  }
  clashes.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  let valid = 0;
  for (const id of ids) if (picked.has(id) && !inClash.has(id)) valid++;
  const freeIds = ids.filter((id) => !picked.has(id) && !blocked.has(id));
  return { valid, clashes, free: freeIds.length, freeIds };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The readout under the map's controls: the count, the clashes, and the hint (Requirement 9.3). */
export function handPickReadout(s: HandPickStats): { count: string; hint: string } {
  const count =
    s.clashes.length === 0
      ? `Your pick: ${s.valid}`
      : `Your pick: ${s.valid}, ${plural(s.clashes.length, "clash", "clashes")}`;
  const hint = s.free === 0 ? "No point can be added without a clash." : `You could still add ${s.free} more without a clash.`;
  return { count, hint };
}

/** The You_Line on the Results_Scene (Requirement 10.1). Neutral words only. */
export function youLine(s: HandPickStats): string {
  const k = s.clashes.length;
  return k === 0 ? `You: ${s.valid}` : `You: ${s.valid} (${plural(k, "clash", "clashes")} not counted)`;
}

/** Words the You_Line and its texts never use (Requirement 10.3). */
export const BANNED_YOU_WORDS = ["beat", "win", "winner", "won", "lose", "lost", "better", "worse", "best"] as const;
