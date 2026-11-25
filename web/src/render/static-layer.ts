// Static canvas layer: streets, walls and conflict edges.
// Drawn from the app's own data (no tile requests). One batched path per style,
// so there is exactly one stroke() per style. It is redrawn only when the map,
// the distance toggle, the size or the pixel ratio changes, never per frame.
// Points are drawn by the dynamic layer, not here.

import type { Wall } from '../edges/walls';

/** Colours from .kiro/steering/design.md. Edges are background: thin and dim. */
export const STATIC_COLOURS = {
  street: 'rgba(143, 140, 184, 0.28)', // muted text colour, dim
  edge: 'rgba(143, 140, 184, 0.22)',
  // Your map: the visitor is drawing the graph, so the lines must be easy to see. Still weaker than the picks.
  edgeDrawing: 'rgba(143, 140, 184, 0.55)',
  concrete: '#e8e6f5', // text colour, thick and solid
  drywall: '#8f8cb8', // muted colour, thin and dotted
  frame: 'rgba(143, 140, 184, 0.55)', // the drawing area of Your map, thin and dim
} as const;

export interface StaticPoint {
  id: string;
  x: number;
  y: number;
}

/** Everything the static layer draws. World units are metres, y points up. */
export interface StaticScene {
  /** Used to find the ends of each edge. */
  points: readonly StaticPoint[];
  /** Conflict_Graph edges for the current map and toggle. */
  edges: readonly (readonly [string, string])[];
  /** Channel_Plan only. */
  walls?: readonly Wall[];
  /** Place only. Polylines in metres. */
  streets?: readonly (readonly (readonly [number, number])[])[];
  /**
   * Your map only. The view fits these bounds instead of the Points, so an empty map still has a view.
   * rame draws the drawing area (from 0, 0 to width, height) as a thin rectangle.
   */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Your map: draw the conflict lines a bit stronger (they are the graph the visitor is building). */
  edgesStrong?: boolean;
  frame?: { width: number; height: number };
}

/** World to screen mapping, in CSS pixels. */
export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** CSS height, used to flip y so north is up. */
  height: number;
}

const PAD_PX = 16;

/** Fit the bounding box of the scene into width x height CSS pixels. */
export function fitView(scene: StaticScene, width: number, height: number): View {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  if (scene.bounds) {
    grow(scene.bounds.minX, scene.bounds.minY);
    grow(scene.bounds.maxX, scene.bounds.maxY);
  } else {
    for (const p of scene.points) grow(p.x, p.y);
    for (const w of scene.walls ?? []) {
      grow(w.x1, w.y1);
      grow(w.x2, w.y2);
    }
  }
  if (!Number.isFinite(minX)) {
    return { scale: 1, offsetX: 0, offsetY: 0, height };
  }
  // Streets can extend far past the points; they are clipped by the canvas.
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const availW = Math.max(width - 2 * PAD_PX, 1);
  const availH = Math.max(height - 2 * PAD_PX, 1);
  const scale = Math.min(availW / spanX, availH / spanY);
  return {
    scale,
    offsetX: (width - spanX * scale) / 2 - minX * scale,
    // y flip: screen y = height - (offsetY + y * scale)
    offsetY: (height - spanY * scale) / 2 - minY * scale,
    height,
  };
}

export const toScreenX = (v: View, x: number): number => v.offsetX + x * v.scale;
export const toScreenY = (v: View, y: number): number => v.height - (v.offsetY + y * v.scale);
/** The inverse of toScreenX and toScreenY: a click position in CSS pixels to metres. */
export const toWorldX = (v: View, sx: number): number => (sx - v.offsetX) / v.scale;
export const toWorldY = (v: View, sy: number): number => (v.height - sy - v.offsetY) / v.scale;

/** Number of stroke() calls made by the last draw, per style. Used by tests. */
export interface DrawStats {
  streets: number;
  edges: number;
  concrete: number;
  drywall: number;
  frame: number;
}

/**
 * Draw the scene on a 2D context whose transform is already scaled by the
 * pixel ratio (units are CSS pixels). Exactly one stroke() per non-empty style.
 */
export function drawStaticScene(
  ctx: CanvasRenderingContext2D,
  scene: StaticScene,
  view: View,
  width: number,
  height: number,
): DrawStats {
  const stats: DrawStats = { streets: 0, edges: 0, concrete: 0, drywall: 0, frame: 0 };
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Your map: the drawing area as a thin frame, under everything else.
  if (scene.frame) {
    const x0 = toScreenX(view, 0);
    const y0 = toScreenY(view, 0);
    const x1 = toScreenX(view, scene.frame.width);
    const y1 = toScreenY(view, scene.frame.height);
    ctx.beginPath();
    ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.setLineDash([]);
    ctx.strokeStyle = STATIC_COLOURS.frame;
    ctx.lineWidth = 1;
    ctx.stroke();
    stats.frame = 1;
  }

  // Streets, under everything else.
  const streets = scene.streets ?? [];
  if (streets.length > 0) {
    ctx.beginPath();
    for (const line of streets) {
      if (line.length < 2) continue;
      ctx.moveTo(toScreenX(view, line[0][0]), toScreenY(view, line[0][1]));
      for (let i = 1; i < line.length; i++) {
        ctx.lineTo(toScreenX(view, line[i][0]), toScreenY(view, line[i][1]));
      }
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = STATIC_COLOURS.street;
    ctx.lineWidth = 1;
    ctx.stroke();
    stats.streets = 1;
  }

  // Conflict edges: very thin and dim.
  if (scene.edges.length > 0) {
    const byId = new Map<string, StaticPoint>();
    for (const p of scene.points) byId.set(p.id, p);
    ctx.beginPath();
    for (const [a, b] of scene.edges) {
      const pa = byId.get(a);
      const pb = byId.get(b);
      if (!pa || !pb) continue;
      ctx.moveTo(toScreenX(view, pa.x), toScreenY(view, pa.y));
      ctx.lineTo(toScreenX(view, pb.x), toScreenY(view, pb.y));
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = scene.edgesStrong ? STATIC_COLOURS.edgeDrawing : STATIC_COLOURS.edge;
    ctx.lineWidth = scene.edgesStrong ? 1 : 0.5;
    ctx.stroke();
    stats.edges = 1;
  }

  // Walls: concrete thick and solid, drywall thin and dotted.
  const walls = scene.walls ?? [];
  const concrete = walls.filter((w) => w.kind === 'concrete');
  const drywall = walls.filter((w) => w.kind === 'drywall');
  if (concrete.length > 0) {
    ctx.beginPath();
    for (const w of concrete) {
      ctx.moveTo(toScreenX(view, w.x1), toScreenY(view, w.y1));
      ctx.lineTo(toScreenX(view, w.x2), toScreenY(view, w.y2));
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = STATIC_COLOURS.concrete;
    ctx.lineWidth = 3;
    ctx.lineCap = 'butt';
    ctx.stroke();
    stats.concrete = 1;
  }
  if (drywall.length > 0) {
    ctx.beginPath();
    for (const w of drywall) {
      ctx.moveTo(toScreenX(view, w.x1), toScreenY(view, w.y1));
      ctx.lineTo(toScreenX(view, w.x2), toScreenY(view, w.y2));
    }
    ctx.setLineDash([1.5, 3]);
    ctx.strokeStyle = STATIC_COLOURS.drywall;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.setLineDash([]);
    stats.drywall = 1;
  }
  return stats;
}

/**
 * Owns one canvas. Call update() whenever inputs might have changed (also from
 * a ResizeObserver); it redraws only if the scene object, the CSS size or the
 * pixel ratio differ from the last draw. A new scene object means the map or
 * the toggle changed, so callers must build a new scene for those changes and
 * reuse the same object otherwise.
 */
export class StaticLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastScene: StaticScene | null = null;
  private lastW = -1;
  private lastH = -1;
  private lastDpr = -1;
  /** Count of real redraws, for tests. */
  redrawCount = 0;
  /** View of the last draw, shared with the dynamic layer. */
  view: View = { scale: 1, offsetX: 0, offsetY: 0, height: 0 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Returns true when it redrew. */
  update(
    scene: StaticScene,
    cssWidth: number,
    cssHeight: number,
    dpr: number = window.devicePixelRatio || 1,
  ): boolean {
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    if (scene === this.lastScene && w === this.lastW && h === this.lastH && dpr === this.lastDpr) {
      return false;
    }
    this.lastScene = scene;
    this.lastW = w;
    this.lastH = h;
    this.lastDpr = dpr;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.view = fitView(scene, w, h);
    drawStaticScene(this.ctx, scene, this.view, w, h);
    this.redrawCount++;
    return true;
  }
}
