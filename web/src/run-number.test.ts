// Run_Numbers (experience spec, Requirement 5).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RUN_NUMBER_MAX, RUN_NUMBER_MIN, dailySeed, randomRunNumber, utcDateKey, utcDateText } from "./run-number";

describe("run numbers", () => {
  it("are 1 to 9999 for any random source", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 0xffffffff }), { minLength: 1, maxLength: 70 }), (vals) => {
      let i = 0;
      const n = randomRunNumber(() => vals[i++ % vals.length]);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(RUN_NUMBER_MIN);
      expect(n).toBeLessThanOrEqual(RUN_NUMBER_MAX);
    }));
    for (let k = 0; k < 200; k++) {
      const n = randomRunNumber();
      expect(n >= 1 && n <= 9999).toBe(true);
    }
  });
  it("the Daily_Seed is the UTC date as YYYYMMDD", () => {
    expect(dailySeed(new Date(Date.UTC(2026, 11, 4)))).toBe(20261204);
    expect(dailySeed(new Date(Date.UTC(2028, 1, 29, 23, 59)))).toBe(20280229);
    expect(dailySeed(new Date("2026-12-31T23:30:00-02:00"))).toBe(20270101); // UTC, not local time
    expect(utcDateKey(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01-05");
    expect(utcDateText(new Date(Date.UTC(2026, 11, 4)))).toBe("4 December 2026");
  });
});
