// Pre-rendered glow sprites and cached Path2D shapes for the dynamic layer.
// Gradients are made once here, never per frame. No shadowBlur.

import { ACCENT_COLOUR } from '../settings';

export const GLOW_LEVELS = 8;
export const GLOW_COLOUR = '#5dcaa5';
export const AMBER_COLOUR = '#ef9f27';
export const TEAL_COLOUR = '#5dcaa5';
export const GREY_COLOUR = '#8f8cb8';
export const TEXT_COLOUR = '#e8e6f5';

/** A channel value stored per point. 0 = none yet, 5 = 5 GHz only. */
export type ChannelCode = 0 | 1 | 5 | 6 | 11;

export type ShapeKind = 'circle' | 'triangle' | 'square' | 'hollow';

/** Shape and colour both carry the channel (colour blind safe). */
export function shapeForChannel(ch: number): ShapeKind {
  if (ch === 1) return 'circle';
  if (ch === 6) return 'triangle';
  if (ch === 11) return 'square';
  return 'hollow';
}

export function colourForChannel(ch: number): string {
  if (ch === 1) return ACCENT_COLOUR;
  if (ch === 6) return AMBER_COLOUR;
  if (ch === 11) return TEAL_COLOUR;
  return GREY_COLOUR;
}

/** Shapes are built once on a unit radius (1) around the origin and scaled when drawn. */
export interface Shapes {
  circle: Path2D;
  triangle: Path2D;
  square: Path2D;
  hollow: Path2D;
  lock: Path2D;
}

let shapes: Shapes | null = null;

export function getShapes(): Shapes {
  if (shapes) return shapes;
  const circle = new Path2D();
  circle.arc(0, 0, 1, 0, Math.PI * 2);

  const triangle = new Path2D();
  const h = 1.15;
  triangle.moveTo(0, -h);
  triangle.lineTo(h * 0.95, h * 0.7);
  triangle.lineTo(-h * 0.95, h * 0.7);
  triangle.closePath();

  const square = new Path2D();
  square.rect(-0.9, -0.9, 1.8, 1.8);

  const hollow = new Path2D();
  hollow.arc(0, 0, 1, 0, Math.PI * 2);

  // Small padlock for rule picks, about 0.9 wide, drawn above-right of the point.
  const lock = new Path2D();
  lock.rect(-0.45, -0.1, 0.9, 0.7);
  lock.moveTo(-0.28, -0.1);
  lock.lineTo(-0.28, -0.35);
  lock.arc(0, -0.35, 0.28, Math.PI, 0);
  lock.lineTo(0.28, -0.1);

  shapes = { circle, triangle, square, hollow, lock };
  return shapes;
}

export function pathFor(kind: ShapeKind): Path2D {
  return getShapes()[kind];
}

/**
 * One offscreen canvas per glow level. Level k has peak alpha (k+1)/GLOW_LEVELS.
 * `radiusCss` is the glow radius in CSS pixels; `dpr` is the pixel ratio.
 * Each sprite is (2 * radiusCss * dpr) pixels square.
 */
export function createGlowSprites(radiusCss: number, dpr: number): HTMLCanvasElement[] {
  const size = Math.max(2, Math.ceil(2 * radiusCss * dpr));
  const sprites: HTMLCanvasElement[] = [];
  for (let k = 0; k < GLOW_LEVELS; k++) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (g) {
      const peak = (k + 1) / GLOW_LEVELS;
      const r = size / 2;
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, rgba(GLOW_COLOUR, 0.55 * peak));
      grad.addColorStop(0.5, rgba(GLOW_COLOUR, 0.22 * peak));
      grad.addColorStop(1, rgba(GLOW_COLOUR, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    sprites.push(c);
  }
  return sprites;
}

/** Glow value 0..1 to a sprite index, or -1 when there is no glow. */
export function glowLevel(glow: number): number {
  if (!(glow > 0.001)) return -1;
  const k = Math.ceil(Math.min(1, glow) * GLOW_LEVELS) - 1;
  return Math.max(0, Math.min(GLOW_LEVELS - 1, k));
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
