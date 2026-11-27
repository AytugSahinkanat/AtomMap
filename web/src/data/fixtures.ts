// Fixture loading and shape checks. Same-origin fetch of committed files only.
// No sample data, no fallback data, no Overpass or tile requests.

import { FIXTURES_DIR, PLACES, type PlaceName } from '../settings';
import type { Pt, Wall } from '../edges/walls';

export interface HeroFixture {
  name: string;
  points: Pt[];
  graph: { r: number };
}

export interface WallsFixture {
  walls: Wall[];
}

export interface PlacePoint {
  id: string;
  x: number;
  y: number;
  lat: number;
  lon: number;
  name?: string;
}

export interface PlaceFixture {
  name: string;
  mode: 'place';
  /** The distance rule in metres, read from the fixture (150, 244, 305). Never assumed. */
  r: number;
  /** What the points are ("bus_stop", "bike_share"); absent on the Kadıköy fixture. */
  kind?: string;
  /** One plain line about the map, shown on the Map_Scene (Requirement 3.5). */
  story?: string;
  /** How names were cleaned (brand prefixes removed), or how stops were merged. Kept for the record. */
  names?: { rule: string; names_changed: number };
  merge?: { radius_m: number; rule: string; osm_stops: number; merged_points: number; stops_merged: number };
  bbox: { south: number; west: number; north: number; east: number };
  origin: { lat: number; lon: number };
  points: PlacePoint[];
  streets: [number, number][][];
  walking_edges: [string, string][];
  source: {
    attribution: string;
    licence: string;
    licence_url: string;
    overpass_endpoint: string;
    query: string;
    osm_data_timestamp: string;
    fetched_at: string;
    script: string;
    script_args: string[];
  };
  counts: {
    points: number;
    street_polylines: number;
    walking_edges: number;
    max_snap_m: number;
  };
}

export type Fetcher = (url: string) => Promise<Response>;

/** Error whose message names the file it is about. */
export class FixtureError extends Error {
  readonly file: string;
  constructor(file: string, reason: string) {
    super(`${file}: ${reason}`);
    this.name = 'FixtureError';
    this.file = file;
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function fail(file: string, reason: string): never {
  throw new FixtureError(file, reason);
}

function need(file: string, ok: boolean, reason: string): void {
  if (!ok) fail(file, `wrong shape, ${reason}`);
}

async function fetchJson(file: string, fetcher: Fetcher): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(FIXTURES_DIR + file);
  } catch (e) {
    return fail(file, `could not be loaded (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) fail(file, `not found or not readable (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch {
    return fail(file, 'is not valid JSON');
  }
}

const defaultFetcher: Fetcher = (url) => fetch(url);

// ---- validators (exported for tests) ----

export function validateHero(data: unknown, file = 'wifi_hall_hero.json'): HeroFixture {
  need(file, isObj(data), 'expected an object');
  const d = data as Obj;
  need(file, isStr(d.name), '"name" must be a string');
  need(file, Array.isArray(d.points) && d.points.length > 0, '"points" must be a non-empty array');
  for (const p of d.points as unknown[]) {
    need(file, isObj(p) && isStr(p.id) && isNum(p.x) && isNum(p.y), 'each point needs id, x, y');
  }
  need(file, isObj(d.graph) && isNum(d.graph.r) && d.graph.r > 0, '"graph.r" must be a positive number');
  return d as unknown as HeroFixture;
}

export function validateWalls(data: unknown, file = 'wifi_hall_walls.json'): WallsFixture {
  need(file, isObj(data) && Array.isArray(data.walls), '"walls" must be an array');
  for (const w of (data as Obj).walls as unknown[]) {
    need(
      file,
      isObj(w) &&
        isNum(w.x1) && isNum(w.y1) && isNum(w.x2) && isNum(w.y2) &&
        (w.kind === 'concrete' || w.kind === 'drywall'),
      'each wall needs x1, y1, x2, y2 and kind "concrete" or "drywall"',
    );
  }
  return data as unknown as WallsFixture;
}

export function validatePlace(data: unknown, file: string): PlaceFixture {
  need(file, isObj(data), 'expected an object');
  const d = data as Obj;
  need(file, isStr(d.name), '"name" must be a string');
  need(file, d.mode === 'place', '"mode" must be "place"');
  need(file, isNum(d.r) && d.r > 0, '"r" must be a positive number of metres');
  need(file, d.kind === undefined || isStr(d.kind), '"kind" must be a string');
  need(file, d.story === undefined || (isStr(d.story) && d.story.trim() !== ''), '"story" must be a non-empty string');
  need(
    file,
    d.names === undefined || (isObj(d.names) && isStr(d.names.rule) && isNum(d.names.names_changed)),
    '"names" needs rule and names_changed',
  );
  need(
    file,
    d.merge === undefined ||
      (isObj(d.merge) && isNum(d.merge.radius_m) && isStr(d.merge.rule) && isNum(d.merge.osm_stops) &&
        isNum(d.merge.merged_points) && isNum(d.merge.stops_merged)),
    '"merge" needs radius_m, rule, osm_stops, merged_points and stops_merged',
  );
  need(
    file,
    isObj(d.bbox) && isNum(d.bbox.south) && isNum(d.bbox.west) && isNum(d.bbox.north) && isNum(d.bbox.east),
    '"bbox" needs south, west, north, east',
  );
  need(file, isObj(d.origin) && isNum(d.origin.lat) && isNum(d.origin.lon), '"origin" needs lat, lon');

  need(file, Array.isArray(d.points), '"points" must be an array');
  const ids = new Set<string>();
  for (const p of d.points as unknown[]) {
    need(
      file,
      isObj(p) && isStr(p.id) && isNum(p.x) && isNum(p.y) && isNum(p.lat) && isNum(p.lon) &&
        (p.name === undefined || isStr(p.name)),
      'each point needs id, x, y, lat, lon',
    );
    ids.add((p as Obj).id as string);
  }

  need(file, Array.isArray(d.streets), '"streets" must be an array');
  for (const line of d.streets as unknown[]) {
    need(
      file,
      Array.isArray(line) &&
        line.every((c) => Array.isArray(c) && c.length === 2 && isNum(c[0]) && isNum(c[1])),
      'each street must be a list of [x, y] pairs',
    );
  }

  need(file, Array.isArray(d.walking_edges), '"walking_edges" must be an array');
  for (const e of d.walking_edges as unknown[]) {
    need(
      file,
      Array.isArray(e) && e.length === 2 && isStr(e[0]) && isStr(e[1]) && ids.has(e[0]) && ids.has(e[1]),
      'each walking edge must be a pair of existing point ids',
    );
  }

  const s = d.source;
  need(
    file,
    isObj(s) &&
      isStr(s.attribution) && isStr(s.licence) && isStr(s.licence_url) &&
      isStr(s.overpass_endpoint) && isStr(s.query) && isStr(s.osm_data_timestamp) &&
      isStr(s.fetched_at) && isStr(s.script) &&
      Array.isArray(s.script_args) && s.script_args.every(isStr),
    '"source" is missing fields',
  );

  const c = d.counts;
  need(
    file,
    isObj(c) && isNum(c.points) && isNum(c.street_polylines) && isNum(c.walking_edges) && isNum(c.max_snap_m),
    '"counts" is missing fields',
  );
  return data as unknown as PlaceFixture;
}

// ---- loaders ----

let heroCache: Promise<HeroFixture> | null = null;
let wallsCache: Promise<WallsFixture> | null = null;
const placeCache = new Map<PlaceName, PlaceFixture>();
const placePending = new Map<PlaceName, Promise<PlaceFixture>>();

export function loadHero(fetcher: Fetcher = defaultFetcher): Promise<HeroFixture> {
  const file = 'wifi_hall_hero.json';
  heroCache ??= fetchJson(file, fetcher).then((d) => validateHero(d, file));
  heroCache.catch(() => (heroCache = null));
  return heroCache;
}

export function loadWalls(fetcher: Fetcher = defaultFetcher): Promise<WallsFixture> {
  const file = 'wifi_hall_walls.json';
  wallsCache ??= fetchJson(file, fetcher).then((d) => validateWalls(d, file));
  wallsCache.catch(() => (wallsCache = null));
  return wallsCache;
}

/**
 * Load one place. Fetches `place_<name>.json` the first time, then serves the
 * cached copy. A failure is not cached and does not affect the other place.
 */
export function loadPlace(name: PlaceName, fetcher: Fetcher = defaultFetcher): Promise<PlaceFixture> {
  const cached = placeCache.get(name);
  if (cached) return Promise.resolve(cached);
  const pending = placePending.get(name);
  if (pending) return pending;

  const place = PLACES.find((p) => p.name === name);
  if (!place) return Promise.reject(new Error(`Unknown place "${String(name)}"`));

  const p = fetchJson(place.file, fetcher)
    .then((d) => {
      const fx = validatePlace(d, place.file);
      placeCache.set(name, fx);
      return fx;
    })
    .finally(() => placePending.delete(name));
  placePending.set(name, p);
  return p;
}

/** Test helper: forget everything that was loaded. */
export function clearFixtureCaches(): void {
  heroCache = null;
  wallsCache = null;
  placeCache.clear();
  placePending.clear();
}
