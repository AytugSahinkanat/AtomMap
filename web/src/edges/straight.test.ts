import { describe, expect, it } from 'vitest';
import { buildStraightEdges, type Pt } from './straight';

const R = 150;

/** Two points on the x axis, d metres apart. */
function pair(d: number, idA = 'a', idB = 'b'): Pt[] {
  return [
    { id: idA, x: 0, y: 0 },
    { id: idB, x: d, y: 0 },
  ];
}

describe('buildStraightEdges', () => {
  it('does not connect a pair at exactly r', () => {
    expect(buildStraightEdges(pair(R), R)).toEqual([]);
  });

  it('connects a pair just below r', () => {
    expect(buildStraightEdges(pair(R - 1e-6), R)).toEqual([['a', 'b']]);
  });

  it('does not connect a pair just above r', () => {
    expect(buildStraightEdges(pair(R + 1e-6), R)).toEqual([]);
  });

  it('uses Euclidean distance, not per-axis distance', () => {
    const pts: Pt[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 100 },
    ];
    // Distance is about 141.42 m, although each axis offset is only 100 m.
    expect(buildStraightEdges(pts, 141)).toEqual([]);
    expect(buildStraightEdges(pts, 142)).toEqual([['a', 'b']]);
  });

  it('orders each pair by id whatever the input order', () => {
    expect(buildStraightEdges(pair(10, 'z', 'c'), R)).toEqual([['c', 'z']]);
  });

  it('sorts edges by first id, then second id', () => {
    const pts: Pt[] = [
      { id: 'c', x: 0, y: 0 },
      { id: 'a', x: 10, y: 0 },
      { id: 'b', x: 20, y: 0 },
    ];
    expect(buildStraightEdges(pts, R)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('lists every pair once', () => {
    const pts: Pt[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const edges = buildStraightEdges(pts, R);
    expect(edges).toHaveLength(15);
    const keys = edges.map(([u, v]) => `${u}|${v}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [u, v] of edges) expect(u < v).toBe(true);
  });

  it('returns no edges for zero or one point', () => {
    expect(buildStraightEdges([], R)).toEqual([]);
    expect(buildStraightEdges([{ id: 'a', x: 0, y: 0 }], R)).toEqual([]);
  });
});
