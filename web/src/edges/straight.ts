// Straight-line edges, used only for drawing. The Place request sends
// graph:{r:150} without edges; the engine builds its own graph.

/** Structurally identical to the Pt type in walls.ts. */
export interface Pt {
  id: string;
  x: number;
  y: number;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * All pairs of points with distance strictly below r, each pair once.
 * Each pair is [smaller id, larger id]; the list is sorted by first then second id.
 */
export function buildStraightEdges(points: readonly Pt[], r: number): [string, string][] {
  const edges: [string, string][] = [];
  const r2 = r * r;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    for (let j = i + 1; j < points.length; j++) {
      const q = points[j];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy < r2) {
        edges.push(byCodeUnit(p.id, q.id) <= 0 ? [p.id, q.id] : [q.id, p.id]);
      }
    }
  }
  edges.sort((e, f) => byCodeUnit(e[0], f[0]) || byCodeUnit(e[1], f[1]));
  return edges;
}
