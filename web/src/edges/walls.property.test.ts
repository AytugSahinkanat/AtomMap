import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildWallEdges, type Pt, type Wall } from './walls';

const R = 20;

const coord = fc.double({ min: 0, max: 60, noNaN: true });

const pointsArb = fc
  .integer({ min: 0, max: 15 })
  .chain((n) =>
    fc.array(fc.tuple(coord, coord), { minLength: n, maxLength: n }),
  )
  .map((xy): Pt[] => xy.map(([x, y], i) => ({ id: `ap${i}`, x, y })));

const wallArb: fc.Arbitrary<Wall> = fc.record({
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  kind: fc.constantFrom('concrete' as const, 'drywall' as const),
});

describe('walls edge builder properties', () => {
  // Feature: ui, Property 1: Turning walls on never adds an edge
  // **Validates: Requirements 5.3, 5.4, 5.5**
  it('every edge with walls on is also an edge with walls off', () => {
    fc.assert(
      fc.property(
        pointsArb,
        fc.array(wallArb, { maxLength: 12 }),
        (points, walls) => {
          const off = new Set(
            buildWallEdges(points, walls, false, R).map((e) => e.join('|')),
          );
          const on = buildWallEdges(points, walls, true, R);
          for (const e of on) expect(off.has(e.join('|'))).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
