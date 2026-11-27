// The two US maps (experience spec, task 11.4; Requirements 13.2, 13.3, 13.5, 13.6, 22.8).
import { describe, expect, it } from "vitest";
import { validatePlace } from "./fixtures";
import {
  atomsNotNeeded,
  atomsNotNeededNote,
  fixtureMatches,
  mapCheck,
  runsProblem,
  type ChecksFile,
  type MapCheck,
} from "./map-checks";
import { MAPS } from "../scenes/maps";
import { PLACES } from "../settings";
import { exportFileName } from "../export";
import { CARD_LABELS, type EngineName } from "../scoreboard-model";

// Every text file the checks read, as raw text, keyed by its path (Vite, no Node types needed).
const APP = import.meta.glob(["../**/*.{ts,css,json}", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const SCRIPTS = import.meta.glob("../../scripts/*.{mjs,json}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const FIXTURES = import.meta.glob("../../../fixtures/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const INDEX = import.meta.glob("../../index.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const fixture = (f: string) => {
  const key = Object.keys(FIXTURES).find((k) => k.endsWith(`/${f}`));
  if (!key) throw new Error(`fixtures/${f} is missing`);
  return JSON.parse(FIXTURES[key]);
};
const sf = fixture("place_sf_bus_stops.json");
const nyc = fixture("place_nyc_bike_share.json");
const kad = fixture("place_kadikoy.json");

describe("the fixture loader", () => {
  it("accepts both US fixtures with their own r, and Kadıköy with 150", () => {
    const a = validatePlace(sf, "place_sf_bus_stops.json");
    const b = validatePlace(nyc, "place_nyc_bike_share.json");
    expect([a.r, b.r, validatePlace(kad, "place_kadikoy.json").r]).toEqual([244, 305, 150]);
    expect(a.kind).toBe("bus_stop");
    expect(b.kind).toBe("bike_share");
    expect(a.story && b.story).toBeTruthy();
    expect(a.merge?.radius_m).toBe(40);
    expect(b.names?.names_changed).toBeGreaterThan(0);
  });
  it("refuses a missing r and bad optional fields", () => {
    const { r: _r, ...noR } = sf;
    expect(() => validatePlace(noR, "x.json")).toThrow(/"r"/);
    expect(() => validatePlace({ ...sf, r: -1 }, "x.json")).toThrow(/"r"/);
    expect(() => validatePlace({ ...sf, story: "" }, "x.json")).toThrow(/"story"/);
    expect(() => validatePlace({ ...sf, merge: { radius_m: 40 } }, "x.json")).toThrow(/"merge"/);
  });
});

// A passing check for tests, built from a fixture.
function passing(f: typeof sf, share = 0): MapCheck {
  return {
    fixture: { osm_data_timestamp: f.source.osm_data_timestamp, points: f.points.length, walking_edges: f.walking_edges.length, r: f.r },
    runs: [1, 2, 3].map((seed) => ({
      seed,
      seconds: 10,
      ok: true,
      totals: { Atoms_Alone: 1, Hybrid: 1, Annealing_Rules: 1, Coin_Flip_Rules: 1 },
      quantum_share: { Atoms_Alone: 1, Hybrid: seed === 2 ? share : 0, Annealing_Rules: 0, Coin_Flip_Rules: 0 },
    })),
  };
}

describe("the gate", () => {
  it("a missing check: not listed, no note", () => {
    expect(runsProblem(undefined)).not.toBeNull();
    expect(atomsNotNeeded(undefined)).toBe(false);
    expect(mapCheck("sf_bus_stops", {} as ChecksFile)).toBeUndefined();
  });
  it("a slow, failed, missing or doubled seed: not listed", () => {
    const slow = passing(sf);
    slow.runs[2] = { ...slow.runs[2], seconds: 60.1, over_limit: true };
    expect(runsProblem(slow)).toMatch(/seed 3 took 60.1 s/);
    const failed = passing(sf);
    failed.runs[0] = { ...failed.runs[0], ok: false };
    expect(runsProblem(failed)).toMatch(/seed 1/);
    const short = passing(sf);
    short.runs.pop();
    expect(runsProblem(short)).toMatch(/seed 3: 0 runs/);
    const doubled = passing(sf);
    doubled.runs.push({ ...doubled.runs[0] });
    expect(runsProblem(doubled)).toMatch(/seed 1: 2 runs/);
    const exact = passing(sf);
    exact.runs[1] = { ...exact.runs[1], seconds: 60 };
    expect(runsProblem(exact)).toBeNull(); // 60 s is within the limit
  });
  it("a stale check (another fetch of the fixture) does not match", () => {
    const c = passing(sf);
    expect(fixtureMatches(c, sf)).toBe(true);
    expect(fixtureMatches(c, { ...sf, source: { ...sf.source, osm_data_timestamp: "2027-01-01T00:00:00Z" } })).toBe(false);
    expect(fixtureMatches(c, { ...sf, points: sf.points.slice(1) })).toBe(false);
    expect(fixtureMatches(c, { ...sf, walking_edges: sf.walking_edges.slice(1) })).toBe(false);
    expect(fixtureMatches(c, { ...sf, r: 250 })).toBe(false);
    expect(fixtureMatches(c, nyc)).toBe(false);
  });
  it("the note needs a 0% hybrid share in all three seeds", () => {
    expect(atomsNotNeeded(passing(sf, 0))).toBe(true);
    expect(atomsNotNeeded(passing(sf, 0.05))).toBe(false);
    const slow = passing(sf);
    slow.runs[0] = { ...slow.runs[0], seconds: 61 };
    expect(atomsNotNeeded(slow)).toBe(false); // no note on an unlisted map
  });
  it("the committed check lists both US maps, matches their fixtures and gives the note", () => {
    for (const [name, f, slug] of [["sf_bus_stops", sf, "sf-bus"], ["nyc_bike_share", nyc, "nyc-bike"]] as const) {
      const c = mapCheck(name);
      expect(runsProblem(c), name).toBeNull();
      expect(fixtureMatches(c, f), name).toBe(true);
      expect(atomsNotNeeded(c), name).toBe(true);
      expect(MAPS.some((m) => m.slug === slug)).toBe(true);
      expect(MAPS.find((m) => m.slug === slug)?.note?.()).toBe(atomsNotNeededNote(name === "sf_bus_stops" ? "stops" : "stations"));
    }
  });
});

// Operator and brand names of the two US systems (Requirement 13.3).
const BRANDS = [/\bciti\s*bike\b/i, /\bcitibike\b/i, /\blyft\b/i, /\bmuni\b/i, /\bsfmta\b/i, /\bbay\s*wheels\b/i, /\bmotivate\b/i, /\bford\s*gobike\b/i];
const brandIn = (text: string) => BRANDS.filter((b) => b.test(text)).map(String);

describe("no brand name (Requirement 13.3)", () => {
  it("in any app source file, script, fixture value or file name", () => {
    const all = { ...APP, ...SCRIPTS, ...FIXTURES, ...INDEX };
    expect(Object.keys(APP).length).toBeGreaterThan(40);
    expect(Object.keys(FIXTURES).length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(SCRIPTS).some((k) => k.endsWith("check-maps.mjs"))).toBe(true);
    for (const [path, text] of Object.entries(all)) {
      expect(brandIn(path), path).toEqual([]);
      expect(brandIn(text), path).toEqual([]);
    }
  });
  it("in the map names, labels and export file names", () => {
    for (const p of PLACES) expect(brandIn(`${p.label} ${p.name} ${p.file} ${p.slug} ${p.noun}`)).toEqual([]);
    for (const m of MAPS) expect(brandIn(`${m.name} ${m.title} ${m.note?.() ?? ""}`)).toEqual([]);
    for (const slug of ["sf-bus", "nyc-bike"])
      for (const plan of Object.keys(CARD_LABELS) as EngineName[]) expect(brandIn(exportFileName(slug, plan, 1, "csv"))).toEqual([]);
    for (const f of [sf, nyc]) for (const pt of f.points) expect(brandIn(pt.name ?? ""), pt.id).toEqual([]);
  });
  it("the brand check itself catches a brand", () => {
    expect(brandIn("Lyft station")).not.toEqual([]);
    expect(brandIn("community")).toEqual([]); // "muni" only as a word
  });
});

describe("the US note words", () => {
  it("contain no banned word", () => {
    const banned = ["beat", "win", "winner", "won", "lose", "lost", "better", "worse", "best", "faster", "speed"];
    for (const noun of ["stops", "stations"] as const) {
      const words = atomsNotNeededNote(noun).toLowerCase().split(/[^a-z]+/);
      for (const w of banned) expect(words).not.toContain(w);
    }
  });
});
