import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FIVE_GHZ_ONLY,
  NOT_PICKED,
  UNITS_LON_LAT,
  UNITS_METRES,
  buildCsv,
  buildGeoJson,
  exportFileName,
  roundValues,
  type ExportInput,
  type ExportPoint,
} from "./export";
import { loadRecorded } from "./tutor/recorded";

/** Small RFC 4180 parser: quoted fields, doubled quotes, commas and line breaks inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function makeResult(rounds: { channel: number; picks: string[] }[], label = "simulation") {
  return { competitors: { Hybrid: { label, rounds } } };
}

const pt = (id: string, x: number, y: number): ExportPoint => ({ id, x, y });

describe("CSV export", () => {
  // Feature: ui, Property 2: CSV export round trip
  // **Validates: Requirements 7.1, 7.3**
  it("Property 2: CSV export round trip", () => {
    const idArb = fc.string({ minLength: 1, unit: fc.constantFrom("a", "b", "1", ",", '"', "\n", "\r", " ", "x") });
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        fc.constantFrom<"channel_plan" | "place">("channel_plan", "place"),
        fc.array(fc.double({ min: -500, max: 500, noNaN: true }), { minLength: 24, maxLength: 24 }),
        (ids, seed, flags, mode, nums) => {
          const points = ids.map((id, i) => pt(id, nums[i]!, nums[12 + i]!));
          const picks = ids.filter((_, i) => flags[i]);
          const input: ExportInput = {
            result: makeResult([{ channel: 6, picks }]),
            plan: "Hybrid",
            mode,
            map: "m",
            seed,
            points,
          };
          const rows = parseCsv(buildCsv(input));
          expect(rows[0]).toEqual(["id", "x", "y", "round", "result_label", "seed"]);
          expect(rows.length).toBe(points.length + 1);
          const expected = roundValues(input);
          points.forEach((p, i) => {
            const r = rows[i + 1]!;
            expect(r).toHaveLength(6);
            expect(r[0]).toBe(p.id);
            expect(Number(r[1]) === p.x).toBe(true); // 0 === -0
            expect(Number(r[2]) === p.y).toBe(true);
            expect(r[3]).toBe(String(expected.get(p.id)));
            expect(r[4]).toBe("simulation");
            expect(r[5]).toBe(String(seed));
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it("Channel_Plan: channel for picked, '5 GHz only' for unpicked", () => {
    const input: ExportInput = {
      result: makeResult([
        { channel: 1, picks: ["a"] },
        { channel: 11, picks: ["b"] },
      ]),
      plan: "Hybrid",
      mode: "channel_plan",
      map: "hero",
      seed: 1,
      points: [pt("a", 0, 0), pt("b", 9, 0), pt("c", 18, 0)],
    };
    const rows = parseCsv(buildCsv(input));
    expect(rows.map((r) => r[3])).toEqual(["round", "1", "11", FIVE_GHZ_ONLY]);
  });

  it("Place: 1 for picked, 'not picked' otherwise", () => {
    const input: ExportInput = {
      result: makeResult([{ channel: 1, picks: ["a"] }]),
      plan: "Hybrid",
      mode: "place",
      map: "kadikoy",
      seed: 3,
      points: [pt("a", 0, 0), pt("b", 9, 0)],
    };
    expect(parseCsv(buildCsv(input)).map((r) => r[3])).toEqual(["round", "1", NOT_PICKED]);
  });

  it("labels 'real hardware' when the result says so", () => {
    const input: ExportInput = {
      result: makeResult([{ channel: 1, picks: [] }], "real hardware"),
      plan: "Hybrid",
      mode: "place",
      map: "m",
      seed: 0,
      points: [pt("a", 0, 0)],
    };
    expect(parseCsv(buildCsv(input))[1]![4]).toBe("real hardware");
  });
});

describe("GeoJSON export", () => {
  const result = makeResult([{ channel: 6, picks: ["a"] }]);

  it("uses [x, y] and metres when points have no lon/lat", () => {
    const g = buildGeoJson({ result, plan: "Hybrid", mode: "channel_plan", map: "hero", seed: 7, points: [pt("a", 1.5, 2.5), pt("b", 3, 4)] });
    expect(g.type).toBe("FeatureCollection");
    expect(g.result_label).toBe("simulation");
    expect(g.seed).toBe(7);
    expect(g.units).toBe(UNITS_METRES);
    expect(g.features[0]!.geometry).toEqual({ type: "Point", coordinates: [1.5, 2.5] });
    expect(g.features[0]!.properties).toEqual({ id: "a", x: 1.5, y: 2.5, round: 6, result_label: "simulation", seed: 7 });
    expect(g.features[1]!.properties.round).toBe(FIVE_GHZ_ONLY);
  });

  it("uses [lon, lat] and degrees for a made-up place fixture", () => {
    const madeUp: ExportPoint[] = [
      { id: "a", x: 10, y: 20, lon: 10.1, lat: 20.2 },
      { id: "b", x: 30, y: 40, lon: 10.3, lat: 20.4 },
    ];
    const g = buildGeoJson({ result, plan: "Hybrid", mode: "place", map: "madeup", seed: 2, points: madeUp });
    expect(g.units).toBe(UNITS_LON_LAT);
    expect(g.features[0]!.geometry.coordinates).toEqual([10.1, 20.2]);
    expect(g.features[0]!.properties).toMatchObject({ x: 10, y: 20, round: 1 });
    expect(g.features[1]!.properties.round).toBe(NOT_PICKED);
  });
});

describe("export follows the selected plan", () => {
  const rec: any = loadRecorded("hero_seed1");
  const comps = rec?.result.competitors ?? {};
  const ids: string[] = Array.from({ length: 70 }, (_, i) => `ap${String(i).padStart(2, "0")}`);
  const points = ids.map((id, i) => pt(id, (i % 10) * 9, Math.floor(i / 10) * 9));
  const rounds = (plan: "Hybrid" | "Atoms_Alone" | "Annealing_Rules" | "Coin_Flip_Rules") =>
    [...roundValues({ result: rec.result, plan, mode: "channel_plan", map: "hero", seed: 1, points })];

  it("different plans give different round values", (ctx) => {
    if (rec === null) ctx.skip("hero_seed1.json is missing");
    expect(Object.keys(comps)).toContain("Hybrid");
    const h = rounds("Hybrid");
    expect(rounds("Atoms_Alone")).not.toEqual(h);
    expect(rounds("Annealing_Rules")).not.toEqual(h);
    expect(rounds("Coin_Flip_Rules")).not.toEqual(h);
  });

  it("the CSV of a plan matches that plan's picks", (ctx) => {
    if (rec === null) ctx.skip("hero_seed1.json is missing");
    const rows = parseCsv(buildCsv({ result: rec.result, plan: "Atoms_Alone", mode: "channel_plan", map: "hero", seed: 1, points }));
    const first = comps.Atoms_Alone.rounds[0];
    const row = rows.find((r) => r[0] === first.picks[0])!;
    expect(row[3]).toBe(String(first.channel));
  });
});

describe("exportFileName", () => {
  it("has map, plan and seed", () => {
    expect(exportFileName("hero", "Hybrid", 1, "csv")).toMatch(/^atommap-hero-.+-seed1\.csv$/);
    expect(exportFileName("Kadıköy Cafes", "Hybrid", 4, "geojson")).toMatch(/^atommap-[a-z0-9-]+-seed4\.geojson$/);
  });

  it("writes a negative seed without a minus sign", () => {
    const n = exportFileName("hero", "Hybrid", -5, "csv");
    expect(n).toMatch(/-seedm5\.csv$/);
    expect(n).not.toMatch(/--/);
  });
});

describe("error entry", () => {
  const input: ExportInput = {
    result: { competitors: { Hybrid: { error: "boom" } } },
    plan: "Hybrid",
    mode: "place",
    map: "m",
    seed: 1,
    points: [pt("a", 0, 0)],
  };
  it("throws a plain sentence from CSV and GeoJSON", () => {
    expect(() => buildCsv(input)).toThrow(/no finished plan/);
    expect(() => buildGeoJson(input)).toThrow(/no finished plan/);
  });
});
