// "Today" for the Daily_Map (experience spec, design "Daily_Map"): the UTC date is read once when
// the Choose_Scene opens, so a visitor who stays past midnight UTC keeps that map until the next
// Choose_Scene. The card and the map scene both read the map and the progress from here.

import { buildDailyMap, type DailyMap } from "./daily-map";
import { browserStorage, loadProgress, progressLine, recordDaily, saveProgress } from "./progress";
import { dailySeed, utcDateKey, utcDateText } from "../run-number";

let today = new Date();
let cached: DailyMap | null = null;

/** Read today's UTC date again (the Choose_Scene opens). `now` is for tests. */
export function readToday(now: Date = new Date()): void {
  today = new Date(now.getTime());
  if (cached !== null && cached.seed !== dailySeed(today)) cached = null;
}

export function todaySeed(): number {
  return dailySeed(today);
}

export function todayKey(): string {
  return utcDateKey(today);
}

export function todayText(): string {
  return utcDateText(today);
}

/** Today's map (built once per date). */
export function todayMap(): DailyMap {
  if (cached === null || cached.seed !== todaySeed()) cached = buildDailyMap(todaySeed());
  return cached;
}

/** The card's progress line, or null when there is none (or no storage). */
export function todayProgressLine(): string | null {
  return progressLine(loadProgress(browserStorage()), todayKey());
}

/** Today was played: a Hand_Pick with this many Valid_Picks, or a run (0). Keeps the larger count. */
export function recordToday(valid: number): void {
  const storage = browserStorage();
  saveProgress(storage, recordDaily(loadProgress(storage), todayKey(), valid));
}
