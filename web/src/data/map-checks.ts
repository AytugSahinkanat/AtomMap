// The gate of the US maps (experience spec, Requirements 13.4 to 13.6). Pure: it reads the committed
// Map_Check (map-checks.json, written by `npm run check-maps`) and, once loaded, the fixture.
//
// A US map is listed only when its Map_Check exists, has an ok run of 60 s or less for each of
// seeds 1, 2 and 3, and was made on the same fixture (data timestamp, point and edge counts, r).
// The "atoms were not needed" note is shown only when the Hybrid's quantum share is 0 in all three.
// These rules were fixed before measuring.

import checksFile from "./map-checks.json";

export const CHECK_SEEDS = [1, 2, 3] as const;
export const CHECK_LIMIT_SECONDS = 60;

export interface CheckRun {
  seed: number;
  seconds: number;
  ok: boolean;
  over_limit?: boolean;
  totals?: Record<string, number>;
  quantum_share?: Record<string, number>;
  error?: string;
}
export interface MapCheck {
  fixture: { osm_data_timestamp: string; points: number; walking_edges: number; r: number };
  runs: CheckRun[];
}
export interface ChecksFile {
  maps?: Record<string, MapCheck>;
}
/** The parts of a loaded fixture the gate compares. */
export interface FixtureId {
  r: number;
  points: readonly unknown[];
  walking_edges: readonly unknown[];
  source: { osm_data_timestamp: string };
}

/** Why a map is not listed, or null when its runs pass. Ignores the fixture (see `fixtureMatches`). */
export function runsProblem(check: MapCheck | undefined): string | null {
  if (!check || !Array.isArray(check.runs)) return "no Map_Check";
  for (const seed of CHECK_SEEDS) {
    const runs = check.runs.filter((r) => r.seed === seed);
    if (runs.length !== 1) return `seed ${seed}: ${runs.length} runs`;
    const r = runs[0];
    if (!r.ok) return `seed ${seed} did not finish`;
    if (!(typeof r.seconds === "number" && r.seconds <= CHECK_LIMIT_SECONDS)) return `seed ${seed} took ${r.seconds} s`;
    if (!r.totals || !r.quantum_share) return `seed ${seed} has no numbers`;
  }
  return null;
}

/** True when the Map_Check was made on this fixture (Requirement 13.5: not "another version"). */
export function fixtureMatches(check: MapCheck | undefined, f: FixtureId): boolean {
  if (!check?.fixture) return false;
  return (
    check.fixture.osm_data_timestamp === f.source.osm_data_timestamp &&
    check.fixture.points === f.points.length &&
    check.fixture.walking_edges === f.walking_edges.length &&
    check.fixture.r === f.r
  );
}

/** True when the Hybrid's quantum share is 0 in all three seeds (and the runs pass). */
export function atomsNotNeeded(check: MapCheck | undefined): boolean {
  if (runsProblem(check) !== null) return false;
  return CHECK_SEEDS.every((seed) => check!.runs.find((r) => r.seed === seed)?.quantum_share?.Hybrid === 0);
}

/** The note of Requirement 13.4, in plain words, as a contrast with the hall and Kadıköy. */
export function atomsNotNeededNote(noun: "stops" | "stations"): string {
  return (
    "In our runs on this map the rules made every pick, so the atoms were not needed. " +
    `The ${noun} line up along the streets, and the rules solve such chains on their own.`
  );
}

const committed = checksFile as ChecksFile;

/** The committed Map_Check of a US map (by fixture name), or undefined. `file` is for tests. */
export function mapCheck(name: string, file: ChecksFile = committed): MapCheck | undefined {
  return file.maps?.[name];
}
