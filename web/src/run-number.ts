// Run_Numbers (experience spec, Requirement 5): the number of a run, which is its Seed.
// A normal run gets a random number from the browser; the Daily_Map always uses its Daily_Seed.
// Pure apart from crypto.getRandomValues.

export const RUN_NUMBER_MIN = 1;
export const RUN_NUMBER_MAX = 9999;

/** A random Run_Number from 1 to 9999. `random` is for tests: it returns a 32-bit unsigned integer. */
export function randomRunNumber(random: () => number = cryptoUint32): number {
  const span = RUN_NUMBER_MAX - RUN_NUMBER_MIN + 1;
  // Rejection sampling, so every number is equally likely.
  const limit = Math.floor(0x1_0000_0000 / span) * span;
  for (let i = 0; i < 64; i++) {
    const v = random() >>> 0;
    if (v < limit) return RUN_NUMBER_MIN + (v % span);
  }
  return RUN_NUMBER_MIN;
}

function cryptoUint32(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** The Daily_Seed: the UTC date as the integer YYYYMMDD, e.g. 20261204. */
export function dailySeed(date: Date): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** The UTC date as "YYYY-MM-DD" (the key of Local_Progress). */
export function utcDateKey(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "4 December 2026", for the card and the heading (UTC, plain English, no locale surprises). */
export function utcDateText(date: Date): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
