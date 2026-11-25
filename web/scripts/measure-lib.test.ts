// Tests for the pure parts of the point limit measurement (task 13.9). Nothing is measured here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POINT_LIMIT } from "../src/settings";
// @ts-expect-error plain .mjs without types
import * as lib from "./measure-lib.mjs";

const run = (size: number, seconds: number, ok = true, layout = "dense") => ({ size, layout, seconds, ok });

describe("plan", () => {
  it("has 6 sizes x 3 layouts x 3 layout seeds = 54 runs, in order of size", () => {
    const plan = lib.planRuns();
    expect(plan).toHaveLength(54);
    expect(plan.map((p: { size: number }) => p.size)).toEqual([...plan.map((p: { size: number }) => p.size)].sort((a, b) => a - b));
    expect(new Set(plan.map((p: { layout: string; r: number }) => `${p.layout}:${p.r}`))).toEqual(
      new Set(["dense:20", "mid:10", "sparse:5"]),
    );
  });
  it("has the settings of the design table", () => {
    expect(lib.SIZES).toEqual([25, 50, 100, 150, 200, 300]);
    expect(lib.LIMIT_SECONDS).toBe(60);
    expect(lib.STOP_SECONDS).toBe(180);
    expect(lib.RUN_SEED).toBe(1);
  });
});

describe("computeLimit", () => {
  it("is the largest size whose runs, and all smaller sizes' runs, are within 60 s", () => {
    const runs = [run(25, 3), run(25, 4), run(50, 20), run(50, 59.9), run(100, 60), run(150, 61)];
    expect(lib.computeLimit(runs, [25, 50, 100, 150])).toBe(100);
  });
  it("one slow run at a size disqualifies that size and the larger ones", () => {
    const runs = [run(25, 3), run(50, 20), run(50, 70, true, "sparse"), run(100, 5)];
    expect(lib.computeLimit(runs, [25, 50, 100])).toBe(25);
  });
  it("a failed run disqualifies its size even when fast", () => {
    expect(lib.computeLimit([run(25, 3), run(50, 2, false)], [25, 50])).toBe(25);
  });
  it("is null when the smallest size does not qualify, and for no runs", () => {
    expect(lib.computeLimit([run(25, 61)], [25, 50])).toBeNull();
    expect(lib.computeLimit([], [25, 50])).toBeNull();
  });
  it("sizes that were not run do not count", () => {
    expect(lib.computeLimit([run(25, 3), run(50, 4)], [25, 50, 100])).toBe(50);
  });
});

describe("shouldStopAfter", () => {
  it("stops after a size with a run over 180 s, or a run with no time", () => {
    expect(lib.shouldStopAfter([run(100, 10), run(100, 181)])).toBe(true);
    expect(lib.shouldStopAfter([run(100, 10), run(100, 180)])).toBe(false);
    expect(lib.shouldStopAfter([run(100, Number.NaN, false)])).toBe(true);
  });
});

describe("formatTable", () => {
  it("lists every size, marks sizes that were not run and shows failures", () => {
    const runs = [run(25, 3.04), run(25, 4, true, "mid"), run(25, 301, false, "sparse")];
    runs[2] = { ...runs[2], reason: "timeout" } as never;
    const table = lib.formatTable(runs, [25, 50]);
    expect(table).toContain("| 25 | 3.0 | 4.0 | 301.0 (timeout) | 301.0 (sparse) |");
    expect(table).toContain("| 50 | not run | not run | not run | not run |");
  });
});

describe("the committed measurement", () => {
  const file = JSON.parse(readFileSync(new URL("./limit-measurements.json", import.meta.url), "utf8"));
  it("has the 54 runs of the plan, all counted, with the settings of the plan", () => {
    expect(file.runs).toHaveLength(54);
    expect(file.settings.sizes).toEqual(lib.SIZES);
    expect(file.settings.limit_seconds).toBe(lib.LIMIT_SECONDS);
  });
  it("gives the limit that the file says, and POINT_LIMIT in settings.ts is that limit", () => {
    expect(lib.computeLimit(file.runs)).toBe(file.limit_by_rule);
    expect(POINT_LIMIT).toBe(file.limit_by_rule);
  });
});
