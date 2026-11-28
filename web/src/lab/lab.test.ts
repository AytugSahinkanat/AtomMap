// Lab tests (experience spec, task 14.6; Requirements 16.2, 16.3, 16.4, 16.5, 18.1, 18.3, 22.8):
// the ranges and their messages, the labels, the readouts and history rows from a real recorded
// run, the experiment cards, and the lab fields of both exports. The DOM parts are in
// lab-view.test.ts (real Chromium).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  LAB_R_MAX,
  LAB_R_MIN,
  SHOTS_MAX,
  SHOTS_MIN,
  labBarText,
  labFirstLine,
  labLabel,
  parseLabR,
  parseLabSeed,
  parseShots,
  parseTopPercent,
  percentText,
  readoutRows,
  walkingRNote,
} from "./lab-model";
import { historyRow, totalsText } from "./history";
import { EXPERIMENTS } from "./experiments";
import { CSV_HEADER, CSV_HEADER_LAB, buildCsv, buildGeoJson, exportFileName, type ExportInput } from "../export";
import { loadRecorded } from "../tutor/recorded";
import { CARD_ORDER } from "../scoreboard-model";

const hero = loadRecorded("hero_seed1");

describe("the instruments' ranges (Requirement 16.2)", () => {
  it("shots: whole numbers 10 to 200, a plain message otherwise", () => {
    expect(parseShots("10")).toEqual({ ok: true, value: 10 });
    expect(parseShots(" 200 ")).toEqual({ ok: true, value: 200 });
    expect(parseShots("5")).toEqual({ ok: false, error: "Shots must be from 10 to 200. 5 is outside." });
    for (const bad of ["", "abc", "20.5", "-20", "1e2"]) expect(parseShots(bad).ok, bad).toBe(false);
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), (v) => {
      expect(parseShots(String(v)).ok).toBe(v >= SHOTS_MIN && v <= SHOTS_MAX);
    }));
  });
  it("top group: 10% to 100%, the value is the share 0.1 to 1", () => {
    expect(parseTopPercent("40")).toEqual({ ok: true, value: 0.4 });
    expect(parseTopPercent("100 %")).toEqual({ ok: true, value: 1 });
    expect(parseTopPercent("10")).toEqual({ ok: true, value: 0.1 });
    expect(parseTopPercent("33.3")).toEqual({ ok: true, value: 0.333 });
    expect(parseTopPercent("9")).toEqual({ ok: false, error: "The top group must be from 10% to 100%. 9% is outside." });
    for (const bad of ["", "abc", "0.4", "101"]) expect(parseTopPercent(bad).ok, bad).toBe(false);
  });
  it("r: 2 to 400 m", () => {
    expect(parseLabR("20")).toEqual({ ok: true, value: 20 });
    expect(parseLabR("24,5")).toEqual({ ok: true, value: 24.5 });
    expect(parseLabR("1").ok).toBe(false);
    expect(parseLabR(String(LAB_R_MAX + 1)).ok).toBe(false);
    expect(parseLabR(String(LAB_R_MIN)).ok).toBe(true);
    expect(parseLabR("far").ok).toBe(false);
  });
  it("the run number: any whole number", () => {
    expect(parseLabSeed("5681")).toEqual({ ok: true, value: 5681 });
    expect(parseLabSeed("-3")).toEqual({ ok: true, value: -3 });
    expect(parseLabSeed("1.5").ok).toBe(false);
  });
  it("the walking r note (Requirement 16.3)", () => {
    expect(walkingRNote(150)).toBe("Walking distances were measured on the streets for r = 150 m. Switch to straight line to change it.");
  });
});

describe("the labels (Requirements 18.1, 18.3)", () => {
  it("the Lab_Label and the Tutor's first line name the settings, also when they equal the defaults", () => {
    expect(labLabel({ shots: 20, top_share: 1 })).toBe("Lab settings: shots 20, top group 100%. Not the measured defaults.");
    expect(labLabel({ shots: 100, top_share: 0.4 })).toBe("Lab settings: shots 100, top group 40%. Not the measured defaults.");
    expect(labFirstLine({ shots: 100, top_share: 0.4 })).toBe(
      "The run is finished. These results are a simulation with lab settings (shots 100, top group 40%), not the measured defaults.",
    );
    expect(labBarText("Wifi hall", 5)).toBe("ATOMMAP LAB · Wifi hall · RUN 5");
    expect(percentText(0.333)).toBe("33.3");
  });
});

describe("readouts and history from a real run", () => {
  it.skipIf(hero === null)("every readout number is the run's own stat", () => {
    const c = hero!.result.competitors as Record<string, any>;
    const rows = readoutRows(c);
    expect(rows.map((r) => r.plan)).toEqual([...CARD_ORDER]);
    for (const row of rows) {
      const s = c[row.plan].stats;
      expect([row.total, row.quantumShare, row.splits, row.skipped]).toEqual([s.total_picks, s.quantum_share, s.splits, s.skipped_tiles]);
      expect(row.problem).toBeNull();
    }
    const h = historyRow(1, { shots: 20, top_share: 1, r: 20 }, c);
    expect(h.totals).toEqual(CARD_ORDER.map((p) => c[p].stats.total_picks));
    expect(h.hybridShare).toBe(c.Hybrid.stats.quantum_share);
    expect(totalsText(h)).toBe("25/31/35/33");
  });
  it("a plan that did not finish shows as such, with no made-up number", () => {
    const rows = readoutRows({ Hybrid: { error: { message: "x" } } });
    expect(rows.every((r) => r.total === null && r.problem === "did not finish")).toBe(true);
    const h = historyRow(2, { shots: 100, top_share: 0.4, r: 20 }, {});
    expect(h.totals).toEqual([null, null, null, null]);
    expect(totalsText(h)).toBe("–/–/–/–");
  });
});

describe("experiment cards (Requirement 16.5)", () => {
  const base = { seed: 7, r: 20, shots: 100, top_share: 0.4 };
  it("there are five, each with a Try and a Look for", () => {
    expect(EXPERIMENTS.map((x) => x.id)).toEqual(["seed", "shots", "top100", "top10", "bigger-r"]);
    for (const x of EXPERIMENTS) expect(x.tryText.length > 0 && x.lookText.length > 0).toBe(true);
  });
  it("each changes only its own control, to a value inside its range", () => {
    const set = (id: string) => {
      const r = EXPERIMENTS.find((x) => x.id === id)!.set(base, { rReadOnly: false });
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    expect(set("seed")).toEqual({ ...base, seed: 8 });
    expect(set("shots")).toEqual({ ...base, shots: 10 });
    expect(set("top100")).toEqual({ ...base, top_share: 1 });
    expect(set("top10")).toEqual({ ...base, top_share: 0.1 });
    expect(set("bigger-r")).toEqual({ ...base, r: 30 });
    for (const x of EXPERIMENTS) {
      const r = x.set(base, { rReadOnly: false });
      if (!r.ok) continue;
      expect(parseShots(String(r.value.shots)).ok).toBe(true);
      expect(parseTopPercent(percentText(r.value.top_share)).ok).toBe(true);
      expect(parseLabR(String(r.value.r)).ok).toBe(true);
    }
  });
  it("a bigger r stops at 400 m, and is refused on walking maps", () => {
    const x = EXPERIMENTS.find((e) => e.id === "bigger-r")!;
    expect(x.set({ ...base, r: 350 }, { rReadOnly: false })).toEqual({ ok: true, value: { ...base, r: 400 } });
    expect(x.set(base, { rReadOnly: true }).ok).toBe(false);
  });
});

describe("the exports of a Lab_Run (Requirement 18.1)", () => {
  it.skipIf(hero === null)("CSV column, GeoJSON member and file name; a normal run is unchanged", () => {
    const input: ExportInput = {
      result: hero!.result,
      plan: "Hybrid",
      mode: "channel_plan",
      map: "hero",
      seed: 1,
      points: hero!.request.points,
    };
    const label = labLabel({ shots: 20, top_share: 1 });
    const lab = { ...input, lab: { shots: 20, top_share: 1, r: 20, label } };
    const csv = buildCsv(lab).trimEnd().split("\n");
    expect(csv[0]).toBe(CSV_HEADER_LAB);
    for (const row of csv.slice(1)) expect(row.endsWith(`,"${label}"`)).toBe(true);
    expect(buildCsv(input).split("\n")[0]).toBe(CSV_HEADER);
    const geo = buildGeoJson(lab);
    expect(geo.lab_settings).toEqual({ shots: 20, top_share: 1, r: 20, label });
    expect(geo.features.every((f) => f.properties.lab_settings === label)).toBe(true);
    expect("lab_settings" in buildGeoJson(input)).toBe(false);
    expect(exportFileName("hero", "Hybrid", 5, "csv", true)).toBe("atommap-hero-atoms-rules-hybrid-seed5-lab.csv");
    expect(exportFileName("hero", "Hybrid", 5, "csv")).toBe("atommap-hero-atoms-rules-hybrid-seed5.csv");
  });
});
