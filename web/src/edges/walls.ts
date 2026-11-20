// Wall edge builder for Channel_Plan mode (Radio_Model, see settings.ts).
// Small map helper only: it builds the edge list that is passed to the Engine.

import {
  receivedPowerDbm,
  signalThresholdDbm,
  WALL_LOSS_DB,
} from '../settings';

export interface Pt {
  id: string;
  x: number;
  y: number;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'concrete' | 'drywall';
}

/** Sign of the cross product (b - a) x (c - a): 1, -1 or 0. */
function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/**
 * Proper intersection: the two segments cross at a single point interior to
 * both. Touching at an endpoint or lying collinear does not count.
 */
function properlyCross(a: Pt, b: Pt, w: Wall): boolean {
  const o1 = orient(a.x, a.y, b.x, b.y, w.x1, w.y1);
  const o2 = orient(a.x, a.y, b.x, b.y, w.x2, w.y2);
  const o3 = orient(w.x1, w.y1, w.x2, w.y2, a.x, a.y);
  const o4 = orient(w.x1, w.y1, w.x2, w.y2, b.x, b.y);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Edges between APs whose received power is strictly above the Signal_Threshold
 * (the power at distance r), so walls off equals the straight-line r graph.
 * r is the Hero_Map fixture's r in metres (for example 20).
 * Wall losses are subtracted only when wallsOn is true. Each pair appears
 * once as [smaller id, larger id], and the list is sorted.
 */
export function buildWallEdges(
  points: readonly Pt[],
  walls: readonly Wall[],
  wallsOn: boolean,
  r: number,
): [string, string][] {
  const threshold = signalThresholdDbm(r);
  const edges: [string, string][] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      let power = receivedPowerDbm(d);
      if (wallsOn) {
        for (const w of walls) {
          if (properlyCross(a, b, w)) power -= WALL_LOSS_DB[w.kind];
        }
      }
      if (power > threshold) {
        edges.push(a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
      }
    }
  }
  edges.sort((p, q) =>
    p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0,
  );
  return edges;
}
