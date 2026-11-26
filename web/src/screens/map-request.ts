// Pure helpers for the Map_Screen: seed parsing and the run request.
// No MIS logic. The engine builds its own graph for the straight-line Place case.

import { PLACE_R_M } from '../settings';
import { buildWallEdges } from '../edges/walls';
import { buildStraightEdges } from '../edges/straight';
import type { Wall } from '../edges/walls';

export interface RequestPoint {
  id: string;
  x: number;
  y: number;
}

export type Edge = [string, string];

/**
 * Parse the seed text: trimmed, optional minus, digits only, safe integer.
 * Returns null for anything else, so no run starts on a bad seed.
 * (Task 8.1 adds web/src/seed.ts with the same rule; switch to it then.)
 */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

export type MapChoice =
  | {
      mode: 'channel_plan';
      points: readonly RequestPoint[];
      walls: readonly Wall[];
      wallsOn: boolean;
      /** The Hero_Map fixture's r in metres. */
      r: number;
    }
  | {
      mode: 'place';
      points: readonly RequestPoint[];
      walkingEdges: readonly Edge[];
      walking: boolean;
    }
  | {
      /** Your map: the visitor's own points, one round, straight-line distance (ui requirement 8). */
      mode: 'your_map';
      points: readonly RequestPoint[];
      /** The visitor's r in metres. */
      r: number;
    };

/** What the Place mode shows: a map only when a valid place is loaded. */
export type PlaceView =
  | { kind: 'loading'; canRun: false; text: string }
  | { kind: 'no_data'; canRun: false; text: string }
  | { kind: 'ready'; canRun: true; text: string };

export const NO_DATA_TEXT = 'No data yet for this place. The map file is missing or could not be read.';

/** Pure state logic for Place mode. The hall and walls are never part of it. */
export function placeView(s: {
  placeFixture: unknown | null;
  placeLoading: boolean;
  placeError: string | null;
}): PlaceView {
  if (s.placeFixture !== null) return { kind: 'ready', canRun: true, text: '' };
  if (s.placeLoading) return { kind: 'loading', canRun: false, text: 'Loading the map…' };
  return { kind: 'no_data', canRun: false, text: s.placeError ? `${NO_DATA_TEXT} ${s.placeError}` : NO_DATA_TEXT };
}

/** The place to load when Place mode opens: the current one, else Kadikoy. */
export const DEFAULT_PLACE = 'kadikoy' as const;

/**
 * Lab_Settings (experience spec, Requirement 17). Only the Lab passes them. Every measured run
 * and every normal run sends none, which means the measured defaults (100 shots, top group 40%).
 */
export interface LabSettings {
  shots?: number;
  top_share?: number;
}

/** The start payload sent to the worker. Points carry only id, x, y. `settings` is added only when given. */
export function buildRequest(choice: MapChoice, seed: number, settings?: LabSettings): StartPayload {
  const base = buildBaseRequest(choice, seed);
  return settings === undefined ? base : { ...base, settings: { ...settings } };
}

function buildBaseRequest(choice: MapChoice, seed: number): StartPayload {
  const points = choice.points.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  if (choice.mode === 'channel_plan') {
    const edges = buildWallEdges(choice.points, choice.walls, choice.wallsOn, choice.r);
    return { points, mode: 'channel_plan', seed, graph: { r: choice.r, edges } };
  }
  if (choice.mode === 'your_map') {
    // The engine's mode is place. The edge list is sent, so the drawn and the sent edges are the same list.
    const edges = buildStraightEdges(choice.points, choice.r);
    return { points, mode: 'place', seed, graph: { r: choice.r, edges } };
  }
  if (choice.walking) {
    const edges = choice.walkingEdges.map((e): Edge => [e[0], e[1]]);
    return { points, mode: 'place', seed, graph: { r: PLACE_R_M, edges } };
  }
  // Straight line: the engine builds the graph from r. Edges are only drawn.
  return { points, mode: 'place', seed, graph: { r: PLACE_R_M } };
}
