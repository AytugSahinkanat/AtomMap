import { describe, expect, it } from 'vitest';
import { receivedPowerDbm, WALL_LOSS_DB } from '../settings';
import { buildWallEdges, type Pt, type Wall } from './walls';

const R = 20;

/** Two points on the x axis, d metres apart. */
function pair(d: number, idA = 'a', idB = 'b'): Pt[] {
  return [
    { id: idA, x: 0, y: 0 },
    { id: idB, x: d, y: 0 },
  ];
}

/** A wall that properly crosses the segment between pair(d) points. */
function wallAcross(d: number, kind: Wall['kind']): Wall {
  return { x1: d / 2, y1: -5, x2: d / 2, y2: 5, kind };
}

describe('buildWallEdges', () => {
  it('uses the expected threshold and loss constants', () => {
    expect(receivedPowerDbm(R)).toBeCloseTo(-69.03, 2);
    expect(WALL_LOSS_DB.concrete).toBe(12);
    expect(WALL_LOSS_DB.drywall).toBe(4);
  });

  it('keeps a close pair with no walls, on or off', () => {
    expect(buildWallEdges(pair(5), [], true, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(5), [], false, R)).toEqual([['a', 'b']]);
  });

  it('concrete (12 dB) removes an edge that open air would keep', () => {
    // Concrete limit is 20 * 10^(-12/30), about 7.96 m.
    const w = [wallAcross(9, 'concrete')];
    expect(buildWallEdges(pair(9), w, false, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(9), w, true, R)).toEqual([]);
  });

  it('concrete keeps an edge when the pair is close enough', () => {
    const w = [wallAcross(7.5, 'concrete')];
    expect(buildWallEdges(pair(7.5), w, true, R)).toEqual([['a', 'b']]);
  });

  it('drywall (4 dB) keeps a pair that concrete would cut', () => {
    // Drywall limit is 20 * 10^(-4/30), about 14.74 m.
    const d = 9;
    expect(buildWallEdges(pair(d), [wallAcross(d, 'drywall')], true, R)).toEqual([
      ['a', 'b'],
    ]);
  });

  it('drywall removes an edge beyond its limit', () => {
    const w = [wallAcross(16, 'drywall')];
    expect(buildWallEdges(pair(16), w, false, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(16), w, true, R)).toEqual([]);
  });

  it('adds up losses from several crossed walls', () => {
    // Two drywalls = 8 dB, limit about 20 * 10^(-8/30) = 10.8 m.
    const d = 12;
    const one = [wallAcross(d, 'drywall')];
    const two = [
      { x1: d / 3, y1: -5, x2: d / 3, y2: 5, kind: 'drywall' as const },
      { x1: (2 * d) / 3, y1: -5, x2: (2 * d) / 3, y2: 5, kind: 'drywall' as const },
    ];
    expect(buildWallEdges(pair(d), one, true, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(d), two, true, R)).toEqual([]);
  });

  it('ignores walls that do not cross the segment, or only touch it', () => {
    const d = 9;
    const apart: Wall = { x1: 20, y1: -5, x2: 20, y2: 5, kind: 'concrete' };
    const touching: Wall = { x1: d, y1: 0, x2: d, y2: 5, kind: 'concrete' };
    expect(buildWallEdges(pair(d), [apart, touching], true, R)).toEqual([
      ['a', 'b'],
    ]);
  });

  it('ignores walls when walls are off', () => {
    const w = [wallAcross(5, 'concrete')];
    expect(buildWallEdges(pair(5), w, false, R)).toEqual([['a', 'b']]);
  });

  it('a pair at 19.95 m is an edge with walls off and a cut with a drywall on', () => {
    const w = [wallAcross(19.95, 'drywall')];
    expect(buildWallEdges(pair(19.95), [], false, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(19.95), [], true, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(19.95), w, false, R)).toEqual([['a', 'b']]);
    expect(buildWallEdges(pair(19.95), w, true, R)).toEqual([]);
  });

  it('allows the gap between 19.95 m and r = 20 m: pairs just under 20 m are edges', () => {
    // This gap is allowed. It is not a bug if such a pair is wider than the
    // engine blockade radius.
    expect(buildWallEdges(pair(19.99), [], false, R)).toEqual([['a', 'b']]);
  });

  it('a pair just beyond r is not an edge, even with walls off', () => {
    expect(buildWallEdges(pair(20.01), [], false, R)).toEqual([]);
  });

  it('lists each pair once, ordered by id, and sorts the list', () => {
    const pts: Pt[] = [
      { id: 'c', x: 0, y: 0 },
      { id: 'a', x: 3, y: 0 },
      { id: 'b', x: 6, y: 0 },
    ];
    expect(buildWallEdges(pts, [], false, R)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('returns no edges for zero or one point', () => {
    expect(buildWallEdges([], [], true, R)).toEqual([]);
    expect(buildWallEdges([{ id: 'a', x: 0, y: 0 }], [], true, R)).toEqual([]);
  });
});
