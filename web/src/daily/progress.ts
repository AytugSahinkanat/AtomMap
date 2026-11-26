// Local_Progress (experience spec, Requirement 12): the visitor's best Valid_Picks per Daily_Map
// and the days played, in this browser's localStorage only. Nothing is sent anywhere.
// Every storage access is in a try/catch: a missing, full or blocked storage, or data of the
// wrong shape, means "no progress", never an error on screen.

export const PROGRESS_KEY = "atommap.progress.v1";
export const MAX_DAYS = 60;

export interface Progress {
  v: 1;
  /** "YYYY-MM-DD" (UTC) to the best Valid_Picks of that date's Daily_Map. */
  days: Record<string, { best: number }>;
}

/** The parts of Storage this module uses. */
export type ProgressStorage = Pick<Storage, "getItem" | "setItem">;

export function emptyProgress(): Progress {
  return { v: 1, days: {} };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for `{v: 1, days: {date: {best: integer >= 0}}}` and nothing else. */
export function isProgress(x: unknown): x is Progress {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || typeof o.days !== "object" || o.days === null || Array.isArray(o.days)) return false;
  for (const [k, d] of Object.entries(o.days as Record<string, unknown>)) {
    if (!DATE_RE.test(k)) return false;
    if (typeof d !== "object" || d === null || Array.isArray(d)) return false;
    const best = (d as Record<string, unknown>).best;
    if (typeof best !== "number" || !Number.isSafeInteger(best) || best < 0) return false;
  }
  return true;
}

/** `window.localStorage`, or null where reading it throws or it is missing. */
export function browserStorage(): ProgressStorage | null {
  try {
    const s = typeof window === "undefined" ? undefined : window.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** The stored progress, or an empty one on any error or wrong shape. */
export function loadProgress(storage: ProgressStorage | null): Progress {
  if (storage === null) return emptyProgress();
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    if (typeof raw !== "string") return emptyProgress();
    const parsed: unknown = JSON.parse(raw);
    if (!isProgress(parsed)) return emptyProgress();
    const days: Progress["days"] = {};
    for (const [k, d] of Object.entries(parsed.days)) days[k] = { best: d.best };
    return { v: 1, days };
  } catch {
    return emptyProgress();
  }
}

/** The date was played with this many Valid_Picks: marked played, best is the larger one. Pure. */
export function recordDaily(p: Progress, date: string, valid: number): Progress {
  const v = Number.isSafeInteger(valid) && valid >= 0 ? valid : 0;
  const before = p.days[date]?.best ?? 0;
  return { v: 1, days: { ...p.days, [date]: { best: Math.max(before, v) } } };
}

function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Days played in a row, counted back from today, or from yesterday when today is not played yet
 * (so the card can say "play today to keep it"). 0 when neither is played.
 */
export function streak(p: Progress, today: string): number {
  if (!DATE_RE.test(today)) return 0;
  let day = p.days[today] ? today : dayBefore(today);
  let n = 0;
  while (p.days[day] && n <= MAX_DAYS) {
    n++;
    day = dayBefore(day);
  }
  return n;
}

/** The last MAX_DAYS dates only. Pure. */
export function trimProgress(p: Progress): Progress {
  const keys = Object.keys(p.days).sort().slice(-MAX_DAYS);
  const days: Progress["days"] = {};
  for (const k of keys) days[k] = { best: p.days[k].best };
  return { v: 1, days };
}

/** Save the last MAX_DAYS dates. Never throws: a full or blocked storage just keeps nothing. */
export function saveProgress(storage: ProgressStorage | null, p: Progress): void {
  if (storage === null) return;
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(trimProgress(p)));
  } catch {
    // Full, blocked or gone: the app works as without Local_Progress (Requirement 12.3).
  }
}

/** The card's progress line, or null when there is none for these dates. Neutral words only. */
export function progressLine(p: Progress, today: string): string | null {
  const best = p.days[today]?.best;
  const s = streak(p, today);
  const parts: string[] = [];
  // A run alone marks the day with 0: no hand count to show then.
  if (best !== undefined && best > 0) parts.push(`Your pick today: ${best}`);
  if (s > 0) parts.push(p.days[today] ? `${s}-day streak` : `${s}-day streak, play today to keep it`);
  return parts.length === 0 ? null : parts.join(". ") + ".";
}
