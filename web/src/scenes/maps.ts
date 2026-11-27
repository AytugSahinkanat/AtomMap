// The maps of the Choose_Scene: names, descriptions, chips and the data of their previews
// (experience spec, Requirement 2). The map screen itself still builds the requests.
//
// The wifi hall, Kadikoy cafes, the two US maps, Your map and Today's map. A US map is listed only
// with a passing, matching Map_Check (Requirement 13.6); without one it is not shown at all.

import { loadHero, loadPlace, loadWalls } from "../data/fixtures";
import { buildStraightEdges } from "../edges/straight";
import { buildWallEdges } from "../edges/walls";
import { PLACE_R_M, POINT_LIMIT, YOUR_MAP_AREA_M, YOUR_R_DEFAULT, placeOf } from "../settings";
import { atomsNotNeeded, atomsNotNeededNote, fixtureMatches, mapCheck, runsProblem } from "../data/map-checks";
import type { PreviewData } from "./card-preview";
import type { MapSlug } from "./router";
import { todayMap, todayProgressLine, todayText } from "../daily/today";

export type ChipKind = "walls" | "distance" | "r" | "none";

/** The setting of each map's Card_Chips. Shared by the card and the map scene, kept for the visit. */
export interface ChipState {
  walls: boolean;
  walking: boolean;
  r: number;
}

const chips: Record<MapSlug, ChipState> = {
  hall: { walls: false, walking: true, r: 20 },
  kadikoy: { walking: true, walls: false, r: PLACE_R_M },
  "sf-bus": { walking: true, walls: false, r: 244 },
  "nyc-bike": { walking: true, walls: false, r: 305 },
  "your-map": { walls: false, walking: false, r: YOUR_R_DEFAULT },
  today: { walls: false, walking: false, r: 10 },
};

type Listener = (slug: MapSlug, state: ChipState) => void;
const listeners = new Set<Listener>();

export function getChips(slug: MapSlug): ChipState {
  return { ...chips[slug] };
}

/** Change a map's chips. Every listener hears it (the card preview and the map scene). */
export function setChips(slug: MapSlug, patch: Partial<ChipState>): void {
  const next = { ...chips[slug], ...patch };
  const cur = chips[slug];
  if (next.walls === cur.walls && next.walking === cur.walking && next.r === cur.r) return;
  chips[slug] = next;
  for (const fn of listeners) fn(slug, { ...next });
}

export function onChips(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Your map's points live in the map screen's editor; it hands them over here. */
let yourPoints: () => readonly { id: string; x: number; y: number }[] = () => [];
export function setYourPointsSource(fn: () => readonly { id: string; x: number; y: number }[]): void {
  yourPoints = fn;
}

export interface CardData extends PreviewData {
  /** Number of Points, for the card's label. */
  count: number;
  /** The one-line description, with the numbers of the data. */
  description: string;
}

export interface MapEntry {
  slug: MapSlug;
  /** Name on the card. */
  name: string;
  /** Heading of the Map_Scene. */
  title: string;
  chip: ChipKind;
  /** A short credit line on the card, when the map shows data that needs one. */
  credit?: string;
  /** A line under the card that can change between visits (the Daily_Map's Local_Progress). */
  note?(): string | null;
  load(state: ChipState): Promise<CardData>;
}

/** A map whose committed Map_Check does not match its fixture: the card goes, the map is not offered. */
export class MapGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapGateError";
  }
}

/** The US maps (Requirement 13): listed only with a passing Map_Check (see data/map-checks.ts). */
function usMap(slug: "sf-bus" | "nyc-bike", name: "sf_bus_stops" | "nyc_bike_share", label: string, noun: "stops" | "stations"): MapEntry {
  return {
    slug,
    name: label,
    title: label,
    chip: "distance",
    credit: "© OpenStreetMap contributors",
    note: () => (atomsNotNeeded(mapCheck(name)) ? atomsNotNeededNote(noun) : null),
    async load(s) {
      const f = await loadPlace(name);
      // The Map_Check must be for this version of the fixture (Requirement 13.5).
      if (!fixtureMatches(mapCheck(name), f)) throw new MapGateError(`The check of ${label} is for another version of its data.`);
      const edges = s.walking ? f.walking_edges : buildStraightEdges(f.points, f.r);
      const n = f.points.length;
      const what = placeOf(name)?.noun ?? "points";
      const rule = s.walking ? `within a ${f.r} m walk` : `within ${f.r} m in a straight line`;
      return { points: f.points, edges, count: n, description: `${n} real ${what}. Two ${rule} can't both be kept.` };
    },
  };
}

/** True when the US map's committed Map_Check passes (three ok seeds, 60 s or less each). */
export function usListed(name: "sf_bus_stops" | "nyc_bike_share"): boolean {
  return runsProblem(mapCheck(name)) === null;
}

const US_MAPS: readonly { entry: MapEntry; name: "sf_bus_stops" | "nyc_bike_share" }[] = [
  { entry: usMap("sf-bus", "sf_bus_stops", "San Francisco bus stops (Mission)", "stops"), name: "sf_bus_stops" },
  { entry: usMap("nyc-bike", "nyc_bike_share", "New York bike-share stations (Greenwich Village)", "stations"), name: "nyc_bike_share" },
];

export const MAPS: readonly MapEntry[] = [
  {
    slug: "hall",
    name: "Wifi hall",
    title: "Wifi hall",
    chip: "walls",
    async load(s) {
      const [hero, wf] = await Promise.all([loadHero(), loadWalls()]);
      const r = hero.graph.r;
      const edges = buildWallEdges(hero.points, wf.walls, s.walls, r);
      const n = hero.points.length;
      return {
        points: hero.points,
        edges,
        count: n,
        description: s.walls
          ? `${n} access points in one hall. Two that still hear each other through the walls can't share a channel.`
          : `${n} access points in one hall. Two closer than ${r} m can't share a channel.`,
      };
    },
  },
  {
    slug: "kadikoy",
    name: "Kadıköy cafés",
    title: "Kadıköy, Istanbul",
    chip: "distance",
    credit: "© OpenStreetMap contributors",
    async load(s) {
      const f = await loadPlace("kadikoy");
      const edges = s.walking ? f.walking_edges : buildStraightEdges(f.points, f.r);
      const n = f.points.length;
      const rule = s.walking ? `within a ${f.r} m walk` : `within ${f.r} m in a straight line`;
      return { points: f.points, edges, count: n, description: `${n} real cafés. Two ${rule} can't both be on the list.` };
    },
  },
  ...US_MAPS.filter((m) => usListed(m.name)).map((m) => m.entry),
  {
    slug: "your-map",
    name: "Your map",
    title: "Your map",
    chip: "r",
    async load(s) {
      const points = yourPoints();
      const n = points.length;
      return {
        points,
        edges: buildStraightEdges(points, s.r),
        bounds: { minX: 0, minY: 0, maxX: YOUR_MAP_AREA_M.width, maxY: YOUR_MAP_AREA_M.height },
        count: n,
        description: `Draw, paste or upload up to ${POINT_LIMIT} points. It starts as a ring of 8.`,
      };
    },
  },
  {
    // The Daily_Map (Requirement 11): the same map for everyone on one UTC date. No chips: one
    // Round, straight line, r = 10 m, and the Run_Number is the Daily_Seed.
    slug: "today",
    name: "Today's map",
    title: "Today's map",
    chip: "none",
    note: () => todayProgressLine(),
    async load() {
      const m = todayMap();
      const n = m.points.length;
      return {
        points: m.points,
        edges: m.edges,
        bounds: { minX: 0, minY: 0, maxX: m.area.width, maxY: m.area.height },
        count: n,
        description: `${todayText()}. A new small map every day, the same for everyone: ${n} points, two closer than ${m.r} m can't both be picked.`,
      };
    },
  },
];

export function mapEntry(slug: MapSlug): MapEntry | undefined {
  return MAPS.find((m) => m.slug === slug);
}

/** True when the slug has a card now. Other slugs send the route to the Choose_Scene. */
export function isListed(slug: MapSlug): boolean {
  return mapEntry(slug) !== undefined;
}
