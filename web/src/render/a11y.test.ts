import { describe, expect, it } from 'vitest';
import { nearestInDirection, type ScreenPoint } from './a11y';

const P = (id: string, x: number, y: number): ScreenPoint => ({ id, x, y });

describe('nearestInDirection', () => {
  const pts = [P('a', 0, 0), P('b', 10, 1), P('c', 5, 20), P('d', -7, 0), P('e', 0, -9)];

  it('moves to the nearest Point in each direction', () => {
    expect(nearestInDirection(pts, pts[0], 'right')?.id).toBe('b');
    expect(nearestInDirection(pts, pts[0], 'left')?.id).toBe('d');
    expect(nearestInDirection(pts, pts[0], 'down')?.id).toBe('c');
    expect(nearestInDirection(pts, pts[0], 'up')?.id).toBe('e');
  });

  it('returns null when nothing is ahead', () => {
    expect(nearestInDirection(pts, pts[1], 'right')).toBeNull();
  });

  it('falls back to a Point outside the cone', () => {
    const two = [P('a', 0, 0), P('b', 1, 10)];
    expect(nearestInDirection(two, two[0], 'right')?.id).toBe('b');
  });
});
