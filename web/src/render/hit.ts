/**
 * Hit test for map Points. Pure, no DOM.
 *
 * `xy` holds screen positions as x,y pairs in CSS pixels (the same layout
 * as `DynamicLayer.setPoints`). Returns the index of the nearest Point
 * within `maxPx` of (x, y), or -1 when there is none. A Point exactly
 * `maxPx` away is a hit. On equal distance the lower index wins.
 */
export function nearestPoint(
  xy: ArrayLike<number>,
  x: number,
  y: number,
  maxPx = 12,
): number {
  const n = Math.floor(xy.length / 2);
  const limit = maxPx * maxPx;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xy[2 * i] - x;
    const dy = xy[2 * i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d <= limit && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
